import type { Code, Nodes } from "mdast"

/** Every code node in `tree`, in document order. */
export function collectCodeNodes(tree: Nodes, out: Code[] = []): Code[] {
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
