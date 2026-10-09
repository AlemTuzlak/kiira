import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { KiiraLanguage } from "../types"

/** Every fence identifier Kiira recognizes by default, with the language it normalizes to. */
export const FENCE_TAGS: Array<[tag: string, lang: KiiraLanguage]> = [
	["ts", "ts"],
	["tsx", "tsx"],
	["js", "js"],
	["jsx", "jsx"],
	["typescript", "ts"],
	["typescriptreact", "tsx"],
	["javascript", "js"],
	["mjs", "js"],
	["cjs", "js"],
	["javascriptreact", "jsx"],
]

/** A throwaway project directory holding `files` (path -> text). */
export function tempProject(files: Record<string, string> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "kiira-rules-"))
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true })
		writeFileSync(join(dir, path), text)
	}
	return dir
}

/** A Markdown document with one fence tagged `tag` after a prose heading. The fence opens on line 2. */
export function docWithFence(tag: string, code: string): string {
	return ["# Title", "", `\`\`\`${tag}`, code, "```", ""].join("\n")
}
