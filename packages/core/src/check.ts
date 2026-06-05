import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import picomatch from "picomatch"
import ts from "typescript"
import { analyzeSnippet } from "./analyze"
import { loadConfig, resolveConfig } from "./config"
import { discoverMarkdownFiles } from "./discover"
import { extractSnippetsFromContent } from "./extract"
import type { TypedownCheckResult, TypedownConfig, TypedownDiagnostic, TypedownLanguage, VirtualFile } from "./types"
import { createVirtualFiles, isCheckable, mapVirtualLine } from "./virtual"
import { buildWorkspaceResolution } from "./workspace"

/** TS codes meaning "cannot find name X" — the signature of a continuation snippet. */
const CANNOT_FIND_NAME = new Set([2304, 2552])

function groupSlug(markdownFile: string): string {
	const base = (markdownFile.split(/[\\/]/).pop() ?? markdownFile).replace(/\.[^.]+$/, "")
	return (
		base
			.replace(/[^a-zA-Z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase() || "group"
	)
}

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	jsx: ts.JsxEmit.ReactJSX,
	strict: true,
	esModuleInterop: true,
	forceConsistentCasingInFileNames: true,
	allowJs: true,
	checkJs: true,
	skipLibCheck: true,
	noEmit: true,
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
	if (!tsconfigPath) {
		return { ...DEFAULT_COMPILER_OPTIONS }
	}
	const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
	if (read.error || !read.config) {
		return { ...DEFAULT_COMPILER_OPTIONS }
	}
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfigPath))
	// We never emit, and lib checking is the consumer's concern, not the docs'.
	return { ...parsed.options, noEmit: true, skipLibCheck: parsed.options.skipLibCheck ?? true }
}

function scriptKindFor(lang: TypedownLanguage): ts.ScriptKind {
	switch (lang) {
		case "tsx":
			return ts.ScriptKind.TSX
		case "jsx":
			return ts.ScriptKind.JSX
		case "js":
			return ts.ScriptKind.JS
		default:
			return ts.ScriptKind.TS
	}
}

function categoryToSeverity(category: ts.DiagnosticCategory): TypedownDiagnostic["severity"] {
	switch (category) {
		case ts.DiagnosticCategory.Error:
			return "error"
		case ts.DiagnosticCategory.Warning:
			return "warning"
		default:
			return "info"
	}
}

/** Build a TS compiler host that overlays in-memory virtual files on the real filesystem. */
function createOverlayHost(options: ts.CompilerOptions, virtualFiles: VirtualFile[]): ts.CompilerHost {
	const host = ts.createCompilerHost(options, true)
	const caseSensitive = host.useCaseSensitiveFileNames()
	const normalize = (file: string): string => {
		const slashed = file.replace(/\\/g, "/")
		return caseSensitive ? slashed : slashed.toLowerCase()
	}

	const overlay = new Map<string, VirtualFile>()
	for (const vf of virtualFiles) {
		overlay.set(normalize(vf.fileName), vf)
	}

	const originalGetSourceFile = host.getSourceFile.bind(host)
	host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
		const vf = overlay.get(normalize(fileName))
		if (vf) {
			return ts.createSourceFile(fileName, vf.content, languageVersionOrOptions, true, scriptKindFor(vf.lang))
		}
		return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate)
	}

	const originalFileExists = host.fileExists.bind(host)
	host.fileExists = (fileName) => overlay.has(normalize(fileName)) || originalFileExists(fileName)

	const originalReadFile = host.readFile.bind(host)
	host.readFile = (fileName) => {
		const vf = overlay.get(normalize(fileName))
		return vf ? vf.content : originalReadFile(fileName)
	}

	return host
}

function mapTsDiagnostic(diagnostic: ts.Diagnostic, vf: VirtualFile): TypedownDiagnostic {
	const { snippet } = vf
	const base: TypedownDiagnostic = {
		severity: categoryToSeverity(diagnostic.category),
		code: typeof diagnostic.code === "number" ? diagnostic.code : undefined,
		message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
		source: "typescript",
		markdownFile: snippet.markdownFile,
		// Fallback: anchor to the opening fence when there is no usable position.
		markdownRange: { start: snippet.markdownRange.start, end: snippet.markdownRange.start },
		virtualFile: vf.fileName,
	}

	if (!diagnostic.file || typeof diagnostic.start !== "number") {
		return base
	}

	const startLC = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
	const endLC = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 0))
	base.virtualRange = {
		start: { line: startLC.line, character: startLC.character },
		end: { line: endLC.line, character: endLC.character },
	}

	const mdStart = mapVirtualLine(vf.mappings, startLC.line)
	if (mdStart === null) {
		// The diagnostic lives in generated fixture code; anchor it to the fence.
		base.generated = true
		return base
	}

	const mdEnd = mapVirtualLine(vf.mappings, endLC.line)
	base.markdownRange = {
		start: { line: mdStart, character: startLC.character },
		// When the end maps into generated lines, there is no real end column to
		// map to, so anchor a one-character range at the start rather than adding
		// the (possibly multi-line) virtual span length to the start column.
		end:
			mdEnd !== null && mdEnd >= mdStart
				? { line: mdEnd, character: endLC.character }
				: { line: mdStart, character: startLC.character + 1 },
	}
	return base
}

export interface CheckVirtualFilesInput {
	cwd: string
	virtualFiles: VirtualFile[]
	config: Partial<TypedownConfig>
}

/** Type-check the given virtual files and return diagnostics mapped to Markdown. */
export async function checkVirtualFiles({
	cwd,
	virtualFiles,
	config,
}: CheckVirtualFilesInput): Promise<TypedownDiagnostic[]> {
	if (virtualFiles.length === 0) {
		return []
	}

	const resolved = resolveConfig(config)
	const tsconfigPath = resolveTsconfigPath(cwd, resolved.tsconfig)
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

	// Partition by matching `overrides` (per-glob compiler options) and run a
	// separate program per distinct option set, so e.g. Solid docs can use
	// `jsxImportSource: "solid-js"` while React docs use React's JSX.
	const partitions = partitionByOverrides(cwd, virtualFiles, options, resolved.overrides)

	const diagnostics: TypedownDiagnostic[] = []
	for (const partition of partitions) {
		diagnostics.push(...collectProgramDiagnostics(partition.virtualFiles, partition.options))
	}

	// Unresolved relative imports usually point at an imaginary sibling-snippet
	// file or the reader's own project, so drop them unless explicitly enforced.
	if (resolved.checkRelativeImports) {
		return diagnostics
	}
	return diagnostics.filter((d) => !isUnresolvedRelativeImport(d))
}

interface OverridePartition {
	options: ts.CompilerOptions
	virtualFiles: VirtualFile[]
}

/** Group virtual files by the set of `overrides` matching each one's Markdown file. */
function partitionByOverrides(
	cwd: string,
	virtualFiles: VirtualFile[],
	baseOptions: ts.CompilerOptions,
	overrides: ReturnType<typeof resolveConfig>["overrides"]
): OverridePartition[] {
	if (overrides.length === 0) {
		return [{ options: { ...baseOptions }, virtualFiles }]
	}

	const matchers = overrides.map((o) => picomatch(o.include))
	const converted = overrides.map((o) => {
		const { include: _include, ...compilerOptions } = o
		const { options, errors } = ts.convertCompilerOptionsFromJson(compilerOptions, cwd)
		if (errors.length > 0) {
			const messages = errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ")
			throw new Error(`Invalid compilerOptions in override ${JSON.stringify(o.include)}: ${messages}`)
		}
		return options
	})

	const partitions = new Map<string, OverridePartition>()
	for (const vf of virtualFiles) {
		const file = vf.snippet.markdownFile
		const matched = matchers.map((m) => m(file))
		const key = matched.map((b) => (b ? "1" : "0")).join("")
		let partition = partitions.get(key)
		if (!partition) {
			let options = baseOptions
			matched.forEach((isMatch, i) => {
				if (isMatch) {
					options = { ...options, ...converted[i] }
				}
			})
			partition = { options, virtualFiles: [] }
			partitions.set(key, partition)
		}
		partition.virtualFiles.push(vf)
	}
	return [...partitions.values()]
}

function collectProgramDiagnostics(virtualFiles: VirtualFile[], options: ts.CompilerOptions): TypedownDiagnostic[] {
	const host = createOverlayHost(options, virtualFiles)
	const program = ts.createProgram({ rootNames: virtualFiles.map((v) => v.fileName), options, host })

	const diagnostics: TypedownDiagnostic[] = []
	for (const vf of virtualFiles) {
		const sourceFile = program.getSourceFile(vf.fileName)
		if (!sourceFile) {
			continue
		}
		for (const diagnostic of [
			...program.getSyntacticDiagnostics(sourceFile),
			...program.getSemanticDiagnostics(sourceFile),
		]) {
			diagnostics.push(mapTsDiagnostic(diagnostic, vf))
		}
	}
	return diagnostics
}

// JSX frameworks whose snippets need a non-default `jsxImportSource`, matched by
// a keyword appearing in the file path. (`react` is the TS default, so omitted.)
const FRAMEWORK_JSX: Array<[keyword: string, jsxImportSource: string]> = [
	["preact", "preact"],
	["solid", "solid-js"],
	["vue", "vue"],
]

/** TS code for "JSX element has no JSX.IntrinsicElements" — the wrong-JSX-runtime signature. */
const JSX_NO_INTRINSICS = 7026

/** TS code for "Cannot find module 'X'". */
const MODULE_NOT_FOUND = 2307

/**
 * True for a "cannot find module './x'" diagnostic whose specifier is relative —
 * a doc snippet importing from an imaginary sibling file or the reader's project,
 * not a real (checkable) package import.
 */
function isUnresolvedRelativeImport(diagnostic: TypedownDiagnostic): boolean {
	if (diagnostic.code !== MODULE_NOT_FOUND) {
		return false
	}
	const specifier = /Cannot find module '([^']+)'/.exec(diagnostic.message)?.[1]
	return specifier ? specifier.startsWith(".") : false
}

/**
 * For files emitting TS7026 (JSX checked without the right runtime types), infer
 * the framework from the file path and suggest a `jsxImportSource` override at the
 * broadest matching glob, with a fix that writes it into the config.
 */
function suggestFrameworkJsx(
	files: string[],
	snippets: TypedownCheckResult["snippets"],
	diagnostics: TypedownDiagnostic[],
	resolved: ReturnType<typeof resolveConfig>
): TypedownDiagnostic[] {
	const alreadyOverridden = resolved.overrides.filter((o) => "jsxImportSource" in o).map((o) => picomatch(o.include))
	const suggestions: TypedownDiagnostic[] = []

	// Emit a suggestion per affected file; the config-override fix is de-duplicated
	// (by include + options) when `--fix` applies it, so a shared glob is written once.
	for (const file of files) {
		const jsxError = diagnostics.find((d) => d.markdownFile === file && d.code === JSX_NO_INTRINSICS)
		if (!jsxError || alreadyOverridden.some((m) => m(file))) {
			continue
		}
		const framework = FRAMEWORK_JSX.find(([keyword]) => file.toLowerCase().includes(keyword))
		if (!framework) {
			continue
		}
		const [keyword, jsxImportSource] = framework
		const include = `**/*${keyword}*`
		const anchor = snippets.find((s) => s.markdownFile === file)?.markdownRange.start ?? jsxError.markdownRange.start
		suggestions.push({
			severity: "warning",
			code: "jsx-framework",
			source: "typedown",
			message: `JSX here looks like ${keyword}. Add a \`jsxImportSource: "${jsxImportSource}"\` override for \`${include}\` (run \`typedown check --fix\` to apply).`,
			markdownFile: file,
			markdownRange: { start: anchor, end: anchor },
			fix: { kind: "config-override", include, compilerOptions: { jsxImportSource } },
		})
	}
	return suggestions
}

interface SuggestGroupingInput {
	cwd: string
	files: string[]
	snippets: TypedownCheckResult["snippets"]
	diagnostics: TypedownDiagnostic[]
	config: Partial<TypedownConfig>
	resolved: ReturnType<typeof resolveConfig>
}

const errorKey = (d: TypedownDiagnostic): string => `${d.code}@${d.markdownRange.start.line}`

/** Whether a diagnostic's line falls within a snippet's code span. */
function isWithinSnippet(diagnostic: TypedownDiagnostic, snippet: TypedownCheckResult["snippets"][number]): boolean {
	const start = snippet.codeStart.line
	const end = start + snippet.code.split("\n").length - 1
	const line = diagnostic.markdownRange.start.line
	return line >= start && line <= end
}

/**
 * Plan minimal snippet groups via static analysis: union each snippet with the
 * nearest earlier snippet that declares a name it references but doesn't bind.
 * Independent examples (no shared declarations) stay in separate clusters, so two
 * unrelated `const x = …` blocks never merge into one redeclaring group. Returns
 * only multi-member clusters, each as sorted indices into `snippets`.
 */
function planMinimalGroups(snippets: TypedownCheckResult["snippets"]): number[][] {
	const symbols = snippets.map((s) => analyzeSnippet(s.code, s.lang))
	const parent = snippets.map((_, i) => i)
	const find = (x: number): number => {
		let root = x
		while (parent[root] !== root) {
			root = parent[root]
		}
		parent[x] = root
		return root
	}
	const union = (a: number, b: number): void => {
		parent[find(a)] = find(b)
	}

	for (let i = 0; i < snippets.length; i += 1) {
		for (const ref of symbols[i].references) {
			for (let j = i - 1; j >= 0; j -= 1) {
				if (symbols[j].declares.has(ref)) {
					union(i, j)
					break
				}
			}
		}
	}

	const byRoot = new Map<number, number[]>()
	for (let i = 0; i < snippets.length; i += 1) {
		const root = find(i)
		const members = byRoot.get(root) ?? []
		members.push(i)
		byRoot.set(root, members)
	}
	return [...byRoot.values()].filter((g) => g.length >= 2).map((g) => g.sort((a, b) => a - b))
}

/**
 * For each fully-ungrouped document with "cannot find name" errors, plan minimal
 * dependency clusters and suggest a `group=` tag for each — but only after a
 * type-check probe confirms the cluster removes errors and introduces none. This
 * groups genuine continuations while leaving independent examples alone.
 */
async function suggestGrouping(input: SuggestGroupingInput): Promise<TypedownDiagnostic[]> {
	const { cwd, files, snippets, diagnostics, config, resolved } = input
	const suggestions: TypedownDiagnostic[] = []

	for (const file of files) {
		const checkable = snippets
			.filter((s) => s.markdownFile === file && isCheckable(s, resolved))
			.sort((a, b) => a.markdownRange.start.line - b.markdownRange.start.line)
		// Only attempt on docs the author hasn't already grouped.
		if (checkable.length < 2 || checkable.some((s) => s.meta.group)) {
			continue
		}
		const docErrors = diagnostics.filter((d) => d.markdownFile === file && d.severity === "error")
		if (!docErrors.some((d) => typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code))) {
			continue
		}

		const plans = planMinimalGroups(checkable)
		let emitted = 0
		for (const plan of plans) {
			const members = plan.map((i) => checkable[i])
			const baseline = new Set(docErrors.filter((d) => members.some((m) => isWithinSnippet(d, m))).map(errorKey))

			// Verify the cluster: type-check it together and require strict improvement
			// (removes at least one error, introduces none).
			const probe = members.map((s) => ({ ...s, meta: { ...s.meta, group: "__typedown_probe__" } }))
			const { virtualFiles } = await createVirtualFiles({ cwd, snippets: probe, config })
			const grouped = (await checkVirtualFiles({ cwd, virtualFiles, config })).filter((d) => d.severity === "error")
			if (grouped.some((d) => !baseline.has(errorKey(d))) || grouped.length >= baseline.size) {
				continue
			}

			emitted += 1
			const slug = plans.length > 1 ? `${groupSlug(file)}-${emitted}` : groupSlug(file)
			for (const member of members) {
				suggestions.push({
					severity: "warning",
					code: "group",
					source: "typedown",
					message: `This snippet continues an earlier one. Tag them \`group=${slug}\` to type-check them together (run \`typedown check --fix\` to apply).`,
					markdownFile: file,
					markdownRange: { start: member.markdownRange.start, end: member.markdownRange.start },
					fix: { kind: "fence-meta", line: member.markdownRange.start.line, append: `group=${slug}` },
				})
			}
		}
	}

	return suggestions
}

export interface CheckMarkdownFilesInput {
	cwd: string
	files?: string[]
	config?: Partial<TypedownConfig>
}

/** End-to-end: discover, extract, virtualize, and type-check Markdown files. */
export async function checkMarkdownFiles(input: CheckMarkdownFilesInput): Promise<TypedownCheckResult> {
	const { cwd } = input
	const userConfig = input.config ?? (await loadConfig(cwd))
	const resolved = resolveConfig(userConfig)
	const files =
		input.files ?? (await discoverMarkdownFiles({ cwd, include: resolved.include, exclude: resolved.exclude }))

	const snippets: TypedownCheckResult["snippets"] = []
	const diagnostics: TypedownDiagnostic[] = []

	for (const file of files) {
		const content = await readFile(join(cwd, file), "utf8")
		const extraction = extractSnippetsFromContent({ markdownFile: file, content, config: resolved })
		snippets.push(...extraction.snippets)
		diagnostics.push(...extraction.diagnostics)
	}

	const { virtualFiles, diagnostics: fixtureDiagnostics } = await createVirtualFiles({
		cwd,
		snippets,
		config: userConfig,
	})
	diagnostics.push(...fixtureDiagnostics)
	diagnostics.push(...(await checkVirtualFiles({ cwd, virtualFiles, config: userConfig })))

	// Suggest grouping: for a fully-ungrouped doc whose snippets reference names
	// from each other, check whether grouping resolves it; if so, suggest `group=`.
	diagnostics.push(...(await suggestGrouping({ cwd, files, snippets, diagnostics, config: userConfig, resolved })))

	// Suggest a per-framework jsxImportSource override for files whose JSX fails
	// for lack of the right JSX runtime types (TS7026).
	diagnostics.push(...suggestFrameworkJsx(files, snippets, diagnostics, resolved))

	const errors = diagnostics.filter((d) => d.severity === "error").length
	const warnings = diagnostics.filter((d) => d.severity === "warning").length

	return {
		snippets,
		virtualFiles,
		diagnostics,
		stats: {
			markdownFiles: files.length,
			snippets: snippets.length,
			checked: virtualFiles.length,
			ignored: snippets.length - virtualFiles.length,
			errors,
			warnings,
		},
	}
}
