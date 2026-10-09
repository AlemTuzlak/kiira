import type { Frontmatter } from "./types"

const DELIMITER = /^---[ \t]*$/
const FENCE_OPENER = /^(```|~~~)/

interface FrontmatterBlock {
	frontmatter: Frontmatter
	/** `text` with every character of the block turned into a space, line endings kept, so offsets and columns after it stay the same. */
	blanked: string
}

/**
 * Detect a leading frontmatter block: `---` at offset 0 (after a BOM, if any) and a
 * later line that is exactly `---` (trailing spaces and tabs allowed). Without a
 * closing line the document has no frontmatter, and a code fence opener inside the
 * block means it is not frontmatter either. Only `\n` and `\r\n` end a line. A BOM is
 * not counted in positions, the same as the Markdown parser and editors that drop it.
 */
export function detectFrontmatter(text: string): FrontmatterBlock | undefined {
	const bom = text.startsWith("\uFEFF") ? "\uFEFF" : ""
	const body = text.slice(bom.length)
	if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) {
		return undefined
	}
	let lineStart = 0
	let rawStart = 0
	let previousEnding = ""
	for (let line = 0; ; line++) {
		const newline = body.indexOf("\n", lineStart)
		const lineEnd = newline === -1 ? body.length : newline
		const contentEnd = lineEnd > lineStart && body[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd
		const content = body.slice(lineStart, contentEnd)
		if (line === 0) {
			rawStart = lineEnd + 1
		} else if (DELIMITER.test(content)) {
			// The line ending before the closing delimiter belongs to the delimiter, not to `raw`.
			const rawEnd = Math.max(rawStart, lineStart - previousEnding.length)
			return {
				frontmatter: {
					raw: body.slice(rawStart, rawEnd),
					range: { start: { line: 0, character: 0 }, end: { line, character: content.length } },
					bodyStart: { line: line + 1, character: 0 },
				},
				blanked: bom + body.slice(0, contentEnd).replace(/[^\r\n]/g, " ") + body.slice(contentEnd),
			}
		} else if (FENCE_OPENER.test(content)) {
			return undefined
		}
		if (newline === -1) {
			return undefined
		}
		previousEnding = body.slice(contentEnd, lineEnd + 1)
		lineStart = lineEnd + 1
	}
}
