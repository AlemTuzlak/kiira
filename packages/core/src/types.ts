/**
 * Public type definitions for `@typedown/core`.
 *
 * Positions throughout the public API are **zero-based** for both `line` and
 * `character`, matching `ts.getLineAndCharacterOfPosition` and the VS Code
 * `Position` model. Consumers that render for humans (e.g. the CLI) add 1.
 */

export type TypedownLanguage = "ts" | "tsx" | "js" | "jsx"

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
export type TypedownFixture =
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
export interface TypedownFenceMeta {
	ignore?: boolean
	validate?: "type" | "runtime" | "none"
	fixture?: string
	name?: string
	package?: "workspace" | "packed"
}

export interface TypedownConfig {
	include: string[]
	exclude?: string[]
	tsconfig?: string
	packageMode?: "workspace" | "packed"
	defaultValidate?: "type" | "runtime" | "none"
	defaultFixture?: string
	fixtures?: Record<string, TypedownFixture>
	languages?: TypedownLanguage[]
	markdown?: {
		codeFenceLanguages?: string[]
	}
}

/**
 * A {@link TypedownConfig} with all defaultable fields resolved. Produced by
 * {@link resolveConfig} and consumed by the rest of the pipeline so downstream
 * code never has to re-apply defaults.
 */
export interface ResolvedTypedownConfig {
	include: string[]
	exclude: string[]
	tsconfig?: string
	packageMode: "workspace" | "packed"
	defaultValidate: "type" | "runtime" | "none"
	defaultFixture?: string
	fixtures: Record<string, TypedownFixture>
	languages: TypedownLanguage[]
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
	lang: TypedownLanguage
	/** The raw source inside the fence (without the fence lines). */
	code: string
	meta: TypedownFenceMeta
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
	lang: TypedownLanguage
	content: string
	snippet: ExtractedSnippet
	mappings: SourceMapping[]
}

export interface TypedownDiagnostic {
	severity: "error" | "warning" | "info"
	code?: string | number
	message: string
	source: "typedown" | "typescript" | "runtime"
	markdownFile: string
	markdownRange: SourceRange
	virtualFile?: string
	virtualRange?: SourceRange
	/** True when the diagnostic originates from generated fixture code, not the snippet itself. */
	generated?: boolean
}

export interface TypedownCheckStats {
	markdownFiles: number
	snippets: number
	checked: number
	ignored: number
	errors: number
	warnings: number
}

export interface TypedownCheckResult {
	snippets: ExtractedSnippet[]
	virtualFiles: VirtualFile[]
	diagnostics: TypedownDiagnostic[]
	stats: TypedownCheckStats
}
