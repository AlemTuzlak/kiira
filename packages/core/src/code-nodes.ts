import type { Code, Nodes, Root } from "mdast"
import { type ParsedFenceMeta, parseFenceMeta } from "./meta"

/** Every code node in `tree`, in document order. */
function collectCodeNodes(tree: Nodes, out: Code[] = []): Code[] {
	if (tree.type === "code") {
		out.push(tree)
	}
	if ("children" in tree && Array.isArray(tree.children)) {
		for (const child of tree.children) {
			collectCodeNodes(child, out)
		}
	}
	return out
}

// A document's tree is walked by extraction and again by the `fence-meta` rule,
// and each fence's info string is parsed by both. Both results are pure functions
// of the (immutable, per-parse) node, so they are kept on the node by identity.
const codeNodesByRoot = new WeakMap<Root, Code[]>()
const fenceMetaByNode = new WeakMap<Code, ParsedFenceMeta>()

/** The code nodes of a parsed document, collected once per tree. */
export function codeNodesOf(root: Root): Code[] {
	let nodes = codeNodesByRoot.get(root)
	if (!nodes) {
		nodes = collectCodeNodes(root)
		codeNodesByRoot.set(root, nodes)
	}
	return nodes
}

/** A code node's parsed fence metadata, parsed once per node. */
export function fenceMetaOf(node: Code): ParsedFenceMeta {
	let parsed = fenceMetaByNode.get(node)
	if (!parsed) {
		parsed = parseFenceMeta(node.meta)
		fenceMetaByNode.set(node, parsed)
	}
	return parsed
}
