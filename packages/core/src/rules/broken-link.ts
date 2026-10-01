import { posix } from "node:path"
import type { Nodes } from "mdast"
import { loadMdxSupport, parseDocument } from "../extract"
import { defineRule } from "../plugin"
import type { RuleDocumentContext, SourceRange } from "../types"

interface BrokenLinkOptions {
	anchors?: boolean
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const MARKDOWN_FILE = /\.mdx?$/i

function walk(tree: Nodes, visit: (node: Nodes) => void): void {
	visit(tree)
	if ("children" in tree) {
		for (const child of tree.children as Nodes[]) {
			walk(child, visit)
		}
	}
}

function textOf(node: Nodes): string {
	if (node.type === "text" || node.type === "inlineCode") {
		return node.value
	}
	if (node.type === "image") {
		return node.alt ?? ""
	}
	return "children" in node ? (node.children as Nodes[]).map(textOf).join("") : ""
}

/** The anchors GitHub generates for a document's headings: duplicates get `-1`, `-2` in document order. */
function headingSlugs(tree: Nodes): Set<string> {
	const slugs = new Set<string>()
	const seen = new Map<string, number>()
	walk(tree, (node) => {
		if (node.type !== "heading") {
			return
		}
		const base = textOf(node)
			.toLowerCase()
			.replace(/[^\p{L}\p{N} _-]/gu, "")
			.replace(/ /g, "-")
		const count = seen.get(base) ?? 0
		seen.set(base, count + 1)
		slugs.add(count === 0 ? base : `${base}-${count}`)
	})
	return slugs
}

// Authors percent-encode spaces and non-ASCII in link targets; the file on disk is not encoded.
function decode(value: string): string {
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

function rangeOf(node: Nodes): SourceRange | undefined {
	const position = node.position
	return position
		? {
				start: { line: position.start.line - 1, character: position.start.column - 1 },
				end: { line: position.end.line - 1, character: position.end.column - 1 },
			}
		: undefined
}

async function targetSlugs(
	ctx: RuleDocumentContext<BrokenLinkOptions>,
	path: string
): Promise<Set<string> | undefined> {
	if (path === ctx.file) {
		return headingSlugs(ctx.mdast)
	}
	const text = ctx.fs.readText(path)
	if (text === undefined) {
		return undefined
	}
	if (/\.mdx$/i.test(path)) {
		await loadMdxSupport()
	}
	const { mdast, parseError } = parseDocument(path, text)
	// An unparseable target has no headings to compare against, so do not guess.
	return parseError ? undefined : headingSlugs(mdast)
}

function validateOptions(options: unknown): string | undefined {
	if (options === undefined) {
		return undefined
	}
	if (typeof options !== "object" || options === null) {
		return "options must be an object"
	}
	const { anchors } = options as { anchors?: unknown }
	return anchors === undefined || typeof anchors === "boolean" ? undefined : "`anchors` must be a boolean"
}

export const brokenLinkRule = defineRule<"document", BrokenLinkOptions>({
	meta: {
		scope: "document",
		defaultSeverity: "off",
		docs: { description: "Reports a relative link, image, or definition whose target file does not exist." },
		options: { default: { anchors: false }, validate: validateOptions },
	},
	async create(ctx) {
		const anchors = ctx.options?.anchors === true
		const slugCache = new Map<string, Set<string> | undefined>()
		const nodes: Array<Nodes & { url: string }> = []
		walk(ctx.mdast, (node) => {
			if (node.type === "link" || node.type === "image" || node.type === "definition") {
				nodes.push(node)
			}
		})
		for (const node of nodes) {
			const url = node.url
			if (HAS_SCHEME.test(url) || url.startsWith("//") || (url.startsWith("#") && !anchors)) {
				continue
			}
			const hashAt = url.indexOf("#")
			const hash = hashAt === -1 ? "" : decode(url.slice(hashAt + 1))
			const linkPath = decode((hashAt === -1 ? url : url.slice(0, hashAt)).split("?")[0] ?? "")
			const range = rangeOf(node)
			if (!range || (linkPath === "" && hash === "")) {
				continue
			}
			let path = ctx.file
			if (linkPath.startsWith("/")) {
				path = posix.normalize(linkPath.replace(/^\/+/, ""))
			} else if (linkPath !== "") {
				path = posix.normalize(posix.join(posix.dirname(ctx.file), linkPath))
			}
			// A same-file anchor needs no disk check; the document may be an unsaved buffer.
			if (linkPath !== "" && !ctx.fs.exists(path)) {
				ctx.report({ range, message: `Link target not found: ${url}` })
				continue
			}
			if (anchors && hash !== "" && MARKDOWN_FILE.test(path)) {
				if (!slugCache.has(path)) {
					slugCache.set(path, await targetSlugs(ctx, path))
				}
				if (slugCache.get(path)?.has(hash.toLowerCase()) === false) {
					ctx.report({ range, message: `Link anchor not found: ${url}` })
				}
			}
		}
	},
})
