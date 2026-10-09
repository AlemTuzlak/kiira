import { mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { beforeEach, describe, expect, it } from "vitest"
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

	const libFiles = (program: ts.Program | undefined): ts.SourceFile[] =>
		program?.getSourceFiles().filter((file) => /lib\.[^/\\]*\.d\.ts$/.test(file.fileName)) ?? []

	beforeEach(() => {
		resetClassicEngineCache()
	})

	it("parses the lib files once and serves them to later programs", async () => {
		const { vf } = project()
		let first: ts.Program | undefined
		let second: ts.Program | undefined
		const keepFirst = (program: ts.Program): void => {
			first = program
		}
		const keepSecond = (program: ts.Program): void => {
			second = program
		}
		expect(await classicEngine.collect([vf("const n: number = 1")], options(), keepFirst)).toEqual([])
		expect(libFiles(first).length).toBeGreaterThan(0)
		expect(classicEngineCacheSize()).toBeGreaterThan(0)

		const diagnostics = await classicEngine.collect([vf('const n: number = "x"')], options(), keepSecond)
		expect(diagnostics.map((d) => d.code)).toEqual([2322])
		// The very same parsed objects, not re-parsed copies.
		const reused = libFiles(first)
		expect(libFiles(second).length).toBe(reused.length)
		expect(libFiles(second).every((file, i) => file === reused[i])).toBe(true)
	})

	it("re-reads a declaration file whose content changes but whose mtime does not", async () => {
		const { dir, vf } = project()
		const decl = join(dir, "globals.d.ts")
		// npm installs every file with this fixed mtime, so a version bump keeps it.
		const npmTime = new Date("1985-10-26T08:15:00Z")
		writeFileSync(decl, "declare const answer: number\n")
		utimesSync(decl, npmTime, npmTime)
		const snippet = vf('/// <reference path="../../globals.d.ts" />\nconst n: number = answer')

		expect(await classicEngine.collect([snippet], options())).toEqual([])

		writeFileSync(decl, "declare const answer: string\n")
		utimesSync(decl, npmTime, npmTime)

		const diagnostics = await classicEngine.collect([snippet], options())
		expect(diagnostics.map((d) => d.code)).toEqual([2322])
	})

	it("keeps files parsed under different module settings apart", async () => {
		const { vf } = project()
		await classicEngine.collect([vf("export const a = 1")], options())
		const first = classicEngineCacheSize()

		await classicEngine.collect([vf("export const a = 1")], {
			...options(),
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
		})
		expect(classicEngineCacheSize()).toBe(first * 2)
	})

	it("resetClassicEngineCache empties the cache", async () => {
		const { vf } = project()
		await classicEngine.collect([vf("export const a = 1")], options())
		expect(classicEngineCacheSize()).toBeGreaterThan(0)
		resetClassicEngineCache()
		expect(classicEngineCacheSize()).toBe(0)
	})
})
