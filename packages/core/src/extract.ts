import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Code, Nodes, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { resolveConfig } from "./config"
import { parseFenceMeta } from "./meta"
import type {
	ExtractedSnippet,
	ResolvedTypedownConfig,
	TypedownConfig,
	TypedownDiagnostic,
	TypedownLanguage,
} from "./types"

export interface ExtractInput {
	cwd: string
	files: string[]
	config: Partial<TypedownConfig>
}

export interface ExtractContentInput {
	markdownFile: string
	content: string
	config: ResolvedTypedownConfig
	markdownUri?: string
}

export interface SnippetExtraction {
	snippets: ExtractedSnippet[]
	diagnostics: TypedownDiagnostic[]
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

	const languages = new Set<string>(config.languages)
	const snippets: ExtractedSnippet[] = []
	const diagnostics: TypedownDiagnostic[] = []
	let index = 0

	for (const node of codeNodes) {
		const lang = node.lang
		if (!lang || !languages.has(lang) || !node.position) {
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
			lang: lang as TypedownLanguage,
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
				source: "typedown",
				message: issue.message,
				markdownFile,
				markdownRange,
			})
		}
	}

	return { snippets, diagnostics }
}

/** Read and extract snippets from a set of Markdown files relative to `cwd`. */
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
