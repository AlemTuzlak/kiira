import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveConfig } from "./config"
import { detectLanguageTag } from "./detect"
import type {
	ExtractedSnippet,
	ResolvedTypedownConfig,
	SourceMapping,
	TypedownConfig,
	TypedownDiagnostic,
	TypedownFixture,
	TypedownLanguage,
	VirtualFile,
} from "./types"

/** Appended to every virtual file so each snippet is an isolated module. */
const MODULE_MARKER = "export {}"

/** Strip a leading file extension and convert path separators to `__`. */
function flattenPath(file: string): string {
	const withoutExt = file.replace(/\.[^./\\]+$/, "")
	return withoutExt.replace(/[\\/]/g, "__")
}

function snippetIndex(snippet: ExtractedSnippet): number {
	const hash = snippet.id.lastIndexOf("#")
	const parsed = hash === -1 ? Number.NaN : Number.parseInt(snippet.id.slice(hash + 1), 10)
	return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Build the stable virtual filename for a snippet (e.g. `docs__intro__snippet_000.tsx`).
 * `lang` overrides the extension when the snippet is checked as a corrected language.
 */
export function virtualFileName(snippet: ExtractedSnippet, lang: TypedownLanguage = snippet.lang): string {
	const base = flattenPath(snippet.markdownFile)
	const index = String(snippetIndex(snippet)).padStart(3, "0")
	return `${base}__snippet_${index}.${lang}`
}

/**
 * Remove leading/trailing blank lines and the common indentation from a block of
 * text, so fixtures authored as indented template literals produce clean output.
 */
export function dedent(text: string): string {
	const lines = text.replace(/\t/g, "  ").split("\n")
	while (lines.length > 0 && lines[0]?.trim() === "") {
		lines.shift()
	}
	while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
		lines.pop()
	}
	const indents = lines.filter((line) => line.trim() !== "").map((line) => line.match(/^ */)?.[0].length ?? 0)
	const min = indents.length > 0 ? Math.min(...indents) : 0
	return lines.map((line) => line.slice(min)).join("\n")
}

export interface BuildVirtualInput {
	snippet: ExtractedSnippet
	/** Lines inserted before the snippet code (fixture prepend or wrap-before). */
	before?: string
	/** Lines inserted after the snippet code (fixture wrap-after). */
	after?: string
}

export interface BuiltVirtualFile {
	content: string
	mappings: SourceMapping[]
}

/**
 * Assemble a virtual file's content and its per-line source map. Generated lines
 * (fixture before/after) map to `null`; code lines map to their Markdown line.
 */
export function buildVirtualFile({ snippet, before, after }: BuildVirtualInput): BuiltVirtualFile {
	const beforeLines = before ? before.split("\n") : []
	const codeLines = snippet.code.split("\n")
	const afterLines = after ? after.split("\n") : []

	const allLines = [...beforeLines, ...codeLines, ...afterLines]
	const mappings: SourceMapping[] = []

	allLines.forEach((_line, virtualLine) => {
		const codeIndex = virtualLine - beforeLines.length
		const isCodeLine = codeIndex >= 0 && codeIndex < codeLines.length
		mappings.push({
			virtualLine,
			markdownLine: isCodeLine ? snippet.codeStart.line + codeIndex : null,
			characterDelta: 0,
		})
	})

	return { content: allLines.join("\n"), mappings }
}

/**
 * Ensure a virtual filename is unique within a run. Distinct Markdown files can
 * flatten to the same base (e.g. `a/b.md` and `a__b.md`); disambiguate by
 * inserting a counter before the extension so the compiler host never serves
 * one snippet's content for another.
 */
function uniqueName(name: string, used: Set<string>): string {
	if (!used.has(name)) {
		used.add(name)
		return name
	}
	const dot = name.lastIndexOf(".")
	const stem = dot === -1 ? name : name.slice(0, dot)
	const ext = dot === -1 ? "" : name.slice(dot)
	let counter = 1
	let candidate = `${stem}_${counter}${ext}`
	while (used.has(candidate)) {
		counter += 1
		candidate = `${stem}_${counter}${ext}`
	}
	used.add(candidate)
	return candidate
}

/** Resolve a virtual line to its originating Markdown line, or `null` if generated. */
export function mapVirtualLine(mappings: SourceMapping[], virtualLine: number): number | null {
	return mappings.find((m) => m.virtualLine === virtualLine)?.markdownLine ?? null
}

/** The effective validation mode for a snippet, after applying config defaults. */
export function effectiveValidate(
	snippet: ExtractedSnippet,
	config: ResolvedTypedownConfig
): "type" | "runtime" | "none" {
	return snippet.meta.validate ?? config.defaultValidate
}

/** Whether a snippet should be type-checked (not ignored, not validate=none). */
export function isCheckable(snippet: ExtractedSnippet, config: ResolvedTypedownConfig): boolean {
	if (snippet.meta.ignore) {
		return false
	}
	return effectiveValidate(snippet, config) !== "none"
}

async function resolveFixtureBeforeAfter(
	fixture: TypedownFixture | undefined,
	cwd: string
): Promise<{ before: string; after: string }> {
	if (!fixture) {
		return { before: "", after: "" }
	}
	switch (fixture.type) {
		case "prepend":
			return { before: dedent(fixture.content), after: "" }
		case "wrap":
			return { before: dedent(fixture.before), after: dedent(fixture.after) }
		case "file": {
			const content = await readFile(join(cwd, fixture.path), "utf8")
			return { before: content.replace(/\n+$/, ""), after: "" }
		}
	}
}

export interface CreateVirtualFilesInput {
	cwd: string
	snippets: ExtractedSnippet[]
	config: Partial<TypedownConfig>
}

export interface CreateVirtualFilesResult {
	virtualFiles: VirtualFile[]
	diagnostics: TypedownDiagnostic[]
}

/**
 * Turn checkable snippets into virtual files on disk-relative paths under
 * `.typedown/virtual`. Snippets that are ignored or `validate=none` are skipped.
 * A missing named fixture produces a Typedown diagnostic rather than throwing.
 */
export async function createVirtualFiles(input: CreateVirtualFilesInput): Promise<CreateVirtualFilesResult> {
	const config = resolveConfig(input.config)
	const virtualFiles: VirtualFile[] = []
	const diagnostics: TypedownDiagnostic[] = []
	const usedNames = new Set<string>()

	for (const snippet of input.snippets) {
		if (!isCheckable(snippet, config)) {
			continue
		}

		const fixtureName = snippet.meta.fixture ?? config.defaultFixture
		let fixture: TypedownFixture | undefined
		if (fixtureName) {
			fixture = config.fixtures[fixtureName]
			if (!fixture) {
				diagnostics.push({
					severity: "warning",
					source: "typedown",
					message: `Unknown fixture "${fixtureName}". Add it to the \`fixtures\` map in your Typedown config.`,
					markdownFile: snippet.markdownFile,
					markdownRange: snippet.markdownRange,
				})
			}
		}

		// Detect a wrong language tag (a `ts` fence that actually contains JSX).
		// Warn, attach an auto-fix, and check the snippet as the corrected language
		// so it produces real type errors instead of a JSX syntax-error cascade.
		const suggestion = detectLanguageTag(snippet.code, snippet.lang)
		const checkLang: TypedownLanguage = suggestion?.suggested ?? snippet.lang
		if (suggestion) {
			diagnostics.push({
				severity: "warning",
				code: "language-tag",
				source: "typedown",
				message: `This \`${snippet.lang}\` code fence contains JSX. Change the language tag to \`${suggestion.suggested}\` (run \`typedown check --fix\` to apply).`,
				markdownFile: snippet.markdownFile,
				markdownRange: {
					start: snippet.markdownRange.start,
					end: snippet.markdownRange.start,
				},
				fix: { kind: "fence-language", line: snippet.markdownRange.start.line, language: suggestion.suggested },
			})
		}

		const { before, after } = await resolveFixtureBeforeAfter(fixture, input.cwd)
		// Force every snippet into module scope so top-level declarations are
		// isolated per snippet (no cross-snippet "cannot redeclare" false errors).
		const afterWithModuleMarker = [after, MODULE_MARKER].filter((s) => s.length > 0).join("\n")
		const { content, mappings } = buildVirtualFile({ snippet, before, after: afterWithModuleMarker })
		const name = uniqueName(virtualFileName(snippet, checkLang), usedNames)

		virtualFiles.push({
			id: snippet.id,
			fileName: join(input.cwd, ".typedown", "virtual", name),
			lang: checkLang,
			content,
			snippet,
			mappings,
		})
	}

	return { virtualFiles, diagnostics }
}
