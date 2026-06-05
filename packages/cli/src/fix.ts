import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { TypedownDiagnostic } from "@typedown/core"

// Matches the opening of a fenced code block and captures the prefix (indent +
// fence delimiter + optional spaces) and the language identifier that follows.
const FENCE_LANG = /^(\s*(?:`{3,}|~{3,})\s*)([A-Za-z0-9_-]+)/

interface FixSummary {
	filesChanged: number
	fixesApplied: number
}

/**
 * Apply fence-language auto-fixes to the Markdown sources. Each fix rewrites the
 * language identifier on a specific opening-fence line (e.g. `ts`/`typescript`
 * -> `tsx`). Returns how many fences were rewritten across how many files.
 */
export async function applyFenceLanguageFixes(cwd: string, diagnostics: TypedownDiagnostic[]): Promise<FixSummary> {
	// Group the line->language edits per file.
	const byFile = new Map<string, Map<number, string>>()
	for (const d of diagnostics) {
		if (d.fix?.kind !== "fence-language") {
			continue
		}
		const edits = byFile.get(d.markdownFile) ?? new Map<number, string>()
		edits.set(d.fix.line, d.fix.language)
		byFile.set(d.markdownFile, edits)
	}

	let filesChanged = 0
	let fixesApplied = 0

	for (const [file, edits] of byFile) {
		const original = await readFile(join(cwd, file), "utf8")
		const lines = original.split("\n")
		let changed = false

		for (const [line, language] of edits) {
			const current = lines[line]
			if (current === undefined) {
				continue
			}
			const replaced = current.replace(FENCE_LANG, (_match, prefix: string) => `${prefix}${language}`)
			if (replaced !== current) {
				lines[line] = replaced
				changed = true
				fixesApplied += 1
			}
		}

		if (changed) {
			await writeFile(join(cwd, file), lines.join("\n"), "utf8")
			filesChanged += 1
		}
	}

	return { filesChanged, fixesApplied }
}
