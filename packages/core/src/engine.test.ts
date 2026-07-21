import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { classicEngine, projectTypescriptMajor, resolveEngine } from "./engine"

const cwd = fileURLToPath(new URL(".", import.meta.url))

describe("projectTypescriptMajor", () => {
	it("reads the bundled TypeScript major from cwd", () => {
		// kiira-core depends on typescript@^5, so it resolves to a 5.x here.
		expect(projectTypescriptMajor(cwd)).toBe(5)
	})
})

describe("resolveEngine", () => {
	it("returns the classic engine when asked", async () => {
		expect(await resolveEngine(cwd, "classic")).toBe(classicEngine)
	})

	it("auto falls back to classic when the project has no TypeScript 7", async () => {
		expect(await resolveEngine(cwd, "auto")).toBe(classicEngine)
	})

	it("native throws when the project has no TypeScript 7 native API", async () => {
		await expect(resolveEngine(cwd, "native")).rejects.toThrow()
	})
})
