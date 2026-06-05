import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TypedownDiagnostic } from "@typedown/core"
import { afterEach, beforeEach } from "vitest"
import { applyFenceLanguageFixes } from "./fix"

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "typedown-fix-"))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

function diag(line: number, file = "doc.md"): TypedownDiagnostic {
	return {
		severity: "warning",
		code: "language-tag",
		source: "typedown",
		message: "wrong tag",
		markdownFile: file,
		markdownRange: { start: { line, character: 0 }, end: { line, character: 0 } },
		fix: { kind: "fence-language", line, language: "tsx" },
	}
}

describe("applyFenceLanguageFixes", () => {
	it("rewrites the language identifier on the opening fence line", async () => {
		const md = ["# Doc", "", "```ts", "export const C = () => <div />", "```", ""].join("\n")
		writeFileSync(join(dir, "doc.md"), md)

		const summary = await applyFenceLanguageFixes(dir, [diag(2)])

		expect(summary).toEqual({ filesChanged: 1, fixesApplied: 1 })
		expect(readFileSync(join(dir, "doc.md"), "utf8").split("\n")[2]).toBe("```tsx")
	})

	it("rewrites a `typescript` tag and preserves trailing fence metadata", async () => {
		const md = ["```typescript fixture=react", "export const C = () => <div />", "```"].join("\n")
		writeFileSync(join(dir, "doc.md"), md)

		await applyFenceLanguageFixes(dir, [diag(0)])

		expect(readFileSync(join(dir, "doc.md"), "utf8").split("\n")[0]).toBe("```tsx fixture=react")
	})

	it("reports nothing changed when there are no fence-language fixes", async () => {
		writeFileSync(join(dir, "doc.md"), "```ts\nconst a = 1\n```")
		const summary = await applyFenceLanguageFixes(dir, [
			{
				severity: "error",
				source: "typescript",
				message: "boom",
				markdownFile: "doc.md",
				markdownRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
			},
		])
		expect(summary).toEqual({ filesChanged: 0, fixesApplied: 0 })
	})
})
