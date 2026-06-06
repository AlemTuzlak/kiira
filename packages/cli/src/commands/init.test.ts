import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach } from "vitest"
import { runInit } from "./init"

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kiira-init-"))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

describe("runInit", () => {
	it("creates a config and a docs tsconfig", async () => {
		const logs: string[] = []
		const code = await runInit({ cwd: dir, log: (m) => logs.push(m) })

		expect(code).toBe(0)
		expect(existsSync(join(dir, "kiira.config.ts"))).toBe(true)
		expect(existsSync(join(dir, "tsconfig.docs.json"))).toBe(true)
		expect(readFileSync(join(dir, "kiira.config.ts"), "utf8")).toContain("defineConfig")
		expect(JSON.parse(readFileSync(join(dir, "tsconfig.docs.json"), "utf8")).compilerOptions.checkJs).toBe(true)
	})

	it("does not overwrite existing files", async () => {
		await runInit({ cwd: dir, log: () => {} })
		const logs: string[] = []
		await runInit({ cwd: dir, log: (m) => logs.push(m) })
		expect(logs.some((l) => l.includes("already exists"))).toBe(true)
	})
})
