import type { Frontmatter } from "./types"

const DELIMITER = /^---[ \t]*$/

interface FrontmatterBlock {
	frontmatter: Frontmatter
	/** `text` with every line of the block emptied, line endings kept, so later lines keep their numbers. */
	blanked: string
}

/**
 * Detect a leading frontmatter block: `---` at offset 0 (a BOM is not skipped) and a
 * later line that is exactly `---` (trailing spaces and tabs allowed). Without a
 * closing line the document has no frontmatter. Only `\n` and `\r\n` end a line.
 */
export function detectFrontmatter(text: string): FrontmatterBlock | undefined {
	if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
		return undefined
	}
	const endings: string[] = []
	let lineStart = 0
	let rawStart = 0
	for (let line = 0; ; line++) {
		const newline = text.indexOf("\n", lineStart)
		const lineEnd = newline === -1 ? text.length : newline
		const contentEnd = lineEnd > lineStart && text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd
		const content = text.slice(lineStart, contentEnd)
		const ending = newline === -1 ? "" : text.slice(contentEnd, lineEnd + 1)
		if (line === 0) {
			rawStart = lineEnd + 1
		} else if (DELIMITER.test(content)) {
			// The line ending before the closing delimiter belongs to the delimiter, not to `raw`.
			const rawEnd = Math.max(rawStart, lineStart - (endings[line - 1]?.length ?? 0))
			return {
				frontmatter: {
					raw: text.slice(rawStart, rawEnd),
					range: { start: { line: 0, character: 0 }, end: { line, character: content.length } },
					bodyStart: { line: line + 1, character: 0 },
				},
				blanked: endings.join("") + ending + text.slice(lineEnd + 1),
			}
		}
		if (newline === -1) {
			return undefined
		}
		endings.push(ending)
		lineStart = lineEnd + 1
	}
}
