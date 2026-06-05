/**
 * Pure helpers for editing code-fence lines, kept free of the `vscode` module so
 * they are unit-testable (the rest of the code-action wiring is editor glue).
 */

/**
 * Locate the language-identifier token on a fence opening line, as `[start, end)`
 * column offsets. For ` ```typescript ` it spans `typescript`; for a bare ` ``` `
 * it is the zero-width position right after the backticks (where a tag would go).
 * Returns undefined if the line is not a fence opening.
 */
export function fenceLanguageTokenRange(lineText: string): { start: number; end: number } | undefined {
	const match = /^(\s*(?:`{3,}|~{3,}))([^\s`~]*)/.exec(lineText)
	if (!match) {
		return undefined
	}
	const start = match[1].length
	return { start, end: start + match[2].length }
}
