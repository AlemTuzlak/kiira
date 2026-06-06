/**
 * Public type definitions for `kiira-core`.
 *
 * Positions throughout the public API are **zero-based** for both `line` and
 * `character`, matching `ts.getLineAndCharacterOfPosition` and the VS Code
 * `Position` model. Consumers that render for humans (e.g. the CLI) add 1.
 */

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
	[option: string]: unknown
}

export interface KiiraConfig {
	include: string[]
	exclude?: string[]
	tsconfig?: string
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
	fixtures?: Record<string, KiiraFixture>
	languages?: KiiraLanguage[]
	markdown?: {
		codeFenceLanguages?: string[]
	}
}

/**
 * A {@link KiiraConfig} with all defaultable fields resolved. Produced by
 * {@link resolveConfig} and consumed by the rest of the pipeline so downstream
 * code never has to re-apply defaults.
 */
export interface ResolvedKiiraConfig {
	include: string[]
	exclude: string[]
	tsconfig?: string
	overrides: KiiraOverride[]
	packageMode: "workspace" | "packed"
	defaultValidate: "type" | "runtime" | "none"
	defaultFixture?: string
	checkUnusedSymbols: boolean
	checkRelativeImports: boolean
	fixtures: Record<string, KiiraFixture>
	languages: KiiraLanguage[]
	markdown: {
		codeFenceLanguages: string[]
	}
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
}
