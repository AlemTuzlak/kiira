import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { TypedownDiagnostic } from "@typedown/core"

// Captures the opening of a fenced code block: the prefix (indent + fence
// delimiter + spaces) and the language identifier that follows.
const FENCE_LANG = /^(\s*(?:`{3,}|~{3,})\s*)([A-Za-z0-9_-]+)/

interface FixSummary {
	filesChanged: number
	fixesApplied: number
}

interface LineEdit {
	/** Replace the fence language identifier (e.g. ts -> tsx). */
	language?: string
	/** Append a metadata token to the fence info string (e.g. group=foo). */
	append?: string
}

function applyLineEdit(line: string, edit: LineEdit): string {
	let next = line
	if (edit.language) {
		next = next.replace(FENCE_LANG, (_match, prefix: string) => `${prefix}${edit.language}`)
	}
	if (edit.append && !next.includes(edit.append)) {
		next = `${next.replace(/\s+$/, "")} ${edit.append}`
	}
	return next
}

/**
 * Apply fence auto-fixes to the Markdown sources: rewrite a mistagged language
 * (`ts` -> `tsx`) and/or append metadata (`group=foo`) on the opening fence line.
 * Returns how many fences were edited across how many files.
 */
export async function applyFixes(cwd: string, diagnostics: TypedownDiagnostic[]): Promise<FixSummary> {
	const byFile = new Map<string, Map<number, LineEdit>>()
	for (const d of diagnostics) {
		if (!d.fix) {
			continue
		}
		const edits = byFile.get(d.markdownFile) ?? new Map<number, LineEdit>()
		const edit = edits.get(d.fix.line) ?? {}
		if (d.fix.kind === "fence-language") {
			edit.language = d.fix.language
		} else if (d.fix.kind === "fence-meta") {
			edit.append = d.fix.append
		}
		edits.set(d.fix.line, edit)
		byFile.set(d.markdownFile, edits)
	}

	let filesChanged = 0
	let fixesApplied = 0

	for (const [file, edits] of byFile) {
		const lines = (await readFile(join(cwd, file), "utf8")).split("\n")
		let changed = false

		for (const [line, edit] of edits) {
			const current = lines[line]
			if (current === undefined) {
				continue
			}
			const replaced = applyLineEdit(current, edit)
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
