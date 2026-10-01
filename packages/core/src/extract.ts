import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { collectCodeNodes } from "./code-nodes"
import { FENCE_ALIASES, codeFenceLanguagesForFile, resolveConfig, rulesForFile } from "./config"
import { detectFrontmatter } from "./frontmatter"
import { parseFenceMeta } from "./meta"
import { fenceMetaReports } from "./rules/fence-meta"
import { parseErrorReport } from "./rules/parse-error"
import { reportToDiagnostic } from "./rules/run"
import type {
	DocumentParseError,
	ExtractedSnippet,
	Frontmatter,
	KiiraConfig,
	KiiraDiagnostic,
	KiiraLanguage,
	ResolvedKiiraConfig,
	RuleReport,
} from "./types"

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

// Invert FENCE_ALIASES lazily: `config.ts` imports the built-in rules, which reach
// this module, so reading `FENCE_ALIASES` at load would race `config.ts` itself.
let aliasToLang: Map<string, KiiraLanguage> | undefined

function normalizeLang(raw: string): KiiraLanguage | undefined {
	if (!aliasToLang) {
		aliasToLang = new Map()
		for (const [lang, aliases] of Object.entries(FENCE_ALIASES) as [KiiraLanguage, string[]][]) {
			for (const alias of aliases) {
				aliasToLang.set(alias, lang)
			}
		}
	}
	return aliasToLang.get(raw.toLowerCase())
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

interface ParsedDocument {
	frontmatter?: Frontmatter
	/** The parsed tree; an empty root when `parseError` is set. */
	mdast: Root
	parseError?: DocumentParseError
}

/**
 * Parse a Markdown/MDX document once. The MDX parser (unlike CommonMark) throws on
 * malformed input — an unclosed JSX tag or an unparseable `{…}` expression. That
 * degrades to a `parseError` (anchored to the failure's line/column when the thrown
 * `VFileMessage` carries them) so one bad file, e.g. mid-edit, doesn't abort the run.
 */
export function parseDocument(markdownFile: string, content: string): ParsedDocument {
	// The block is emptied line by line, so positions after it match the file and its
	// closing `---` cannot become a setext heading or thematic break.
	const block = detectFrontmatter(content)
	try {
		const mdast = parseMarkdown(markdownFile, block?.blanked ?? content)
		return block ? { mdast, frontmatter: block.frontmatter } : { mdast }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		// `VFileMessage` exposes 1-based `line`/`column` of the offending construct.
		const vfile = error as { line?: number | null; column?: number | null }
		const line = typeof vfile.line === "number" && vfile.line > 0 ? vfile.line - 1 : 0
		const character = typeof vfile.column === "number" && vfile.column > 0 ? vfile.column - 1 : 0
		return {
			mdast: { type: "root", children: [] },
			parseError: { message, position: { line, character } },
			...(block && { frontmatter: block.frontmatter }),
		}
	}
}

interface ExtractSnippetsInput {
	mdast: Root
	markdownFile: string
	config: ResolvedKiiraConfig
	markdownUri?: string
}

/** Extract the code-fence snippets of an already-parsed document. */
export function extractSnippets({
	mdast,
	markdownFile,
	config,
	markdownUri,
}: ExtractSnippetsInput): ExtractedSnippet[] {
	const snippets: ExtractedSnippet[] = []

	// The recognized fence identifiers (per file: the last matching override wins;
	// default each configured language plus its aliases) are normalized to a
	// KiiraLanguage so ```typescript maps to ts.
	const recognized = new Set<string>(codeFenceLanguagesForFile(config, markdownFile).map((l) => l.toLowerCase()))
	let index = 0

	for (const node of collectCodeNodes(mdast)) {
		const rawLang = node.lang
		if (!rawLang || !recognized.has(rawLang.toLowerCase()) || !node.position) {
			continue
		}
		const lang = normalizeLang(rawLang)
		if (!lang) {
			continue
		}

		const start = node.position.start
		const end = node.position.end
		const snippet: ExtractedSnippet = {
			id: `${markdownFile}#${index}`,
			markdownFile,
			lang,
			code: node.value,
			meta: parseFenceMeta(node.meta).meta,
			markdownRange: {
				start: { line: start.line - 1, character: start.column - 1 },
				end: { line: end.line - 1, character: end.column - 1 },
			},
			// `start.line` is the 1-based fence line; the code content begins on the
			// next 1-based line, which is the same value as a zero-based index.
			codeStart: { line: start.line, character: 0 },
		}
		if (markdownUri) {
			snippet.markdownUri = markdownUri
		}
		snippets.push(snippet)
		index += 1
	}

	return snippets
}

/**
 * Extract code-fence snippets from a single Markdown document, with the
 * diagnostics of the built-in `parse-error` and `fence-meta` rules. Pure: no file
 * IO, so it can be reused by integrations operating on in-memory text.
 */
export function extractSnippetsFromContent({
	markdownFile,
	content,
	config,
	markdownUri,
}: ExtractContentInput): SnippetExtraction {
	const { mdast, parseError } = parseDocument(markdownFile, content)
	const snippets = extractSnippets({ mdast, markdownFile, config, markdownUri })
	const reports: Array<[rule: string, RuleReport]> = []
	if (parseError) {
		reports.push(["parse-error", parseErrorReport(markdownFile, parseError)])
	}
	for (const report of fenceMetaReports(mdast, snippets)) {
		reports.push(["fence-meta", report])
	}
	const rules = rulesForFile(config, markdownFile)
	const diagnostics = reports.flatMap(([id, report]) => {
		const severity = rules[id]?.severity
		return severity && severity !== "off" ? [reportToDiagnostic(id, severity, markdownFile, report)] : []
	})
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
