import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import picomatch from "picomatch"
import ts from "typescript"
import { analyzeSnippet } from "./analyze"
import { loadConfig, resolveConfig } from "./config"
import { discoverMarkdownFiles } from "./discover"
import { type RawDiagnostic, resolveEngine } from "./engine"
import { collectExternalPackages, externalResolution } from "./external"
import { extractSnippetsFromContent } from "./extract"
import type { KiiraCheckResult, KiiraConfig, KiiraDiagnostic, VirtualFile } from "./types"
import { createVirtualFiles, effectiveGroup, isCheckable, mapVirtualLine } from "./virtual"
import { buildWorkspaceResolution } from "./workspace"

// The lib-dir override and the classic overlay host live in `engine.ts` alongside
// the classic engine; re-export the host-facing hooks so consumers (index, vscode)
// keep importing them from `check`.
export { applyLibDirOverride, setTypescriptLibDir } from "./engine"

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

/** Type-check the given virtual files and return diagnostics mapped to Markdown. */
export async function checkVirtualFiles({
	cwd,
	virtualFiles,
	config,
}: CheckVirtualFilesInput): Promise<KiiraDiagnostic[]> {
	if (virtualFiles.length === 0) {
		return []
	}

	const resolved = resolveConfig(config)
	const options = await buildBaseOptions(cwd, resolved)

	// Partition by matching `overrides` (per-glob compiler options) and run a
	// separate program per distinct option set, so e.g. Solid docs can use
	// `jsxImportSource: "solid-js"` while React docs use React's JSX.
	const partitions = partitionByOverrides(cwd, virtualFiles, options, resolved.overrides)

	// Pick the checker engine once (classic bundled TS, or the project's native
	// TypeScript 7), then collect each partition's diagnostics through it.
	const engine = await resolveEngine(cwd, resolved.engine)
	const vfByName = new Map(virtualFiles.map((vf) => [vf.fileName, vf]))

	const diagnostics: KiiraDiagnostic[] = []
	for (const partition of partitions) {
		for (const raw of await engine.collect(partition.virtualFiles, partition.options)) {
			const vf = vfByName.get(raw.virtualFile)
			if (vf) {
				diagnostics.push(mapRawDiagnostic(raw, vf))
			}
		}
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
	// `include` (the glob), `defaultGroup` (a Kiira grouping concept) and
	// `externalPackages` (doc-only deps) are not tsconfig options; strip them so
	// only real compiler options are converted.
	const {
		include: _include,
		defaultGroup: _defaultGroup,
		externalPackages: _externalPackages,
		...compilerOptions
	} = override
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
function isUnresolvedRelativeImport(diagnostic: KiiraDiagnostic): boolean {
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
	snippets: KiiraCheckResult["snippets"],
	diagnostics: KiiraDiagnostic[],
	resolved: ReturnType<typeof resolveConfig>
): KiiraDiagnostic[] {
	const alreadyOverridden = resolved.overrides.filter((o) => "jsxImportSource" in o).map((o) => picomatch(o.include))
	const suggestions: KiiraDiagnostic[] = []

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
			source: "kiira",
			message: `JSX here looks like ${keyword}. Add a \`jsxImportSource: "${jsxImportSource}"\` override for \`${include}\` (run \`kiira check --fix\` to apply).`,
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
	snippets: KiiraCheckResult["snippets"]
	diagnostics: KiiraDiagnostic[]
	config: Partial<KiiraConfig>
	resolved: ReturnType<typeof resolveConfig>
}

// Identity of an error for baseline membership: code + full position + message,
// so two distinct errors that merely share a line and TS code (e.g. two unresolved
// names on one line) are not conflated when deciding if grouping introduced a new one.
const errorKey = (d: KiiraDiagnostic): string =>
	`${d.code}@${d.markdownRange.start.line}:${d.markdownRange.start.character}:${d.message}`

/** Whether a diagnostic's line falls within a snippet's code span. */
function isWithinSnippet(diagnostic: KiiraDiagnostic, snippet: KiiraCheckResult["snippets"][number]): boolean {
	const start = snippet.codeStart.line
	const end = start + snippet.code.split("\n").length - 1
	const line = diagnostic.markdownRange.start.line
	return line >= start && line <= end
}

/** Names a snippet reports as "cannot find" when checked standalone, parsed from its errors. */
function unresolvedNames(snippet: KiiraCheckResult["snippets"][number], docErrors: KiiraDiagnostic[]): Set<string> {
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
function planMinimalGroups(snippets: KiiraCheckResult["snippets"], docErrors: KiiraDiagnostic[]): number[][] {
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
async function suggestGrouping(input: SuggestGroupingInput): Promise<KiiraDiagnostic[]> {
	const { cwd, files, snippets, diagnostics, config, resolved } = input
	const suggestions: KiiraDiagnostic[] = []

	for (const file of files) {
		const checkable = snippets
			.filter((s) => s.markdownFile === file && isCheckable(s, resolved))
			.sort((a, b) => a.markdownRange.start.line - b.markdownRange.start.line)
		// Only attempt on docs that aren't already grouped — by an explicit `group=`
		// or by an effective `defaultGroup: "file"`. (When file-grouping is on, every
		// fence is grouped, so there is nothing to suggest.)
		if (checkable.length < 2 || checkable.some((s) => effectiveGroup(s, resolved) !== undefined)) {
			continue
		}
		const docErrors = diagnostics.filter((d) => d.markdownFile === file && d.severity === "error")
		if (!docErrors.some((d) => typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code))) {
			continue
		}

		// Probe every candidate cluster first; keep only those that verify, so the
		// `-N` slug suffix reflects the number of *surviving* groups (a doc with one
		// real group gets a clean `group=<doc>`, not `group=<doc>-1`).
		const survivors: KiiraCheckResult["snippets"][] = []
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
			const probe = members.map((s) => ({ ...s, meta: { ...s.meta, group: "__kiira_probe__" } }))
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
					source: "kiira",
					message: `This snippet continues an earlier one. Tag them \`group=${slug}\` to type-check them together (run \`kiira check --fix\` to apply).`,
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
	snippets: KiiraCheckResult["snippets"]
	/** Diagnostics already produced for these files (extraction + fixture + TS). */
	diagnostics: KiiraDiagnostic[]
	config: Partial<KiiraConfig>
}

/**
 * Compute Kiira's suggestion diagnostics (group= and jsxImportSource) for an
 * already-checked set of files. Shared by the CLI's whole-project check and the
 * editor's single-document check so both surface the same actionable fixes.
 */
export async function collectSuggestions(input: CollectSuggestionsInput): Promise<KiiraDiagnostic[]> {
	const { cwd, files, snippets, diagnostics, config } = input
	const resolved = resolveConfig(config)
	const grouping = await suggestGrouping({ cwd, files, snippets, diagnostics, config, resolved })
	const jsx = suggestFrameworkJsx(files, snippets, diagnostics, resolved)
	return [...grouping, ...jsx]
}

export interface CheckMarkdownFilesInput {
	cwd: string
	files?: string[]
	config?: Partial<KiiraConfig>
}

/** End-to-end: discover, extract, virtualize, and type-check Markdown files. */
export async function checkMarkdownFiles(input: CheckMarkdownFilesInput): Promise<KiiraCheckResult> {
	const { cwd } = input
	const userConfig = input.config ?? (await loadConfig(cwd))
	const resolved = resolveConfig(userConfig)
	const files =
		input.files ?? (await discoverMarkdownFiles({ cwd, include: resolved.include, exclude: resolved.exclude }))

	const snippets: KiiraCheckResult["snippets"] = []
	const diagnostics: KiiraDiagnostic[] = []

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
