import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { Root } from "mdast"
import type ts from "typescript"
import { rulesForFile } from "../config"
import type {
	DocumentParseError,
	ExtractedSnippet,
	KiiraDiagnostic,
	KiiraFs,
	KiiraProject,
	KiiraRule,
	ProjectRuleReport,
	ResolvedKiiraConfig,
	RuleDocumentContext,
	RuleReport,
	RuleScope,
	SourceRange,
	VirtualFile,
} from "../types"
import { mapVirtualRange } from "../virtual"
import { discoverWorkspacePackages } from "../workspace"

type Level = "warn" | "error"

const SEVERITY = { warn: "warning", error: "error" } as const
const RANK: Record<KiiraDiagnostic["severity"], number> = { info: 0, warning: 1, error: 2 }
const START_OF_FILE: SourceRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

/**
 * Turn a rule's report into a diagnostic: `code` is always the rule id. A report's
 * own severity can only lower the configured level, never raise it.
 */
export function reportToDiagnostic(id: string, level: Level, file: string, report: RuleReport): KiiraDiagnostic {
	const configured = SEVERITY[level]
	const diagnostic: KiiraDiagnostic = {
		severity: report.severity && RANK[report.severity] < RANK[configured] ? report.severity : configured,
		code: id,
		message: report.message,
		source: "kiira",
		markdownFile: file,
		markdownRange: report.range,
	}
	if (report.fix) {
		diagnostic.fix = report.fix
	}
	return diagnostic
}

/** Read-only, cwd-relative file access that records each text it reads. */
export function createRuleFs(cwd: string): { fs: KiiraFs; reads: Map<string, string | undefined> } {
	const reads = new Map<string, string | undefined>()
	const fs: KiiraFs = {
		exists: (path) => existsSync(resolve(cwd, path)),
		readText: (path) => {
			let text: string | undefined
			try {
				text = readFileSync(resolve(cwd, path), "utf8")
			} catch {
				text = undefined
			}
			reads.set(path, text)
			return text
		},
	}
	return { fs, reads }
}

/** The workspace facts shared by every rule in one run. */
export async function createProject(cwd: string): Promise<KiiraProject> {
	let packageJson: Record<string, unknown> | undefined
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))
		packageJson =
			parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
	} catch {
		packageJson = undefined
	}
	return {
		cwd,
		packageJson,
		workspacePackages: await discoverWorkspacePackages(cwd),
		isTracked: (path) => {
			try {
				execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "--error-unmatch", "--", path], {
					cwd,
					stdio: "ignore",
				})
				return true
			} catch {
				return false
			}
		},
	}
}

/** What every rule in a run shares. */
export interface RuleRun {
	config: ResolvedKiiraConfig
	project: KiiraProject
	fs: KiiraFs
}

/** One Markdown document as rules see it. */
export interface RuleDocument {
	file: string
	text: string
	mdast: Root
	parseError?: DocumentParseError
	snippets: ExtractedSnippet[]
}

/** The classic engine's program for the partition a document was checked in. */
export interface CheckedProgram {
	program: ts.Program
	virtualFiles: VirtualFile[]
}

interface EnabledRule {
	id: string
	rule: KiiraRule
	level: Level
	options: unknown
}

function enabledRules(config: ResolvedKiiraConfig, file: string | undefined, scope: RuleScope): EnabledRule[] {
	const settings = rulesForFile(config, file)
	const enabled: EnabledRule[] = []
	for (const [id, rule] of Object.entries(config.ruleRegistry)) {
		const setting = settings[id]
		if (rule.meta.scope === scope && setting && setting.severity !== "off") {
			enabled.push({ id, rule, level: setting.severity, options: setting.options })
		}
	}
	return enabled
}

/**
 * Call a rule's `create`. It takes a scope-specific context; the runner passes the
 * right one for the scope it enabled. A rule that throws does not stop the check:
 * the failure becomes an error diagnostic on `file` and the other rules still run.
 */
async function callCreate(
	id: string,
	file: string,
	rule: KiiraRule,
	context: unknown,
	out: KiiraDiagnostic[],
	where = file
): Promise<void> {
	try {
		await (rule as { create(context: unknown): void | Promise<void> }).create(context)
	} catch (error) {
		out.push({
			severity: "error",
			code: id,
			source: "kiira",
			message: `Rule "${id}" failed on ${where}: ${error instanceof Error ? error.message : String(error)}`,
			markdownFile: file,
			markdownRange: START_OF_FILE,
		})
	}
}

function documentContext(
	run: RuleRun,
	doc: RuleDocument,
	diagnostics: readonly KiiraDiagnostic[],
	{ id, level, options }: EnabledRule,
	out: KiiraDiagnostic[]
): RuleDocumentContext {
	return {
		file: doc.file,
		text: doc.text,
		mdast: doc.mdast,
		parseError: doc.parseError,
		snippets: doc.snippets,
		diagnostics,
		options,
		severity: SEVERITY[level],
		config: run.config,
		fs: run.fs,
		project: run.project,
		report: (report) => out.push(reportToDiagnostic(id, level, doc.file, report)),
	}
}

/** Run the enabled document rules for one document, in registry order. */
export async function runDocumentRules(
	run: RuleRun,
	doc: RuleDocument,
	diagnostics: readonly KiiraDiagnostic[]
): Promise<KiiraDiagnostic[]> {
	const out: KiiraDiagnostic[] = []
	for (const enabled of enabledRules(run.config, doc.file, "document")) {
		await callCreate(enabled.id, doc.file, enabled.rule, documentContext(run, doc, diagnostics, enabled, out), out)
	}
	return out
}

/** Run the enabled program rules for one document against the program it was checked in. */
export async function runProgramRules(
	run: RuleRun,
	doc: RuleDocument,
	diagnostics: readonly KiiraDiagnostic[],
	checked: CheckedProgram
): Promise<KiiraDiagnostic[]> {
	const out: KiiraDiagnostic[] = []
	const virtualFiles = checked.virtualFiles.filter((vf) => vf.snippet.markdownFile === doc.file)
	if (virtualFiles.length === 0) {
		return out
	}
	const { program } = checked
	for (const enabled of enabledRules(run.config, doc.file, "program")) {
		const context = {
			...documentContext(run, doc, diagnostics, enabled, out),
			program,
			checker: program.getTypeChecker(),
			virtualFiles,
			toMarkdownRange: (virtualFile: VirtualFile, start: number, end: number) => {
				const sourceFile = program.getSourceFile(virtualFile.fileName)
				if (!sourceFile) {
					return undefined
				}
				const from = sourceFile.getLineAndCharacterOfPosition(start)
				const to = sourceFile.getLineAndCharacterOfPosition(end)
				return mapVirtualRange(virtualFile.mappings, from, to)
			},
		}
		await callCreate(enabled.id, doc.file, enabled.rule, context, out)
	}
	return out
}

/** Run the enabled project rules once, over every document in the run. */
export async function runProjectRules(run: RuleRun, files: readonly string[]): Promise<KiiraDiagnostic[]> {
	const out: KiiraDiagnostic[] = []
	for (const { id, rule, level, options } of enabledRules(run.config, undefined, "project")) {
		const context = {
			options,
			severity: SEVERITY[level],
			config: run.config,
			fs: run.fs,
			project: run.project,
			files,
			report: (report: ProjectRuleReport) =>
				out.push(reportToDiagnostic(id, level, report.file, { ...report, range: report.range ?? START_OF_FILE })),
		}
		// A project rule has no document of its own; anchor its failure to the first
		// document, or to package.json when the run has none.
		await callCreate(id, files[0] ?? "package.json", rule, context, out, "the project")
	}
	return out
}

/** The ids of the program rules enabled for at least one of `files`. */
export function enabledProgramRuleIds(config: ResolvedKiiraConfig, files: readonly string[]): string[] {
	return Object.entries(config.ruleRegistry)
		.filter(
			([id, rule]) =>
				rule.meta.scope === "program" && files.some((file) => rulesForFile(config, file)[id]?.severity !== "off")
		)
		.map(([id]) => id)
}

/**
 * The one `info` diagnostic that says program rules were skipped because the run
 * used the native engine, which has no `ts.Program` to hand out. `undefined` when
 * no program rule is enabled for any of `files`.
 */
export function programRulesSkipped(
	config: ResolvedKiiraConfig,
	files: readonly string[]
): KiiraDiagnostic | undefined {
	const first = files[0]
	if (first === undefined) {
		return undefined
	}
	const ids = enabledProgramRuleIds(config, files)
	if (ids.length === 0) {
		return undefined
	}
	return {
		severity: "info",
		code: "program-rules-skipped",
		source: "kiira",
		message: `Skipped program rules because the native engine has no ts.Program: ${ids.join(", ")}. Set \`engine: "classic"\` to run them.`,
		markdownFile: first,
		markdownRange: START_OF_FILE,
	}
}
