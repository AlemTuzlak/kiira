import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import picomatch from "picomatch"
import type ts from "typescript"
import { loadConfig, resolveConfig, rulesForFile } from "./config"
import { discoverMarkdownFiles } from "./discover"
import { type CheckerEngine, type RawDiagnostic, resolveEngine } from "./engine"
import { collectExternalPackages, ensureExternalPackages, externalResolution } from "./external"
import { extractSnippets, loadMdxSupportFor, parseDocument } from "./extract"
import { groupSuggestions } from "./rules/group"
import { jsxFrameworkSuggestions } from "./rules/jsx-framework"
import { languageTagSuggestions } from "./rules/language-tag"
import {
	type CheckedProgram,
	type RuleDocument,
	type RuleRun,
	createProject,
	createRuleFs,
	enabledProgramRuleIds,
	programRulesSkipped,
	reportToDiagnostic,
	runDocumentRules,
	runProgramRules,
	runProjectRules,
} from "./rules/run"
import type {
	ExtractedSnippet,
	KiiraCheckResult,
	KiiraConfig,
	KiiraDiagnostic,
	KiiraFs,
	KiiraProject,
	KiiraPlugin,
	ResolvedKiiraConfig,
	RuleSeverity,
	VirtualFile,
} from "./types"
import { getTypescript, selectTypescript } from "./typescript"
import {
	type TypescriptHookOutcome,
	applyTypescriptHook,
	hasTypescriptHooks,
	runTypescriptHooks,
	stableStringify,
} from "./typescript-hook"
import { createVirtualFiles, mapVirtualRange } from "./virtual"
import { buildWorkspaceResolution } from "./workspace"

// The lib-dir override and the classic overlay host live in `engine.ts` alongside
// the classic engine; re-export the host-facing hooks so consumers (index, vscode)
// keep importing them from `check`.
export { applyLibDirOverride, setTypescriptLibDir } from "./engine"
export { setTypescriptModule } from "./typescript"

function defaultCompilerOptions(): ts.CompilerOptions {
	const ts = getTypescript()
	return {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		jsx: ts.JsxEmit.ReactJSX,
		// Doc snippets routinely use both ES and web globals (`console`, `fetch`, `Date`,
		// `JSON`). Without a project tsconfig to specify `lib`, include DOM so these
		// resolve instead of being reported as undefined names.
		lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
		strict: true,
		esModuleInterop: true,
		forceConsistentCasingInFileNames: true,
		allowJs: true,
		checkJs: true,
		skipLibCheck: true,
		noEmit: true,
	}
}

/** Resolve which tsconfig to use: explicit config, then tsconfig.docs.json, then tsconfig.json. */
export function resolveTsconfigPath(cwd: string, tsconfig?: string): string | undefined {
	if (tsconfig) {
		return isAbsolute(tsconfig) ? tsconfig : resolve(cwd, tsconfig)
	}
	const docs = join(cwd, "tsconfig.docs.json")
	if (existsSync(docs)) {
		return docs
	}
	const base = join(cwd, "tsconfig.json")
	if (existsSync(base)) {
		return base
	}
	return undefined
}

function loadCompilerOptions(tsconfigPath: string | undefined): ts.CompilerOptions {
	const ts = getTypescript()
	if (!tsconfigPath) {
		return defaultCompilerOptions()
	}
	const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
	if (read.error || !read.config) {
		return defaultCompilerOptions()
	}
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfigPath))
	// We never emit, and lib checking is the consumer's concern, not the docs'.
	return { ...parsed.options, noEmit: true, skipLibCheck: parsed.options.skipLibCheck ?? true }
}

/** Map an engine's virtual-coordinate diagnostic to Markdown coordinates. */
function mapRawDiagnostic(raw: RawDiagnostic, vf: VirtualFile): KiiraDiagnostic {
	const { snippet } = vf
	const base: KiiraDiagnostic = {
		severity: raw.severity,
		code: raw.code,
		message: raw.message,
		source: "typescript",
		markdownFile: snippet.markdownFile,
		// Fallback: anchor to the opening fence when there is no usable position.
		markdownRange: { start: snippet.markdownRange.start, end: snippet.markdownRange.start },
		virtualFile: vf.fileName,
	}

	if (!raw.start) {
		return base
	}

	const startLC = raw.start
	const endLC = raw.end ?? raw.start
	base.virtualRange = {
		start: { line: startLC.line, character: startLC.character },
		end: { line: endLC.line, character: endLC.character },
	}

	const markdownRange = mapVirtualRange(vf.mappings, startLC, endLC)
	if (!markdownRange) {
		// The diagnostic lives in generated fixture code; anchor it to the fence.
		base.generated = true
		return base
	}
	base.markdownRange = markdownRange
	return base
}

export interface CheckVirtualFilesInput {
	cwd: string
	virtualFiles: VirtualFile[]
	config: Partial<KiiraConfig>
}

/**
 * Build the base compiler options Kiira checks with: the project tsconfig (or
 * defaults), the unused-symbol toggle, and — in workspace mode — the monorepo's
 * package `paths`/`typeRoots` so its packages resolve from the repo root. Shared by
 * checking and code-fixes so both see an identical project.
 */
export async function buildBaseOptions(
	cwd: string,
	resolved: ReturnType<typeof resolveConfig>,
	// `replaceTsconfig` (a TypeScript hook's request) starts from Kiira's defaults, skipping the tsconfig.
	{ replaceTsconfig = false }: { replaceTsconfig?: boolean } = {}
): Promise<ts.CompilerOptions> {
	selectTypescript(cwd)
	const tsconfigPath = replaceTsconfig ? undefined : resolveTsconfigPath(cwd, resolved.tsconfig)
	const options = loadCompilerOptions(tsconfigPath)

	// Doc snippets routinely declare values they don't use; suppress unused-symbol
	// diagnostics (TS6133 etc.) by default. When the user opts in, force the checks
	// on regardless of the project tsconfig so the setting always takes effect.
	options.noUnusedLocals = resolved.checkUnusedSymbols
	options.noUnusedParameters = resolved.checkUnusedSymbols

	// In workspace mode (the default), make the monorepo's packages and their
	// dependencies resolvable from the repo root, where a pnpm isolated
	// node_modules would otherwise hide them. User-defined paths win on conflict.
	if (resolved.packageMode === "workspace") {
		const ws = await buildWorkspaceResolution(cwd)
		if (ws) {
			options.baseUrl = options.baseUrl ?? ws.baseUrl
			options.paths = { ...ws.paths, ...(options.paths ?? {}) }
			// Make @types packages installed in any workspace package discoverable
			// (e.g. @types/react living in packages/ai-react/node_modules/@types).
			if (ws.typeRoots.length > 0) {
				options.typeRoots = [...new Set([...(options.typeRoots ?? []), ...ws.typeRoots])]
			}
		}
	}

	// External packages (doc-only deps installed into node_modules/.kiira) resolve
	// in both workspace and packed modes. Append after workspace fallbacks so real
	// workspace packages and user paths still win. Pure: never installs here — the
	// CLI populates the cache via ensureExternalPackages before checking.
	const externalPackages = collectExternalPackages(resolved)
	const external = externalResolution(cwd, externalPackages)
	if (external) {
		options.baseUrl = options.baseUrl ?? cwd
		const existingStar = options.paths?.["*"] ?? []
		options.paths = { ...(options.paths ?? {}), "*": [...existingStar, external.nodeModulesGlob] }
		if (external.typeRoots.length > 0) {
			options.typeRoots = [...new Set([...(options.typeRoots ?? []), ...external.typeRoots])]
		}
	}
	return options
}

/** What the engine produced for a set of virtual files. */
interface CheckerRun {
	diagnostics: KiiraDiagnostic[]
	/** One program per partition, for the engine that builds one in-process (classic). */
	programs: CheckedProgram[]
	/** The engine that ran; `undefined` when there was nothing to check. */
	engine?: CheckerEngine["name"]
}

/** TS codes behind `noUnusedLocals`/`noUnusedParameters`: the diagnostics `unused-symbols` owns. */
const UNUSED_SYMBOL_CODES = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205])

/**
 * Apply the two toggle rules to the engine's diagnostics, per Markdown file: an
 * unresolved relative import is dropped unless `relative-imports` is on (they usually
 * point at an imaginary sibling-snippet file or the reader's own project), and a rule
 * set to "warn" downgrades the diagnostics it owns.
 */
function applyToggleRules(diagnostics: KiiraDiagnostic[], resolved: ResolvedKiiraConfig): KiiraDiagnostic[] {
	const settingsByFile = new Map<string, ReturnType<typeof rulesForFile>>()
	const kept: KiiraDiagnostic[] = []
	for (const diagnostic of diagnostics) {
		let settings = settingsByFile.get(diagnostic.markdownFile)
		if (!settings) {
			settings = rulesForFile(resolved, diagnostic.markdownFile)
			settingsByFile.set(diagnostic.markdownFile, settings)
		}
		const owner = isUnresolvedRelativeImport(diagnostic)
			? "relative-imports"
			: typeof diagnostic.code === "number" && UNUSED_SYMBOL_CODES.has(diagnostic.code)
				? "unused-symbols"
				: undefined
		const level = owner ? settings[owner]?.severity : undefined
		if (level === "off" && owner === "relative-imports") {
			continue
		}
		kept.push(level === "warn" && diagnostic.severity === "error" ? { ...diagnostic, severity: "warning" } : diagnostic)
	}
	return kept
}

/** A document as a TypeScript hook sees it. */
interface HookDocument {
	text: string
	snippets: ExtractedSnippet[]
}

/**
 * A hook document built from checked virtual files, for callers without the parsed
 * document (`checkVirtualFiles`, editor quick fixes). Its snippets are the checked
 * fences (a group contributes its lead fence only), and `text` is the caller's
 * document text when it has one, else those fences' code joined by blank lines.
 */
export function documentFromVirtualFiles(file: string, virtualFiles: VirtualFile[], text?: string): HookDocument {
	const snippets = new Map<string, ExtractedSnippet>()
	for (const vf of virtualFiles) {
		if (vf.snippet.markdownFile === file) {
			snippets.set(vf.snippet.id, vf.snippet)
		}
	}
	const list = [...snippets.values()]
	return { text: text ?? list.map((snippet) => snippet.code).join("\n\n"), snippets: list }
}

/**
 * Resolves the compiler options each Markdown file is checked with, running the
 * TypeScript hooks. Shared by checking and code fixes so both see identical options.
 * Base options are built once per `replaceTsconfig` value.
 */
export function createOptionsResolver(
	cwd: string,
	resolved: ResolvedKiiraConfig,
	shared?: { project: KiiraProject; fs: KiiraFs }
) {
	const bases = new Map<boolean, Promise<ts.CompilerOptions>>()
	let env = shared
	return {
		/** The merged hook result for a document, or `undefined` when no hook applies. */
		async hookFor(file: string, doc: HookDocument): Promise<TypescriptHookOutcome | undefined> {
			if (!hasTypescriptHooks(resolved)) {
				return undefined
			}
			env ??= { project: await createProject(cwd), fs: createRuleFs(cwd).fs }
			return runTypescriptHooks(resolved, { file, ...doc, ...env })
		},
		async optionsFor(file: string, hook?: TypescriptHookOutcome): Promise<ts.CompilerOptions> {
			const replaceTsconfig = hook?.replaceTsconfig ?? false
			let base = bases.get(replaceTsconfig)
			if (!base) {
				base = buildBaseOptions(cwd, resolved, { replaceTsconfig })
				bases.set(replaceTsconfig, base)
			}
			return optionsForFile(cwd, await base, resolved, file, hook)
		},
	}
}

/** The snippet whose code contains the diagnostic, else the checked file's own (lead) snippet. */
function snippetForDiagnostic(
	diagnostic: KiiraDiagnostic,
	vf: VirtualFile,
	candidates: ExtractedSnippet[]
): ExtractedSnippet {
	const line = diagnostic.markdownRange.start.line
	return (
		candidates.find(
			(s) => s.markdownFile === vf.snippet.markdownFile && line >= s.codeStart.line && line < s.markdownRange.end.line
		) ?? vf.snippet
	)
}

async function runChecker(
	cwd: string,
	virtualFiles: VirtualFile[],
	resolved: ResolvedKiiraConfig,
	run?: RuleRun,
	documents: RuleDocument[] = []
): Promise<CheckerRun> {
	if (virtualFiles.length === 0) {
		return { diagnostics: [], programs: [] }
	}
	selectTypescript(cwd)

	const resolver = createOptionsResolver(cwd, resolved, run)
	const filesByMarkdown = new Map<string, VirtualFile[]>()
	for (const vf of virtualFiles) {
		const list = filesByMarkdown.get(vf.snippet.markdownFile) ?? []
		list.push(vf)
		filesByMarkdown.set(vf.snippet.markdownFile, list)
	}
	const parsed = new Map(documents.map((doc) => [doc.file, doc]))
	const hookDocs = new Map<string, HookDocument>()
	for (const [file, files] of filesByMarkdown) {
		hookDocs.set(file, parsed.get(file) ?? documentFromVirtualFiles(file, files))
	}

	// Partition by the options each file ends up with (tsconfig or defaults, matching
	// `overrides`, and any TypeScript hook) and run a separate program per distinct
	// option set, so e.g. Solid docs can use `jsxImportSource: "solid-js"` while React
	// docs use React's JSX.
	const hooks = new Map<string, TypescriptHookOutcome | undefined>()
	const partitions = new Map<string, OptionsPartition>()
	for (const [file, doc] of hookDocs) {
		const hook = await resolver.hookFor(file, doc)
		hooks.set(file, hook)
		const options = await resolver.optionsFor(file, hook)
		const key = stableStringify(options)
		let partition = partitions.get(key)
		if (!partition) {
			partition = { options, virtualFiles: [] }
			partitions.set(key, partition)
		}
		partition.virtualFiles.push(...(filesByMarkdown.get(file) ?? []))
	}

	// Pick the checker engine once (classic bundled TS, or the project's native
	// TypeScript 7), then collect each partition's diagnostics through it.
	const engine = await resolveEngine(cwd, resolved.engine)
	const vfByName = new Map(virtualFiles.map((vf) => [vf.fileName, vf]))

	// Keep each partition's program only when a program rule will use it, so it can
	// be garbage-collected otherwise.
	const markdownFiles = [...new Set(virtualFiles.map((vf) => vf.snippet.markdownFile))]
	const keepPrograms = enabledProgramRuleIds(resolved, markdownFiles).length > 0

	const diagnostics: KiiraDiagnostic[] = []
	const programs: CheckedProgram[] = []
	for (const partition of partitions.values()) {
		const raws = await engine.collect(
			partition.virtualFiles,
			partition.options,
			keepPrograms ? (program) => programs.push({ program, virtualFiles: partition.virtualFiles }) : undefined
		)
		for (const raw of raws) {
			const vf = vfByName.get(raw.virtualFile)
			if (!vf) {
				continue
			}
			const diagnostic = mapRawDiagnostic(raw, vf)
			const file = vf.snippet.markdownFile
			const filters = hooks.get(file)?.filters ?? []
			if (filters.length > 0) {
				const snippet = snippetForDiagnostic(diagnostic, vf, hookDocs.get(file)?.snippets ?? [])
				if (!filters.every((keep) => keep(diagnostic, { snippet, file }))) {
					continue
				}
			}
			diagnostics.push(diagnostic)
		}
	}

	return { diagnostics: applyToggleRules(diagnostics, resolved), programs, engine: engine.name }
}

/** Type-check the given virtual files and return diagnostics mapped to Markdown. */
export async function checkVirtualFiles({
	cwd,
	virtualFiles,
	config,
}: CheckVirtualFilesInput): Promise<KiiraDiagnostic[]> {
	return (await runChecker(cwd, virtualFiles, resolveConfig(config))).diagnostics
}

interface OptionsPartition {
	options: ts.CompilerOptions
	virtualFiles: VirtualFile[]
}

/** Convert a single override's JSON compilerOptions to a `ts.CompilerOptions`, throwing on invalid input. */
function convertOverrideOptions(
	cwd: string,
	override: ReturnType<typeof resolveConfig>["overrides"][number]
): ts.CompilerOptions {
	const ts = getTypescript()
	// `include` (the glob), `defaultGroup` (a Kiira grouping concept),
	// `externalPackages` (doc-only deps), and the rule/preset/fence settings are
	// not tsconfig options; strip them so only real compiler options are converted.
	const {
		include: _include,
		defaultGroup: _defaultGroup,
		externalPackages: _externalPackages,
		codeFenceLanguages: _codeFenceLanguages,
		rules: _rules,
		presets: _presets,
		...compilerOptions
	} = override
	const { options, errors } = ts.convertCompilerOptionsFromJson(compilerOptions, cwd)
	if (errors.length > 0) {
		const messages = errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ")
		throw new Error(`Invalid compilerOptions in override ${JSON.stringify(override.include)}: ${messages}`)
	}
	return options
}

/**
 * The compiler options for one Markdown file: the base options, the file's
 * `unused-symbols` level (as checking applies it), then every matching override's
 * own compilerOptions in order, then the TypeScript hook's. The caller builds
 * `baseOptions` with the hook's `replaceTsconfig` (see {@link createOptionsResolver}).
 */
export function optionsForFile(
	cwd: string,
	baseOptions: ts.CompilerOptions,
	// The bare overrides array is the pre-rules signature, kept for existing callers.
	config: ResolvedKiiraConfig | ResolvedKiiraConfig["overrides"],
	markdownFile: string,
	hook?: TypescriptHookOutcome
): ts.CompilerOptions {
	let options = { ...baseOptions }
	let overrides = config as ResolvedKiiraConfig["overrides"]
	if (!Array.isArray(config)) {
		const unused = rulesForFile(config, markdownFile)["unused-symbols"]?.severity !== "off"
		options = { ...options, noUnusedLocals: unused, noUnusedParameters: unused }
		overrides = config.overrides
	}
	for (const override of overrides) {
		if (picomatch(override.include)(markdownFile)) {
			options = { ...options, ...convertOverrideOptions(cwd, override) }
		}
	}
	return hook ? applyTypescriptHook(cwd, options, hook) : options
}

/** TS code for "Cannot find module 'X'". */
const MODULE_NOT_FOUND = 2307

/**
 * True for a "cannot find module './x'" diagnostic whose specifier is relative —
 * a doc snippet importing from an imaginary sibling file or the reader's project,
 * not a real (checkable) package import.
 */
function isUnresolvedRelativeImport(diagnostic: KiiraDiagnostic): boolean {
	if (diagnostic.code !== MODULE_NOT_FOUND) {
		return false
	}
	const specifier = /Cannot find module '([^']+)'/.exec(diagnostic.message)?.[1]
	return specifier ? specifier.startsWith(".") : false
}

export interface CollectSuggestionsInput {
	cwd: string
	files: string[]
	snippets: KiiraCheckResult["snippets"]
	/** Diagnostics already produced for these files (extraction + fixture + TS). */
	diagnostics: KiiraDiagnostic[]
	config: Partial<KiiraConfig>
}

/**
 * Compute the `language-tag`, `group`, and `jsx-framework` rule diagnostics for an
 * already-checked set of files. The pipeline runs these as rules; this wrapper keeps
 * the original entry point for callers that drive the steps themselves. It also
 * returns the `language-tag` warnings, which `createVirtualFiles` no longer reports.
 */
export async function collectSuggestions(input: CollectSuggestionsInput): Promise<KiiraDiagnostic[]> {
	const { cwd, files, snippets, diagnostics } = input
	const config = resolveConfig(input.config)
	const forFile = (file: string) => ({
		file,
		snippets: snippets.filter((s) => s.markdownFile === file),
		diagnostics: diagnostics.filter((d) => d.markdownFile === file),
		config,
	})
	const enabled = (id: string, file: string): "warn" | "error" | undefined => {
		const level = rulesForFile(config, file)[id]?.severity
		return level === "warn" || level === "error" ? level : undefined
	}

	const languageTag: KiiraDiagnostic[] = []
	const grouping: KiiraDiagnostic[] = []
	const jsx: KiiraDiagnostic[] = []
	for (const file of files) {
		const level = enabled("language-tag", file)
		if (level) {
			for (const report of languageTagSuggestions(forFile(file).snippets, config)) {
				languageTag.push(reportToDiagnostic("language-tag", level, file, report))
			}
		}
	}
	for (const file of files) {
		const level = enabled("group", file)
		if (level) {
			for (const report of await groupSuggestions({ cwd, ...forFile(file) })) {
				grouping.push(reportToDiagnostic("group", level, file, report))
			}
		}
	}
	for (const file of files) {
		const level = enabled("jsx-framework", file)
		if (level) {
			for (const report of jsxFrameworkSuggestions(forFile(file))) {
				jsx.push(reportToDiagnostic("jsx-framework", level, file, report))
			}
		}
	}
	return [...languageTag, ...grouping, ...jsx]
}

async function parseDocuments(
	files: readonly string[],
	read: (file: string) => string | Promise<string>,
	config: ResolvedKiiraConfig,
	markdownUri?: string
): Promise<RuleDocument[]> {
	const documents: RuleDocument[] = []
	// The MDX parser loads on demand; parsing is synchronous, so preload it here.
	await loadMdxSupportFor(files)
	for (const file of files) {
		const text = await read(file)
		const parsed = parseDocument(file, text)
		const snippets = extractSnippets({ mdast: parsed.mdast, markdownFile: file, config, markdownUri })
		documents.push({ file, text, snippets, ...parsed })
	}
	return documents
}

/**
 * Rules whose output belongs to extraction, so it stays ahead of the type-check
 * diagnostics in a document's list, as it was before they became rules.
 */
const EXTRACTION_RULES = new Set(["parse-error", "fence-meta"])

/**
 * Type-check the documents and run their document and program rules. Returns the
 * diagnostics in order: extraction rules, fixture, TypeScript, then the other rules.
 */
async function analyzeDocuments(
	cwd: string,
	run: RuleRun,
	documents: RuleDocument[]
): Promise<{ virtualFiles: VirtualFile[]; diagnostics: KiiraDiagnostic[] }> {
	const { virtualFiles, diagnostics: fixtureDiagnostics } = await createVirtualFiles({
		cwd,
		snippets: documents.flatMap((doc) => doc.snippets),
		config: run.config,
	})
	const checked = await runChecker(cwd, virtualFiles, run.config, run, documents)

	const typescriptByFile = new Map<string, KiiraDiagnostic[]>()
	for (const diagnostic of checked.diagnostics) {
		const list = typescriptByFile.get(diagnostic.markdownFile) ?? []
		list.push(diagnostic)
		typescriptByFile.set(diagnostic.markdownFile, list)
	}

	const extraction: KiiraDiagnostic[] = []
	const rules: KiiraDiagnostic[] = []
	for (const doc of documents) {
		const typescript = typescriptByFile.get(doc.file) ?? []
		for (const diagnostic of await runDocumentRules(run, doc, typescript)) {
			if (typeof diagnostic.code === "string" && EXTRACTION_RULES.has(diagnostic.code)) {
				extraction.push(diagnostic)
			} else {
				rules.push(diagnostic)
			}
		}
		const program = checked.programs.find((p) => p.virtualFiles.some((vf) => vf.snippet.markdownFile === doc.file))
		if (program) {
			rules.push(...(await runProgramRules(run, doc, typescript, program)))
		}
	}
	if (checked.engine === "native") {
		const skipped = programRulesSkipped(
			run.config,
			documents.map((doc) => doc.file)
		)
		if (skipped) {
			rules.push(skipped)
		}
	}

	return { virtualFiles, diagnostics: [...extraction, ...fixtureDiagnostics, ...checked.diagnostics, ...rules] }
}

export interface CheckMarkdownFilesInput {
	cwd: string
	files?: string[]
	config?: Partial<KiiraConfig>
	/** Rule levels that beat every config layer (the CLI's `--rule`). */
	ruleOverrides?: Record<string, RuleSeverity>
}

/** End-to-end: discover, extract, virtualize, and type-check Markdown files, then run the rules. */
export async function checkMarkdownFiles(input: CheckMarkdownFilesInput): Promise<KiiraCheckResult> {
	const { cwd } = input
	selectTypescript(cwd)
	const userConfig = input.config ?? (await loadConfig(cwd))
	const resolved = resolveConfig(userConfig, input.ruleOverrides)
	const { fs, reads } = createRuleFs(cwd)
	const run: RuleRun = { config: resolved, project: await createProject(cwd), fs }

	const files =
		input.files ??
		(await discoverMarkdownFiles({
			cwd,
			include: [
				...resolved.include,
				...resolved.presets.flatMap((preset) =>
					typeof preset.include === "function" ? preset.include(run.project) : []
				),
			],
			exclude: resolved.exclude,
		}))
	if (files.length === 0 && resolved.allowEmpty) {
		const stats = { markdownFiles: 0, snippets: 0, checked: 0, ignored: 0, errors: 0, warnings: 0 }
		return { snippets: [], virtualFiles: [], diagnostics: [], stats, sources: {}, skipped: true }
	}

	const documents = await parseDocuments(files, (file) => readFile(join(cwd, file), "utf8"), resolved)
	const analyzed = await analyzeDocuments(cwd, run, documents)
	const diagnostics = [...analyzed.diagnostics, ...(await runProjectRules(run, files))]
	const snippets = documents.flatMap((doc) => doc.snippets)

	const sources = collectSources(cwd, reads, documents)
	const errors = diagnostics.filter((d) => d.severity === "error").length
	const warnings = diagnostics.filter((d) => d.severity === "warning").length

	return {
		snippets,
		virtualFiles: analyzed.virtualFiles,
		diagnostics,
		sources,
		stats: {
			markdownFiles: files.length,
			snippets: snippets.length,
			checked: analyzed.virtualFiles.length,
			ignored: snippets.length - analyzed.virtualFiles.length,
			errors,
			warnings,
		},
	}
}

/** The exact text of every file a run read, keyed by cwd-relative posix path. */
function collectSources(
	cwd: string,
	reads: Map<string, string | undefined>,
	documents: Array<{ file: string; text: string }>
): Record<string, string> {
	const sources: Record<string, string> = {}
	for (const [path, text] of reads) {
		if (text !== undefined) {
			sources[relative(cwd, resolve(cwd, path)).split(sep).join("/")] = text
		}
	}
	for (const doc of documents) {
		sources[doc.file] = doc.text
	}
	return sources
export interface CheckInput {
	cwd: string
	/** Markdown files relative to `cwd`; defaults to the config's `include`. */
	files?: string[]
	/** Used as is; when omitted, the config is loaded from `cwd`. */
	config?: Partial<KiiraConfig>
	/** Added to the config's plugins; one with the same `name` replaces the config's. */
	plugins?: KiiraPlugin[]
}

/** Check Markdown files and run every rule: document, program and project. Experimental. */
export async function check(input: CheckInput): Promise<KiiraCheckResult> {
	const cwd = resolve(input.cwd)
	const config = input.config ?? (await loadConfig(cwd))
	const added = input.plugins ?? []
	const names = new Set(added.map((plugin) => plugin.name))
	const plugins = [...(config.plugins ?? []).filter((plugin) => !names.has(plugin.name)), ...added]
	// Like `kiira check`: install declared doc-only packages so their imports resolve.
	await ensureExternalPackages(cwd, collectExternalPackages(config), { warn: console.warn })
	return checkMarkdownFiles({ cwd, files: input.files, config: { ...config, plugins } })
}

export interface CheckMarkdownTextInput {
	cwd: string
	/** Document path relative to `cwd` (posix), used in diagnostics and naming. */
	markdownFile: string
	/** The (possibly unsaved) document text. */
	text: string
	config: Partial<KiiraConfig>
	markdownUri?: string
	ruleOverrides?: Record<string, RuleSeverity>
}

export interface CheckMarkdownTextResult {
	diagnostics: KiiraDiagnostic[]
	virtualFiles: VirtualFile[]
	snippets: ExtractedSnippet[]
	/** The text the check read: the document itself and each file a rule read through `ctx.fs`. Keys are cwd-relative posix paths. */
	sources: Record<string, string>
}

/**
 * Check one in-memory Markdown document, so unsaved edits are reflected. Runs the
 * document and program rules but not project rules, which need the whole run.
 */
export async function checkMarkdownText(input: CheckMarkdownTextInput): Promise<CheckMarkdownTextResult> {
	const { cwd, markdownFile } = input
	selectTypescript(cwd)
	const config = resolveConfig(input.config, input.ruleOverrides)
	const { fs, reads } = createRuleFs(cwd)
	const run: RuleRun = { config, project: await createProject(cwd), fs }
	const documents = await parseDocuments([markdownFile], () => input.text, config, input.markdownUri)
	const { virtualFiles, diagnostics } = await analyzeDocuments(cwd, run, documents)
	return {
		diagnostics,
		virtualFiles,
		snippets: documents.flatMap((doc) => doc.snippets),
		sources: collectSources(cwd, reads, documents),
	}
}
