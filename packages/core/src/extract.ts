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
 * Extract code-fence snippets from a single Markdown document. Pure: no file IO,
 * so it can be reused by editor integrations operating on in-memory text.
 */
export function extractSnippetsFromContent({
	markdownFile,
	content,
	config,
	markdownUri,
}: ExtractContentInput): SnippetExtraction {
	const tree = fromMarkdown(content) as Root
	const codeNodes: Code[] = []
	collectCodeNodes(tree, codeNodes)

	// `codeFenceLanguages` controls which fence identifiers are recognized
	// (it defaults to each configured language plus its aliases); the identifier
	// is then normalized to a KiiraLanguage so ```typescript maps to ts.
	const recognized = new Set<string>(config.markdown.codeFenceLanguages.map((l) => l.toLowerCase()))
	const snippets: ExtractedSnippet[] = []
	const diagnostics: KiiraDiagnostic[] = []
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
	for (const file of input.files) {
		const content = await readFile(join(input.cwd, file), "utf8")
		const { snippets } = extractSnippetsFromContent({ markdownFile: file, content, config })
		all.push(...snippets)
	}
	return all
}
