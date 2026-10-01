import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Code, Nodes, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { FENCE_ALIASES, resolveConfig } from "./config"
import { parseFenceMeta } from "./meta"
import type { ExtractedSnippet, KiiraConfig, KiiraDiagnostic, KiiraLanguage, ResolvedKiiraConfig } from "./types"

export interface ExtractInput {
	cwd: string
	files: string[]
	config: Partial<KiiraConfig>
}

export interface ExtractContentInput {
	markdownFile: string
	content: string
	config: ResolvedKiiraConfig
	markdownUri?: string
}

export interface SnippetExtraction {
	snippets: ExtractedSnippet[]
	diagnostics: KiiraDiagnostic[]
}

interface MdxSupport {
	mdxjs: typeof import("micromark-extension-mdxjs").mdxjs
	mdxFromMarkdown: typeof import("mdast-util-mdx").mdxFromMarkdown
}

// The MDX parser pulls in acorn (about half of the bundle) and only `.mdx` files
// need it, so it is imported on demand and cached here for the synchronous parse.
let mdxSupport: MdxSupport | undefined
let mdxLoading: Promise<void> | undefined

/**
 * Load the MDX parser. `extractSnippetsFromContent` is synchronous, so call (and
 * await) this once before extracting from `.mdx` content. Idempotent; concurrent
 * calls share one import. `checkMarkdownFiles` and `extractMarkdownSnippets` do it
 * for you.
 */
export async function loadMdxSupport(): Promise<void> {
	mdxLoading ??= Promise.all([import("mdast-util-mdx"), import("micromark-extension-mdxjs")]).then(
		([mdast, micromark]) => {
			mdxSupport = { mdxjs: micromark.mdxjs, mdxFromMarkdown: mdast.mdxFromMarkdown }
		},
		(error: unknown) => {
			mdxLoading = undefined
			throw error
		}
	)
	await mdxLoading
}

/** Preload the MDX parser when any of `files` is an `.mdx` file. */
export async function loadMdxSupportFor(files: readonly string[]): Promise<void> {
	if (files.some((file) => /\.mdx$/i.test(file))) {
		await loadMdxSupport()
	}
}

// Invert FENCE_ALIASES once: any recognized identifier -> its KiiraLanguage.
const ALIAS_TO_LANG = new Map<string, KiiraLanguage>()
for (const [lang, aliases] of Object.entries(FENCE_ALIASES) as [KiiraLanguage, string[]][]) {
	for (const alias of aliases) {
		ALIAS_TO_LANG.set(alias, lang)
	}
}

function normalizeLang(raw: string): KiiraLanguage | undefined {
	return ALIAS_TO_LANG.get(raw.toLowerCase())
}

/**
 * Parse Markdown to an mdast tree. `.mdx` files use the MDX-aware micromark
 * extensions so ESM `import`/`export`, JSX elements, and `{…}` expressions parse
 * as MDX nodes instead of HTML — without which a fence placed directly inside a
 * JSX element (e.g. `<Callout>`) is silently swallowed as raw HTML. `.md` files
 * keep the plain parser so a literal `<Foo>` is not reinterpreted as JSX.
 */
function parseMarkdown(markdownFile: string, content: string): Root {
	if (/\.mdx$/i.test(markdownFile)) {
		if (!mdxSupport) {
			throw new Error(
				"the MDX parser is not loaded. Await loadMdxSupport() before calling extractSnippetsFromContent on .mdx files."
			)
		}
		return fromMarkdown(content, {
			extensions: [mdxSupport.mdxjs()],
			mdastExtensions: [mdxSupport.mdxFromMarkdown()],
		}) as Root
	}
	return fromMarkdown(content) as Root
}

function collectCodeNodes(node: Nodes, out: Code[]): void {
	if (node.type === "code") {
		out.push(node)
	}
	if ("children" in node && Array.isArray(node.children)) {
		for (const child of node.children) {
			collectCodeNodes(child, out)
		}
	}
}

/**
 * Build a Kiira diagnostic for a Markdown/MDX parse failure, anchored to the
 * failure's line/column when the thrown `VFileMessage` carries them.
 */
function parseErrorDiagnostic(markdownFile: string, error: unknown): KiiraDiagnostic {
	const message = error instanceof Error ? error.message : String(error)
	// `VFileMessage` exposes 1-based `line`/`column` of the offending construct.
	const vfile = error as { line?: number | null; column?: number | null }
	const line = typeof vfile.line === "number" && vfile.line > 0 ? vfile.line - 1 : 0
	const character = typeof vfile.column === "number" && vfile.column > 0 ? vfile.column - 1 : 0
	const position = { line, character }
	const kind = /\.mdx$/i.test(markdownFile) ? "MDX" : "Markdown"
	return {
		severity: "error",
		source: "kiira",
		message: `Failed to parse ${kind}: ${message}`,
		markdownFile,
		markdownRange: { start: position, end: position },
	}
}

/**
 * Extract code-fence snippets from a single Markdown document. Pure: no file IO,
 * so it can be reused by editor integrations operating on in-memory text.
 */
export function extractSnippetsFromContent({
	markdownFile,
	content,
	config,
	markdownUri,
}: ExtractContentInput): SnippetExtraction {
	const snippets: ExtractedSnippet[] = []
	const diagnostics: KiiraDiagnostic[] = []

	// The MDX parser (unlike CommonMark) throws on malformed input — an unclosed
	// JSX tag or an unparseable `{…}` expression. Degrade to a per-file diagnostic
	// so one bad file (e.g. mid-edit) doesn't abort the whole check run.
	let tree: Root
	try {
		tree = parseMarkdown(markdownFile, content)
	} catch (error) {
		diagnostics.push(parseErrorDiagnostic(markdownFile, error))
		return { snippets, diagnostics }
	}

	const codeNodes: Code[] = []
	collectCodeNodes(tree, codeNodes)

	// `codeFenceLanguages` controls which fence identifiers are recognized
	// (it defaults to each configured language plus its aliases); the identifier
	// is then normalized to a KiiraLanguage so ```typescript maps to ts.
	const recognized = new Set<string>(config.markdown.codeFenceLanguages.map((l) => l.toLowerCase()))
	let index = 0

	for (const node of codeNodes) {
		const rawLang = node.lang
		if (!rawLang || !recognized.has(rawLang.toLowerCase()) || !node.position) {
			continue
		}
		const lang = normalizeLang(rawLang)
		if (!lang) {
			continue
		}

		const parsed = parseFenceMeta(node.meta)
		const start = node.position.start
		const end = node.position.end
		const markdownRange = {
			start: { line: start.line - 1, character: start.column - 1 },
			end: { line: end.line - 1, character: end.column - 1 },
		}

		const snippet: ExtractedSnippet = {
			id: `${markdownFile}#${index}`,
			markdownFile,
			lang,
			code: node.value,
			meta: parsed.meta,
			markdownRange,
			// `start.line` is the 1-based fence line; the code content begins on the
			// next 1-based line, which is the same value as a zero-based index.
			codeStart: { line: start.line, character: 0 },
		}
		if (markdownUri) {
			snippet.markdownUri = markdownUri
		}
		snippets.push(snippet)
		index += 1

		for (const issue of parsed.issues) {
			diagnostics.push({
				severity: "warning",
				source: "kiira",
				message: issue.message,
				markdownFile,
				markdownRange,
			})
		}
	}

	return { snippets, diagnostics }
}

/**
 * Read and extract snippets from a set of Markdown files relative to `cwd`.
 *
 * This convenience wrapper returns only the snippets. Fence-metadata warnings
 * (e.g. an invalid `validate=` value) are surfaced by `extractSnippetsFromContent`
 * and by the end-to-end `checkMarkdownFiles`; use those if you need them.
 */
export async function extractMarkdownSnippets(input: ExtractInput): Promise<ExtractedSnippet[]> {
	const config = resolveConfig(input.config)
	const all: ExtractedSnippet[] = []
	await loadMdxSupportFor(input.files)
	for (const file of input.files) {
		const content = await readFile(join(input.cwd, file), "utf8")
		const { snippets } = extractSnippetsFromContent({ markdownFile: file, content, config })
		all.push(...snippets)
	}
	return all
}
