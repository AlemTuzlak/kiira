import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { overrideMatcher, resolveConfig } from "./config"
import { detectLanguageTag } from "./detect"
import type {
	ExtractedSnippet,
	KiiraConfig,
	KiiraDiagnostic,
	KiiraFixture,
	KiiraLanguage,
	ResolvedKiiraConfig,
	SourceMapping,
	SourcePosition,
	SourceRange,
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
export function virtualFileName(snippet: ExtractedSnippet, lang: KiiraLanguage = snippet.lang): string {
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

// Mapping arrays already checked to hold one entry per virtual line, in order.
// Appending later entries cannot put a duplicate before an existing index.
const inOrderMappings = new WeakSet<SourceMapping[]>()

function isInOrder(mappings: SourceMapping[]): boolean {
	if (inOrderMappings.has(mappings)) {
		return true
	}
	const inOrder = mappings.every((m, index) => m.virtualLine === index)
	if (inOrder) {
		inOrderMappings.add(mappings)
	}
	return inOrder
}

/** Resolve a virtual line to its originating Markdown line, or `null` if generated. */
export function mapVirtualLine(mappings: SourceMapping[], virtualLine: number): number | null {
	// Kiira's own builders emit one mapping per virtual line, in order, so the
	// mapping for line N sits at index N. Any other shape (sparse, unordered,
	// duplicates) keeps the scan, where the first matching mapping wins.
	const direct = mappings[virtualLine]
	if (direct?.virtualLine === virtualLine && isInOrder(mappings)) {
		return direct.markdownLine ?? null
	}
	return mappings.find((m) => m.virtualLine === virtualLine)?.markdownLine ?? null
}

/**
 * Map a virtual-file span to Markdown, or `undefined` when its start lands on
 * generated lines. An end on generated lines (or before the start) has no real
 * end column to map to, so it becomes a one-character range at the start.
 */
export function mapVirtualRange(
	mappings: SourceMapping[],
	start: SourcePosition,
	end: SourcePosition
): SourceRange | undefined {
	const startLine = mapVirtualLine(mappings, start.line)
	if (startLine === null) {
		return undefined
	}
	const endLine = mapVirtualLine(mappings, end.line)
	return {
		start: { line: startLine, character: start.character },
		end:
			endLine !== null && endLine >= startLine
				? { line: endLine, character: end.character }
				: { line: startLine, character: start.character + 1 },
	}
}

/** The effective validation mode for a snippet, after applying config defaults. */
export function effectiveValidate(snippet: ExtractedSnippet, config: ResolvedKiiraConfig): "type" | "runtime" | "none" {
	return snippet.meta.validate ?? config.defaultValidate
}

/**
 * Resolve the effective `defaultGroup` for a file: the base config value, then
 * each matching override's `defaultGroup` applied in order (last match wins),
 * mirroring how compiler-option overrides layer.
 */
function resolveDefaultGroup(config: ResolvedKiiraConfig, markdownFile: string): "none" | "file" {
	let value = config.defaultGroup
	for (const override of config.overrides) {
		if (override.defaultGroup !== undefined && overrideMatcher(override)(markdownFile)) {
			value = override.defaultGroup
		}
	}
	return value
}

/**
 * The group key a snippet belongs to, or `undefined` for an isolated singleton.
 * An explicit `group=` wins; `group=none` detaches the fence; otherwise
 * `defaultGroup: "file"` joins one implicit per-file group keyed by the file path.
 */
export function effectiveGroup(snippet: ExtractedSnippet, config: ResolvedKiiraConfig): string | undefined {
	const explicit = snippet.meta.group
	if (explicit !== undefined) {
		return explicit === "none" ? undefined : explicit
	}
	return resolveDefaultGroup(config, snippet.markdownFile) === "file" ? snippet.markdownFile : undefined
}

/** Whether a snippet should be type-checked (not ignored, not validate=none). */
export function isCheckable(snippet: ExtractedSnippet, config: ResolvedKiiraConfig): boolean {
	if (snippet.meta.ignore) {
		return false
	}
	return effectiveValidate(snippet, config) !== "none"
}

async function resolveFixtureBeforeAfter(
	fixture: KiiraFixture | undefined,
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

/**
 * Assemble several snippets (a group) into one virtual file, concatenated in the
 * given order. Each snippet's lines map back to its own Markdown lines; the shared
 * fixture/`before` and `after` lines are generated (unmapped). All snippets in a
 * group come from the same Markdown file.
 */
export function buildGroupedVirtualFile(input: {
	snippets: ExtractedSnippet[]
	before?: string
	after?: string
}): BuiltVirtualFile {
	const allLines: string[] = []
	const mappings: SourceMapping[] = []

	const pushGenerated = (block: string | undefined): void => {
		if (!block) {
			return
		}
		for (const line of block.split("\n")) {
			mappings.push({ virtualLine: allLines.length, markdownLine: null, characterDelta: 0 })
			allLines.push(line)
		}
	}

	pushGenerated(input.before)
	for (const snippet of input.snippets) {
		snippet.code.split("\n").forEach((line, index) => {
			mappings.push({ virtualLine: allLines.length, markdownLine: snippet.codeStart.line + index, characterDelta: 0 })
			allLines.push(line)
		})
	}
	pushGenerated(input.after)

	return { content: allLines.join("\n"), mappings }
}

export interface CreateVirtualFilesInput {
	cwd: string
	snippets: ExtractedSnippet[]
	config: Partial<KiiraConfig>
}

export interface CreateVirtualFilesResult {
	virtualFiles: VirtualFile[]
	diagnostics: KiiraDiagnostic[]
}

/**
 * Turn checkable snippets into virtual files on disk-relative paths under
 * `.kiira/virtual`. Snippets that are ignored or `validate=none` are skipped.
 * A missing named fixture produces a Kiira diagnostic rather than throwing.
 */
export async function createVirtualFiles(input: CreateVirtualFilesInput): Promise<CreateVirtualFilesResult> {
	const config = resolveConfig(input.config)
	const virtualFiles: VirtualFile[] = []
	const diagnostics: KiiraDiagnostic[] = []
	const usedNames = new Set<string>()

	// Group checkable snippets: same file + same effective group are checked
	// together (in document order); ungrouped snippets each form a singleton group.
	// The effective group folds in `defaultGroup` and the `group=none` escape hatch.
	const groups = new Map<string, ExtractedSnippet[]>()
	for (const snippet of input.snippets) {
		if (!isCheckable(snippet, config)) {
			continue
		}
		const group = effectiveGroup(snippet, config)
		const key = group !== undefined ? `g:${snippet.markdownFile} ${group}` : `s:${snippet.id}`
		const members = groups.get(key) ?? []
		members.push(snippet)
		groups.set(key, members)
	}

	for (const members of groups.values()) {
		members.sort((a, b) => a.markdownRange.start.line - b.markdownRange.start.line)
		const lead = members[0]
		if (!lead) {
			continue
		}

		// Fixture: group-level — the first member that names one (or the default).
		const fixtureName = members.find((m) => m.meta.fixture)?.meta.fixture ?? config.defaultFixture
		let fixture: KiiraFixture | undefined
		if (fixtureName) {
			fixture = config.fixtures[fixtureName]
			if (!fixture) {
				diagnostics.push({
					severity: "warning",
					source: "kiira",
					message: `Unknown fixture "${fixtureName}". Add it to the \`fixtures\` map in your Kiira config.`,
					markdownFile: lead.markdownFile,
					markdownRange: lead.markdownRange,
				})
			}
		}

		// A `ts` fence that actually contains JSX is checked as tsx whether or not
		// the `language-tag` rule is on; the rule only reports it.
		let checkLang: KiiraLanguage = lead.lang
		for (const member of members) {
			if (member.lang === "tsx" || detectLanguageTag(member.code, member.lang)?.suggested === "tsx") {
				checkLang = "tsx"
			}
		}

		const { before, after } = await resolveFixtureBeforeAfter(fixture, input.cwd)
		// Force module scope so top-level declarations are isolated per group
		// (no cross-group "cannot redeclare" false errors).
		const afterWithModuleMarker = [after, MODULE_MARKER].filter((s) => s.length > 0).join("\n")
		const { content, mappings } =
			members.length === 1
				? buildVirtualFile({ snippet: lead, before, after: afterWithModuleMarker })
				: buildGroupedVirtualFile({ snippets: members, before, after: afterWithModuleMarker })
		const name = uniqueName(virtualFileName(lead, checkLang), usedNames)
		const leadGroup = effectiveGroup(lead, config)

		virtualFiles.push({
			id: leadGroup !== undefined ? `${lead.markdownFile}#group:${leadGroup}` : lead.id,
			fileName: join(input.cwd, ".kiira", "virtual", name),
			lang: checkLang,
			content,
			snippet: lead,
			mappings,
		})
	}

	return { virtualFiles, diagnostics }
}
