import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KiiraDiagnostic } from "@alemtuzlak/kiira-core"
import { afterEach, beforeEach } from "vitest"
import { applyConfigOverrides, applyFixes } from "./fix"

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kiira-fix-"))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

function diag(line: number, file = "doc.md"): KiiraDiagnostic {
	return {
		severity: "warning",
		code: "language-tag",
		source: "kiira",
		message: "wrong tag",
		markdownFile: file,
		markdownRange: { start: { line, character: 0 }, end: { line, character: 0 } },
		fix: { kind: "fence-language", line, language: "tsx" },
	}
}

describe("applyFixes", () => {
	it("rewrites the language identifier on the opening fence line", async () => {
		const md = ["# Doc", "", "```ts", "export const C = () => <div />", "```", ""].join("\n")
		writeFileSync(join(dir, "doc.md"), md)

		const summary = await applyFixes(dir, [diag(2)])

		expect(summary).toEqual({ filesChanged: 1, fixesApplied: 1 })
		expect(readFileSync(join(dir, "doc.md"), "utf8").split("\n")[2]).toBe("```tsx")
	})

	it("rewrites a `typescript` tag and preserves trailing fence metadata", async () => {
		const md = ["```typescript fixture=react", "export const C = () => <div />", "```"].join("\n")
		writeFileSync(join(dir, "doc.md"), md)

		await applyFixes(dir, [diag(0)])

		expect(readFileSync(join(dir, "doc.md"), "utf8").split("\n")[0]).toBe("```tsx fixture=react")
	})

	it("appends a fence-meta token (group=) to the info string", async () => {
		const md = ["```ts", "const a = 1", "```"].join("\n")
		writeFileSync(join(dir, "doc.md"), md)

		const summary = await applyFixes(dir, [
			{
				severity: "warning",
				code: "group",
				source: "kiira",
				message: "group it",
				markdownFile: "doc.md",
				markdownRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
				fix: { kind: "fence-meta", line: 0, append: "group=auth" },
			},
		])

		expect(summary).toEqual({ filesChanged: 1, fixesApplied: 1 })
		expect(readFileSync(join(dir, "doc.md"), "utf8").split("\n")[0]).toBe("```ts group=auth")
	})

	it("reports nothing changed when there are no fixes", async () => {
		writeFileSync(join(dir, "doc.md"), "```ts\nconst a = 1\n```")
		const summary = await applyFixes(dir, [
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

describe("applyConfigOverrides", () => {
	function overrideDiag(): KiiraDiagnostic {
		return {
			severity: "warning",
			code: "jsx-framework",
			source: "kiira",
			message: "solid",
			markdownFile: "docs/ai-solid.md",
			markdownRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
			fix: { kind: "config-override", include: "**/*solid*", compilerOptions: { jsxImportSource: "solid-js" } },
		}
	}

	it("merges an override into a JSON config", async () => {
		const configPath = join(dir, "kiira.config.json")
		writeFileSync(configPath, JSON.stringify({ include: ["docs/**/*.md"] }, null, 2))

		const result = await applyConfigOverrides(configPath, [overrideDiag()])

		expect(result.applied).toEqual([{ include: ["**/*solid*"], jsxImportSource: "solid-js" }])
		const written = JSON.parse(readFileSync(configPath, "utf8"))
		expect(written.overrides).toEqual([{ include: ["**/*solid*"], jsxImportSource: "solid-js" }])
	})

	it("is idempotent — does not duplicate an existing override", async () => {
		const configPath = join(dir, "kiira.config.json")
		writeFileSync(
			configPath,
			JSON.stringify({
				include: ["docs/**/*.md"],
				overrides: [{ include: ["**/*solid*"], jsxImportSource: "solid-js" }],
			})
		)
		const result = await applyConfigOverrides(configPath, [overrideDiag()])
		expect(result.applied).toEqual([])
	})

	it("returns fixes as manual when the config is not JSON", async () => {
		const result = await applyConfigOverrides(join(dir, "kiira.config.ts"), [overrideDiag()])
		expect(result.applied).toEqual([])
		expect(result.manual).toHaveLength(1)
	})

	it("throws rather than clobbering a non-array overrides field", async () => {
		const configPath = join(dir, "kiira.config.json")
		writeFileSync(configPath, JSON.stringify({ include: ["docs/**/*.md"], overrides: {} }))
		await expect(applyConfigOverrides(configPath, [overrideDiag()])).rejects.toThrow(/overrides.*array/i)
	})
})
