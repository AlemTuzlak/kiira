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

// Directory holding TypeScript's `lib.*.d.ts` files. When TypeScript is bundled
// into a host (the VS Code extension), `ts.sys.getExecutingFilePath()` no longer
// points next to the real lib files, so the default-lib location is wrong and every
// global (`JSON`, `Date`, DOM types) is reported as undefined. A host that bundles
// TypeScript ships the lib files and calls `setTypescriptLibDir` to point here.
let typescriptLibDir: string | undefined

/** Override where TypeScript loads its default `lib.*.d.ts` from (for bundled hosts). */
export function setTypescriptLibDir(dir: string | undefined): void {
	typescriptLibDir = dir
}

/** Apply the configured lib-directory override to a compiler/language-service host. */
export function applyLibDirOverride(host: {
	getDefaultLibLocation?: () => string
	getDefaultLibFileName: (options: ts.CompilerOptions) => string
}): void {
	if (!typescriptLibDir) {
		return
	}
	const dir = typescriptLibDir
	host.getDefaultLibLocation = () => dir
	host.getDefaultLibFileName = (options) => join(dir, ts.getDefaultLibFileName(options))
}

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

	applyLibDirOverride(host)
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

/**
 * Build the base compiler options Typedown checks with: the project tsconfig (or
 * defaults), the unused-symbol toggle, and — in workspace mode — the monorepo's
 * package `paths`/`typeRoots` so its packages resolve from the repo root. Shared by
 * checking and code-fixes so both see an identical project.
 */
export async function buildBaseOptions(
	cwd: string,
	resolved: ReturnType<typeof resolveConfig>
): Promise<ts.CompilerOptions> {
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
	return options
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
	const options = await buildBaseOptions(cwd, resolved)

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

/** Convert a single override's JSON compilerOptions to a `ts.CompilerOptions`, throwing on invalid input. */
function convertOverrideOptions(
	cwd: string,
	override: ReturnType<typeof resolveConfig>["overrides"][number]
): ts.CompilerOptions {
	const { include: _include, ...compilerOptions } = override
	const { options, errors } = ts.convertCompilerOptionsFromJson(compilerOptions, cwd)
	if (errors.length > 0) {
		const messages = errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ")
		throw new Error(`Invalid compilerOptions in override ${JSON.stringify(override.include)}: ${messages}`)
	}
	return options
}

/** Apply every override whose glob matches `markdownFile` (in order) on top of the base options. */
export function optionsForFile(
	cwd: string,
	baseOptions: ts.CompilerOptions,
	overrides: ReturnType<typeof resolveConfig>["overrides"],
	markdownFile: string
): ts.CompilerOptions {
	let options = { ...baseOptions }
	for (const override of overrides) {
		if (picomatch(override.include)(markdownFile)) {
			options = { ...options, ...convertOverrideOptions(cwd, override) }
		}
	}
	return options
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
	const converted = overrides.map((o) => convertOverrideOptions(cwd, o))

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

// Identity of an error for baseline membership: code + full position + message,
// so two distinct errors that merely share a line and TS code (e.g. two unresolved
// names on one line) are not conflated when deciding if grouping introduced a new one.
const errorKey = (d: TypedownDiagnostic): string =>
	`${d.code}@${d.markdownRange.start.line}:${d.markdownRange.start.character}:${d.message}`

/** Whether a diagnostic's line falls within a snippet's code span. */
function isWithinSnippet(diagnostic: TypedownDiagnostic, snippet: TypedownCheckResult["snippets"][number]): boolean {
	const start = snippet.codeStart.line
	const end = start + snippet.code.split("\n").length - 1
	const line = diagnostic.markdownRange.start.line
	return line >= start && line <= end
}

/** Names a snippet reports as "cannot find" when checked standalone, parsed from its errors. */
function unresolvedNames(
	snippet: TypedownCheckResult["snippets"][number],
	docErrors: TypedownDiagnostic[]
): Set<string> {
	const names = new Set<string>()
	for (const d of docErrors) {
		if (d.markdownFile !== snippet.markdownFile || !isWithinSnippet(d, snippet)) {
			continue
		}
		if (typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code)) {
			const name = /Cannot find name '([^']+)'/.exec(d.message)?.[1]
			if (name) {
				names.add(name)
			}
		}
	}
	return names
}

/**
 * Plan minimal snippet groups. For each snippet, link it to the nearest earlier
 * snippet that declares a name the snippet *actually fails to resolve standalone*
 * (its "cannot find name" errors) — so already-valid snippets are never dragged in
 * as consumers, only used as providers. A redeclare guard refuses to merge two
 * components that declare a common top-level name, so two independent `const x = …`
 * examples never collapse into one redeclaring group even when they share a
 * reference. Returns only multi-member clusters, each as sorted indices.
 */
function planMinimalGroups(snippets: TypedownCheckResult["snippets"], docErrors: TypedownDiagnostic[]): number[][] {
	const symbols = snippets.map((s) => analyzeSnippet(s.code, s.lang))
	const missing = snippets.map((s) => unresolvedNames(s, docErrors))

	const parent = snippets.map((_, i) => i)
	// Per-root union of the component's declared top-level names, for the guard.
	const declaresOf = symbols.map((sym) => new Set(sym.declares))
	const find = (x: number): number => {
		let root = x
		while (parent[root] !== root) {
			root = parent[root]
		}
		parent[x] = root
		return root
	}
	const tryUnion = (a: number, b: number): void => {
		const ra = find(a)
		const rb = find(b)
		if (ra === rb) {
			return
		}
		// Redeclare guard: merging two snippets that both declare the same name
		// would only produce a TS2451, so keep independent examples apart.
		for (const name of declaresOf[ra]) {
			if (declaresOf[rb].has(name)) {
				return
			}
		}
		parent[ra] = rb
		for (const name of declaresOf[ra]) {
			declaresOf[rb].add(name)
		}
	}

	for (let i = 0; i < snippets.length; i += 1) {
		for (const name of missing[i]) {
			// Link only to the *nearest* earlier declarer — the most likely intended
			// provider. We stop at it even if the redeclare guard then refuses the
			// merge: a snippet whose nearest provider conflicts is an independent
			// example (it redeclares a shared name), not a continuation, so reaching
			// further back to a distant definer would only over-group.
			for (let j = i - 1; j >= 0; j -= 1) {
				if (symbols[j].declares.has(name)) {
					tryUnion(i, j)
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

		// Probe every candidate cluster first; keep only those that verify, so the
		// `-N` slug suffix reflects the number of *surviving* groups (a doc with one
		// real group gets a clean `group=<doc>`, not `group=<doc>-1`).
		const survivors: TypedownCheckResult["snippets"][] = []
		for (const plan of planMinimalGroups(checkable, docErrors)) {
			const members = plan.map((i) => checkable[i])
			const memberErrors = docErrors.filter((d) => members.some((m) => isWithinSnippet(d, m)))
			const baseline = new Set(memberErrors.map(errorKey))
			const baselineCannotFind = memberErrors.filter(
				(d) => typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code)
			).length

			// Verify the cluster: type-check it together and require it to strictly
			// reduce the "cannot find name" errors while introducing no new error of
			// any kind (a new TS2451 redeclare would mean we merged too much).
			const probe = members.map((s) => ({ ...s, meta: { ...s.meta, group: "__typedown_probe__" } }))
			const { virtualFiles } = await createVirtualFiles({ cwd, snippets: probe, config })
			const grouped = (await checkVirtualFiles({ cwd, virtualFiles, config })).filter((d) => d.severity === "error")
			const groupedCannotFind = grouped.filter((d) => typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code)).length
			if (grouped.some((d) => !baseline.has(errorKey(d))) || groupedCannotFind >= baselineCannotFind) {
				continue
			}
			survivors.push(members)
		}

		survivors.forEach((members, index) => {
			const slug = survivors.length > 1 ? `${groupSlug(file)}-${index + 1}` : groupSlug(file)
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
		})
	}

	return suggestions
}

export interface CollectSuggestionsInput {
	cwd: string
	files: string[]
	snippets: TypedownCheckResult["snippets"]
	/** Diagnostics already produced for these files (extraction + fixture + TS). */
	diagnostics: TypedownDiagnostic[]
	config: Partial<TypedownConfig>
}

/**
 * Compute Typedown's suggestion diagnostics (group= and jsxImportSource) for an
 * already-checked set of files. Shared by the CLI's whole-project check and the
 * editor's single-document check so both surface the same actionable fixes.
 */
export async function collectSuggestions(input: CollectSuggestionsInput): Promise<TypedownDiagnostic[]> {
	const { cwd, files, snippets, diagnostics, config } = input
	const resolved = resolveConfig(config)
	const grouping = await suggestGrouping({ cwd, files, snippets, diagnostics, config, resolved })
	const jsx = suggestFrameworkJsx(files, snippets, diagnostics, resolved)
	return [...grouping, ...jsx]
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

	// Suggest grouping (group=) for ungrouped continuation snippets and a
	// per-framework jsxImportSource override for JSX that fails for lack of the
	// right runtime types (TS7026). Shared with the editor's single-doc path.
	diagnostics.push(...(await collectSuggestions({ cwd, files, snippets, diagnostics, config: userConfig })))

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
