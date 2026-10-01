/**
 * Public type definitions for `kiira-core`.
 *
 * Positions throughout the public API are **zero-based** for both `line` and
 * `character`, matching `ts.getLineAndCharacterOfPosition` and the VS Code
 * `Position` model. Consumers that render for humans (e.g. the CLI) add 1.
 */

import type { Root as MdastRoot } from "mdast"
import type { Program as TsProgram, TypeChecker as TsTypeChecker } from "typescript"

export type KiiraLanguage = "ts" | "tsx" | "js" | "jsx"

/** A zero-based line/character position. */
export interface SourcePosition {
	/** Zero-based line number. */
	line: number
	/** Zero-based character offset within the line (UTF-16 code units). */
	character: number
}

/** A half-open range described by start/end positions. */
export interface SourceRange {
	start: SourcePosition
	end: SourcePosition
}

/** A fixture applied to a snippet before type-checking. */
export type KiiraFixture =
	| {
			type: "prepend"
			content: string
	  }
	| {
			type: "wrap"
			before: string
			after: string
	  }
	| {
			type: "file"
			path: string
	  }

/** Metadata parsed from a fence info string (e.g. ```ts fixture=react). */
export interface KiiraFenceMeta {
	ignore?: boolean
	validate?: "type" | "runtime" | "none"
	fixture?: string
	name?: string
	package?: "workspace" | "packed"
	/** Snippets sharing a group id (within one file) are type-checked together, in document order. */
	group?: string
}

/**
 * A per-glob compiler-option override. Any field other than `include` is treated
 * as a tsconfig-style `compilerOptions` entry (string enum forms) and merged onto
 * the base options for files matching `include` (e.g. `jsxImportSource` per framework).
 */
export interface KiiraOverride {
	include: string[]
	/** Per-glob default grouping (overrides the top-level `defaultGroup`). */
	defaultGroup?: "none" | "file"
	/** Per-glob external packages, merged into the single global install (see {@link KiiraConfig.externalPackages}). */
	externalPackages?: Record<string, string>
	/** Per-glob fence identifiers to recognize (replaces `markdown.codeFenceLanguages` for matching files). */
	codeFenceLanguages?: string[]
	/** Per-glob rule settings, applied after the top-level `rules` for matching files. */
	rules?: Record<string, RuleSetting>
	/** Per-glob presets; only their `rules` and `codeFenceLanguages` apply to matching files. */
	presets?: (string | KiiraPreset)[]
	[option: string]: unknown
}

/**
 * Which TypeScript engine type-checks the doc snippets.
 * - `"classic"` — kiira's bundled TypeScript (`ts.createProgram`), in-process.
 * - `"native"`  — the consuming project's TypeScript 7 native compiler (the Go
 *   port, via its `unstable/sync` API). Requires `typescript@>=7` in the project.
 * - `"auto"` (default) — use `"native"` when the project has TypeScript 7
 *   installed, otherwise `"classic"`.
 *
 * Diagnostics are the same either way; editor code-fixes always use the bundled
 * TypeScript (the native compiler has no code-fix API yet).
 */
export type KiiraEngine = "auto" | "classic" | "native"

export interface KiiraConfig {
	/** Glob patterns of the Markdown files to check. Presets may add more; defaults to every `.md`/`.mdx`. */
	include?: string[]
	exclude?: string[]
	tsconfig?: string
	/** Type-checking engine. See {@link KiiraEngine}. Defaults to `"auto"`. */
	engine?: KiiraEngine
	overrides?: KiiraOverride[]
	packageMode?: "workspace" | "packed"
	defaultValidate?: "type" | "runtime" | "none"
	defaultFixture?: string
	/**
	 * Report unused locals/parameters/imports (TS6133 etc.). Off by default —
	 * doc snippets routinely declare things they don't use. Set true to enforce.
	 */
	checkUnusedSymbols?: boolean
	/**
	 * Report unresolved *relative* imports (`./x`, `../x`) as errors. Off by default —
	 * snippets often "import" from imaginary sibling files that stand in for an
	 * earlier snippet or the reader's own project. Bare package imports
	 * (`@scope/pkg`, `react`) are always checked. Set true to enforce.
	 */
	checkRelativeImports?: boolean
	/**
	 * Packages to install into an isolated, hidden cache (`node_modules/.kiira`)
	 * purely so doc fences that import them type-check — without adding them to
	 * the project's real dependencies. Keyed by package name → version range.
	 * Declarations here and on `overrides` are merged into one install and
	 * resolve globally.
	 */
	externalPackages?: Record<string, string>
	/**
	 * Implicitly group all checkable fences in a file (concatenated in document
	 * order) so later fences see earlier declarations. `"none"` (default) keeps
	 * per-fence isolation. Settable per-glob via `overrides`. An explicit `group=`
	 * on a fence always wins; `group=none` detaches a fence from the file group.
	 */
	defaultGroup?: "none" | "file"
	fixtures?: Record<string, KiiraFixture>
	languages?: KiiraLanguage[]
	markdown?: {
		codeFenceLanguages?: string[]
	}
	/** Plugins providing rules and presets (JS/TS config files only). */
	plugins?: KiiraPlugin[]
	/** Presets to apply, by name (`<plugin>/<preset>` or a built-in name) or inline. */
	presets?: (string | KiiraPreset)[]
	/** Rule settings layered on top of the presets. Keys are rule ids. */
	rules?: Record<string, RuleSetting>
}

/**
 * A {@link KiiraConfig} with all defaultable fields resolved. Produced by
 * {@link resolveConfig} and consumed by the rest of the pipeline so downstream
 * code never has to re-apply defaults.
 */
export interface ResolvedKiiraConfig {
	include: string[]
	exclude: string[]
	/** When true and no file matches `include`, the run is skipped with an info line instead of a report. */
	allowEmpty: boolean
	tsconfig?: string
	engine: KiiraEngine
	overrides: KiiraOverride[]
	packageMode: "workspace" | "packed"
	defaultValidate: "type" | "runtime" | "none"
	defaultFixture?: string
	defaultGroup: "none" | "file"
	checkUnusedSymbols: boolean
	checkRelativeImports: boolean
	externalPackages: Record<string, string>
	fixtures: Record<string, KiiraFixture>
	languages: KiiraLanguage[]
	markdown: {
		codeFenceLanguages: string[]
	}
	plugins: KiiraPlugin[]
	/** Presets in effect, in application order with `extends` flattened in front of each. */
	presets: KiiraPreset[]
	/** Every known rule by id (built-ins without a prefix, plugin rules as `<plugin>/<rule>`). */
	ruleRegistry: Record<string, KiiraRule>
	/** The effective base rule settings: defaults → presets → `rules` (and legacy toggles). Overrides layer per file. */
	ruleSettings: Record<string, ResolvedRuleSetting>
	/** Levels from the CLI `--rule` flag. They beat every other layer, including per-file overrides. */
	ruleOverrides: Record<string, RuleSeverity>
}

// --- rules & plugins -------------------------------------------------------

export type RuleScope = "document" | "program" | "project"

/** A rule's configured level. `"warn"` reports as a `warning` diagnostic. */
export type RuleSeverity = "off" | "warn" | "error"

/** A rule entry in `rules`: a level, or a level with options. */
export type RuleSetting = RuleSeverity | [RuleSeverity, unknown]

export interface ResolvedRuleSetting {
	severity: RuleSeverity
	options: unknown
}

export interface RuleDocs {
	description: string
	url?: string
}

export interface RuleOptionsMeta<TOptions> {
	default?: TOptions
	/** Return an error message to reject `options`, or `undefined` to accept. */
	validate?: (options: unknown) => string | undefined
}

export interface RuleMeta<TOptions = unknown> {
	scope: RuleScope
	defaultSeverity: RuleSeverity
	docs?: RuleDocs
	options?: RuleOptionsMeta<TOptions>
}

/** The workspace a check runs in, shared by every rule scope and the TypeScript hook. */
export interface KiiraProject {
	/** Absolute path the check runs from (config, globs, and `fs` are relative to it). */
	cwd: string
	/** The parsed `package.json` at `cwd`, if any. */
	packageJson: Record<string, unknown> | undefined
	/** Named packages of the pnpm/npm/yarn workspace rooted at `cwd` (empty when not a workspace). */
	workspacePackages: Array<{ name: string; dir: string }>
	/** Whether git tracks `path` (cwd-relative or absolute). `false` when git is unavailable. */
	isTracked: (path: string) => boolean
}

/** Read-only file access, resolved against the project `cwd`. Every read is recorded by the runner. */
export interface KiiraFs {
	exists: (path: string) => boolean
	/** The file's text, or `undefined` when it cannot be read. */
	readText: (path: string) => string | undefined
}

/** The position in a document where a Markdown/MDX parse failed. */
export interface DocumentParseError {
	message: string
	position: SourcePosition
}

export interface RuleReport {
	range: SourceRange
	message: string
	/** Defaults to the rule's configured severity. */
	severity?: KiiraDiagnostic["severity"]
	fix?: KiiraFix
}

export interface ProjectRuleReport extends Omit<RuleReport, "range"> {
	/** A cwd-relative posix path; any file, not only Markdown. */
	file: string
	/** Defaults to the start of the file. */
	range?: SourceRange
}

export interface RuleDocumentContext<TOptions = unknown> {
	/** Markdown file path, relative to `cwd`, posix separators. */
	file: string
	text: string
	/** The parsed tree. Empty (no children) when `parseError` is set. */
	mdast: MdastRoot
	parseError?: DocumentParseError
	snippets: ExtractedSnippet[]
	/** TypeScript diagnostics already produced for this document (after the engine and filters ran). */
	diagnostics: readonly KiiraDiagnostic[]
	options: TOptions
	/** The rule's configured severity for this document. */
	severity: "error" | "warning"
	config: ResolvedKiiraConfig
	fs: KiiraFs
	project: KiiraProject
	report: (report: RuleReport) => void
}

export interface RuleProgramContext<TOptions = unknown> extends RuleDocumentContext<TOptions> {
	program: TsProgram
	checker: TsTypeChecker
	/** This document's virtual files, all members of `program`. */
	virtualFiles: VirtualFile[]
	/** Map a `[start, end)` offset span in a virtual file to Markdown, or `undefined` when it lands on generated code. */
	toMarkdownRange: (virtualFile: VirtualFile, start: number, end: number) => SourceRange | undefined
}

export interface RuleProjectContext<TOptions = unknown> {
	options: TOptions
	severity: "error" | "warning"
	config: ResolvedKiiraConfig
	fs: KiiraFs
	project: KiiraProject
	/** Every document in the run, by cwd-relative path. */
	files: readonly string[]
	report: (report: ProjectRuleReport) => void
}

export type RuleContextFor<TScope extends RuleScope, TOptions> = TScope extends "project"
	? RuleProjectContext<TOptions>
	: TScope extends "program"
		? RuleProgramContext<TOptions>
		: RuleDocumentContext<TOptions>

export interface KiiraRule<TScope extends RuleScope = RuleScope, TOptions = unknown> {
	meta: RuleMeta<TOptions> & { scope: TScope }
	// Method syntax (bivariant) so rules with concrete option types fit the registry.
	create(context: RuleContextFor<TScope, TOptions>): void | Promise<void>
}

export interface KiiraPreset {
	name: string
	/** Presets applied before this one, by name. */
	extends?: string[]
	include?: string[] | ((project: KiiraProject) => string[])
	exclude?: string[]
	allowEmpty?: boolean
	codeFenceLanguages?: string[]
	rules?: Record<string, RuleSetting>
}

export interface KiiraPlugin {
	name: string
	/** Rules keyed by short name; their ids are `<plugin>/<name>`. */
	rules?: Record<string, KiiraRule>
	/** Presets named `<plugin>/<preset.name>`. */
	presets?: KiiraPreset[]
}

/** A code fence extracted from a Markdown file. */
export interface ExtractedSnippet {
	/** Stable identifier, unique within a single check run. */
	id: string
	/** Markdown file path, relative to `cwd`, using posix separators. */
	markdownFile: string
	/** Optional URI (used by editor integrations). */
	markdownUri?: string
	lang: KiiraLanguage
	/** The raw source inside the fence (without the fence lines). */
	code: string
	meta: KiiraFenceMeta
	/** Range of the entire fenced block, including the fence delimiters. */
	markdownRange: SourceRange
	/** Position of the first character of the code content. */
	codeStart: SourcePosition
}

/** A single virtual-line to markdown-line mapping. */
export interface SourceMapping {
	/** Zero-based line in the generated virtual file. */
	virtualLine: number
	/** Zero-based line in the originating Markdown file, or `null` if generated. */
	markdownLine: number | null
	/**
	 * Column delta to add to a virtual character to reach the markdown character.
	 * Zero unless a fixture indents the snippet.
	 */
	characterDelta: number
}

/** A generated virtual TypeScript/JavaScript file for one snippet. */
export interface VirtualFile {
	id: string
	fileName: string
	lang: KiiraLanguage
	content: string
	snippet: ExtractedSnippet
	mappings: SourceMapping[]
}

/** An auto-fix that rewrites a code fence's language identifier in the Markdown source. */
export interface KiiraFenceLanguageFix {
	kind: "fence-language"
	/** Zero-based line of the opening fence to rewrite. */
	line: number
	/** The language identifier to write (e.g. "tsx"). */
	language: KiiraLanguage
}

/** An auto-fix that appends metadata to a code fence's info string (e.g. `group=foo`). */
export interface KiiraFenceMetaFix {
	kind: "fence-meta"
	/** Zero-based line of the opening fence to amend. */
	line: number
	/** Metadata token to append after the language (e.g. "group=foo"). */
	append: string
}

/** An auto-fix that adds a per-glob compiler-option override to the Kiira config. */
export interface KiiraConfigOverrideFix {
	kind: "config-override"
	/** The include glob for the override (e.g. "**\/*solid*"). */
	include: string
	/** tsconfig compilerOptions to set for matching files (e.g. { jsxImportSource: "solid-js" }). */
	compilerOptions: Record<string, string>
}

export type KiiraFix = KiiraFenceLanguageFix | KiiraFenceMetaFix | KiiraConfigOverrideFix

export interface KiiraDiagnostic {
	severity: "error" | "warning" | "info"
	code?: string | number
	message: string
	source: "kiira" | "typescript" | "runtime"
	markdownFile: string
	markdownRange: SourceRange
	virtualFile?: string
	virtualRange?: SourceRange
	/** True when the diagnostic originates from generated fixture code, not the snippet itself. */
	generated?: boolean
	/** An optional automatic fix applied by `kiira check --fix`. */
	fix?: KiiraFix
}

export interface KiiraCheckStats {
	markdownFiles: number
	snippets: number
	checked: number
	ignored: number
	errors: number
	warnings: number
}

export interface KiiraCheckResult {
	snippets: ExtractedSnippet[]
	virtualFiles: VirtualFile[]
	diagnostics: KiiraDiagnostic[]
	stats: KiiraCheckStats
	/** True when `allowEmpty` is set and no file matched, so nothing was checked. */
	skipped?: boolean
}
