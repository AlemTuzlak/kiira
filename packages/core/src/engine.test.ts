import fs, { mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	classicEngine,
	classicEngineCacheSize,
	projectTypescriptMajor,
	resetClassicEngineCache,
	resolveEngine,
} from "./engine"
import type { VirtualFile } from "./types"

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

describe("classic engine reuse across checks", () => {
	const options = (): ts.CompilerOptions => ({
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ["lib.es2022.d.ts"],
		types: [],
		strict: true,
		noEmit: true,
		skipLibCheck: true,
	})

	function project(): { dir: string; vf: (content: string) => VirtualFile } {
		const dir = mkdtempSync(join(tmpdir(), "kiira-engine-"))
		return {
			dir,
			vf: (content) => ({
				id: "doc.md#0",
				fileName: join(dir, ".kiira", "virtual", "doc__snippet_000.ts"),
				lang: "ts",
				content,
				snippet: {} as VirtualFile["snippet"],
				mappings: [],
			}),
		}
	}

	const libReads = (spy: { mock: { calls: unknown[][] } }): number =>
		spy.mock.calls.filter(([path]) => typeof path === "string" && /lib\.[^/\\]*\.d\.ts$/.test(path)).length

	beforeEach(() => {
		resetClassicEngineCache()
	})

	it("parses the lib files once and serves them to later programs", async () => {
		const { vf } = project()
		const spy = vi.spyOn(fs, "readFileSync")
		expect(await classicEngine.collect([vf("const n: number = 1")], options())).toEqual([])
		const first = libReads(spy)
		expect(first).toBeGreaterThan(0)
		expect(classicEngineCacheSize()).toBeGreaterThan(0)

		const diagnostics = await classicEngine.collect([vf('const n: number = "x"')], options())
		expect(diagnostics.map((d) => d.code)).toEqual([2322])
		expect(libReads(spy)).toBe(first)
		spy.mockRestore()
	})

	it("re-reads a declaration file when it changes on disk", async () => {
		const { dir, vf } = project()
		const decl = join(dir, "globals.d.ts")
		writeFileSync(decl, "declare const answer: number\n")
		const snippet = vf('/// <reference path="../../globals.d.ts" />\nconst n: number = answer')

		expect(await classicEngine.collect([snippet], options())).toEqual([])

		// Bump the mtime past the cached one so the change is detectable even within the same second.
		writeFileSync(decl, "declare const answer: string\n")
		const later = new Date(Date.now() + 5_000)
		utimesSync(decl, later, later)

		const diagnostics = await classicEngine.collect([snippet], options())
		expect(diagnostics.map((d) => d.code)).toEqual([2322])
	})

	it("resetClassicEngineCache empties the cache", async () => {
		const { vf } = project()
		await classicEngine.collect([vf("export const a = 1")], options())
		expect(classicEngineCacheSize()).toBeGreaterThan(0)
		resetClassicEngineCache()
		expect(classicEngineCacheSize()).toBe(0)
	})
})
