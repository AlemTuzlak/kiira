import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { buildBaseOptions } from "./check"
import { resolveConfig } from "./config"
import { type RawDiagnostic, classicEngine } from "./engine"
import {
	type NativeApiConstructor,
	closeNativeEngine,
	collectNativeDiagnostics,
	compilerOptionsToTsconfigJson,
	createNativeEngine,
	createNativeEngineSession,
	lineStartsOf,
	offsetToPosition,
} from "./native-engine"
import { createProject, createRuleFs } from "./rules/run"
import type { SourcePosition, TypescriptHookResult, VirtualFile } from "./types"
import { applyTypescriptHook, runTypescriptHooks } from "./typescript-hook"

const cwd = fileURLToPath(new URL(".", import.meta.url))

/** Minimal virtual file — the native collector only reads `fileName`, `content`, `lang`. */
function vfile(name: string, content: string, dir = cwd): VirtualFile {
	return {
		id: name,
		fileName: join(dir, ".kiira", "virtual", name),
		lang: name.endsWith(".js") ? "js" : "ts",
		content,
		snippet: {} as VirtualFile["snippet"],
		mappings: [],
	}
}

function vfileAt(root: string, name: string, content: string): VirtualFile {
	return vfile(name, content, root)
}

function nativeProject(): string {
	const root = mkdtempSync(join(tmpdir(), "kiira-native-"))
	const typescriptEntry = createRequire(import.meta.url).resolve("typescript-7/unstable/sync")
	const typescriptRoot = join(dirname(typescriptEntry), "../../..")
	mkdirSync(join(root, "node_modules"), { recursive: true })
	symlinkSync(typescriptRoot, join(root, "node_modules", "typescript"), "dir")
	return root
}

const OPTIONS: ts.CompilerOptions = {
	// ESNext (=== Latest === 99) specifically exercises enum-alias serialization:
	// a mis-serialized target falls back to the compiler default and would emit
	// false downlevel-iteration errors on the Set-spread snippet below.
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	strict: true,
	skipLibCheck: true,
	noEmit: true,
}

const erroredFiles = (diagnostics: RawDiagnostic[]): Set<string> =>
	new Set(diagnostics.filter((d) => d.severity === "error").map((d) => d.virtualFile))

describe("compilerOptionsToTsconfigJson", () => {
	it("serializes numeric enums to the tsconfig string forms", () => {
		const json = compilerOptionsToTsconfigJson({
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			jsx: ts.JsxEmit.ReactJSX,
			lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
		})
		expect(json).toMatchObject({
			target: "es2022",
			module: "esnext",
			moduleResolution: "bundler",
			jsx: "react-jsx",
			lib: ["es2022", "dom", "dom.iterable"],
			noEmit: true,
		})
	})

	it("maps enum aliases and value-collisions to legal tsconfig strings", () => {
		// ScriptTarget.ESNext === Latest === 99; the built-in reverse map keeps
		// "Latest" (illegal in a tsconfig), so this must resolve to "esnext".
		const json = compilerOptionsToTsconfigJson({
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.NodeNext,
			// ModuleResolutionKind.Node10 === NodeJs === 2; must be "node10", not "nodejs".
			moduleResolution: ts.ModuleResolutionKind.Node10,
			moduleDetection: ts.ModuleDetectionKind.Force,
		})
		expect(json).toMatchObject({
			target: "esnext",
			module: "nodenext",
			moduleResolution: "node10",
			moduleDetection: "force",
		})
	})

	it("drops the internal keys the config parser stamps on", () => {
		const json = compilerOptionsToTsconfigJson({
			configFilePath: "/x/tsconfig.json",
			pathsBasePath: "/x",
			strict: true,
		} as ts.CompilerOptions)
		expect(json).not.toHaveProperty("configFilePath")
		expect(json).not.toHaveProperty("pathsBasePath")
		expect(json).toMatchObject({ strict: true })
	})
})

describe("offsetToPosition", () => {
	/** The earlier linear scan, kept as the reference the binary search must match. */
	function referencePosition(content: string, offset: number): SourcePosition {
		const clamped = Math.max(0, Math.min(offset, content.length))
		let line = 0
		let lineStart = 0
		for (let i = 0; i < clamped; i += 1) {
			if (content.charCodeAt(i) === 10 /* \n */) {
				line += 1
				lineStart = i + 1
			}
		}
		return { line, character: clamped - lineStart }
	}

	it.each([
		{ name: "offset 0", content: "const a = 1\nconst b = 2", offset: 0 },
		{ name: "middle of a line", content: "const a = 1\nconst b = 2", offset: 15 },
		{ name: "exactly on a newline", content: "const a = 1\nconst b = 2", offset: 11 },
		{ name: "right after a trailing newline at EOF", content: "const a = 1\n", offset: 12 },
		{ name: "CRLF text, on the \\r", content: "a\r\nbc\r\nd", offset: 4 },
		{ name: "CRLF text, after the \\n", content: "a\r\nbc\r\nd", offset: 7 },
		{ name: "past the end", content: "a\nb", offset: 99 },
		{ name: "negative offset", content: "a\nb", offset: -5 },
		{ name: "empty content", content: "", offset: 3 },
	])("matches the linear scan: $name", ({ content, offset }) => {
		expect(offsetToPosition(lineStartsOf(content), content.length, offset)).toEqual(referencePosition(content, offset))
	})
})

describe("native engine (TypeScript 7)", () => {
	it("reports the same erroring files as the classic engine", async () => {
		const { API } = (await import("typescript-7/unstable/sync")) as unknown as { API: NativeApiConstructor }
		const files = [
			vfile("bad.ts", "export const n: number = 'not a number'\n"),
			vfile("missing.ts", "export const x = totallyUndefinedName\n"),
			// Valid only at target >= ES2015: proves `target: ESNext` is serialized
			// correctly (a mis-serialized target would flag downlevel iteration here).
			vfile("good.ts", "export const arr = [...new Set([1, 2, 3])]\n"),
		]

		const native = collectNativeDiagnostics(API, cwd, files, OPTIONS)
		const classic = (await classicEngine.collect(files, OPTIONS)) as RawDiagnostic[]

		// Parity: the same files carry errors under both engines.
		expect(erroredFiles(native)).toEqual(erroredFiles(classic))
		// The ES2015+ snippet stays clean; the planted type error is found and positioned.
		expect(native.some((d) => d.virtualFile === files[2]?.fileName && d.severity === "error")).toBe(false)
		const typeError = native.find((d) => d.code === 2322)
		expect(typeError).toBeDefined()
		expect(typeError?.start?.line).toBe(0)
	})

	it("reuses a cwd-scoped API and refreshes changed, deleted, and option overlays", async () => {
		const firstCwd = nativeProject()
		const secondCwd = nativeProject()
		try {
			const first = await createNativeEngine(firstCwd)
			const sameCwd = await createNativeEngine(firstCwd)
			const otherCwd = await createNativeEngine(secondCwd)
			expect(sameCwd).toBe(first)
			expect(otherCwd).not.toBe(first)

			const source = vfileAt(firstCwd, "source.ts", "export const value: string = 'ok'\n")
			const initial = await first.collect([source], { ...OPTIONS, strictNullChecks: false })
			expect(initial.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0)

			const changed = { ...source, content: "export const value: string = null\n" }
			const strict = await first.collect([changed], { ...OPTIONS, strictNullChecks: true })
			expect(strict.some((diagnostic) => diagnostic.code === 2322)).toBe(true)

			const consumer = vfileAt(firstCwd, "consumer.ts", 'import { value } from "./source"\n')
			const afterDeletion = await first.collect([consumer], OPTIONS)
			expect(afterDeletion.some((diagnostic) => diagnostic.code === 2307)).toBe(true)

			await closeNativeEngine(firstCwd)
			expect(await createNativeEngine(firstCwd)).not.toBe(first)
		} finally {
			await closeNativeEngine()
			rmSync(firstCwd, { recursive: true, force: true })
			rmSync(secondCwd, { recursive: true, force: true })
		}
	})

	it("serializes snapshot updates, reports update failures, and closes snapshots and APIs", async () => {
		type ApiOptions = ConstructorParameters<NativeApiConstructor>[0]
		type UpdateParams = Parameters<InstanceType<NativeApiConstructor>["updateSnapshot"]>[0]
		class FakeApi {
			static latest: FakeApi
			readonly updates: UpdateParams[] = []
			closed = 0
			disposedSnapshots = 0

			constructor(readonly options: ApiOptions) {
				FakeApi.latest = this
			}

			updateSnapshot(params: UpdateParams) {
				this.updates.push(params)
				return {
					getProjects: () => [
						{
							configFileName: "tsconfig.json",
							program: {
								getSyntacticDiagnostics: () => [],
								getSemanticDiagnostics: () => [],
							},
						},
					],
					dispose: () => {
						this.disposedSnapshots += 1
					},
				}
			}

			close(): void {
				this.closed += 1
			}
		}

		const root = "/native-api-test"
		const engine = createNativeEngineSession(FakeApi, root)
		const first = vfileAt(root, "first.ts", "export const first = 1\n")
		const second = vfileAt(root, "second.ts", "export const second = 2\n")
		await Promise.all([engine.collect([first], OPTIONS), engine.collect([second], OPTIONS)])

		expect(FakeApi.latest.updates[0]?.openProjects).toEqual([
			join(root, "__kiira_native.tsconfig.json").replace(/\\/g, "/"),
		])
		expect(FakeApi.latest.updates[1]?.openProjects).toBeUndefined()
		expect(FakeApi.latest.updates[1]?.fileChanges).toMatchObject({
			created: [second.fileName.replace(/\\/g, "/")],
			deleted: [first.fileName.replace(/\\/g, "/")],
		})
		expect(FakeApi.latest.options.fs?.readFile?.(first.fileName)).toBeNull()
		expect(FakeApi.latest.options.fs?.fileExists?.(first.fileName)).toBe(false)
		expect(FakeApi.latest.disposedSnapshots).toBe(2)

		await engine.close()
		await engine.close()
		expect(FakeApi.latest.closed).toBe(1)

		class FailingApi extends FakeApi {
			updateSnapshot(): never {
				throw new Error("snapshot update failed")
			}
		}
		const failing = createNativeEngineSession(FailingApi, root)
		await expect(failing.collect([first], OPTIONS)).rejects.toThrow("snapshot update failed")
		expect(FakeApi.latest.closed).toBe(1)
	})
})

describe("options produced by a TypeScript hook", () => {
	const hookCwd = join(cwd, "../tests/fixtures/ts-hook")

	/** The options a document gets from a hook, applied over Kiira's defaults like `replaceTsconfig` does. */
	async function hookOptions(result: TypescriptHookResult): Promise<ts.CompilerOptions> {
		const resolved = resolveConfig({ plugins: [{ name: "hook", typescript: () => result }] })
		const hook = runTypescriptHooks(resolved, {
			file: "doc.md",
			text: "",
			frontmatter: undefined,
			snippets: [],
			project: await createProject(hookCwd),
			fs: createRuleFs(hookCwd).fs,
		})
		const base = await buildBaseOptions(hookCwd, resolved, { replaceTsconfig: true })
		return hook ? applyTypescriptHook(hookCwd, base, hook) : base
	}

	it("round-trips through compilerOptionsToTsconfigJson", async () => {
		const options = await hookOptions({
			replaceTsconfig: true,
			paths: { "@docs/*": ["./src/*"] },
			compilerOptions: {
				moduleDetection: "force",
				lib: ["es2022", "dom"],
				types: [],
				jsx: "preserve",
				resolveJsonModule: true,
				allowSyntheticDefaultImports: false,
				strictNullChecks: false,
			},
		})
		const json = compilerOptionsToTsconfigJson(options)
		expect(json).toMatchObject({
			moduleDetection: "force",
			lib: ["es2022", "dom"],
			types: [],
			jsx: "preserve",
			resolveJsonModule: true,
			allowSyntheticDefaultImports: false,
			strictNullChecks: false,
			// Hook path values resolve from cwd to absolute paths.
			paths: { "@docs/*": [`${join(hookCwd, "src").replace(/\\/g, "/")}/*`] },
			allowJs: true,
			checkJs: true,
		})
		const parsed = ts.convertCompilerOptionsFromJson(json, hookCwd)
		expect(parsed.errors).toEqual([])
		expect(parsed.options).toMatchObject({
			moduleDetection: options.moduleDetection,
			lib: options.lib,
			types: [],
			jsx: ts.JsxEmit.Preserve,
			resolveJsonModule: true,
			allowSyntheticDefaultImports: false,
			strictNullChecks: false,
			paths: options.paths,
		})
	})

	it("is checked the same by the native and classic engines", async () => {
		const { API } = (await import("typescript-7/unstable/sync")) as unknown as { API: NativeApiConstructor }
		const options = await hookOptions({
			replaceTsconfig: true,
			paths: { "@docs/*": ["./src/*"] },
			compilerOptions: { noImplicitAny: false, strictNullChecks: false },
		})
		const files = [
			// Resolves only through the hook's `paths`.
			vfile("alias.ts", 'import { greet } from "@docs/greet"\nexport const x: string = greet()\n', hookCwd),
			vfile("unresolved.ts", 'import { nope } from "@docs/missing"\nexport const y = nope\n', hookCwd),
			// Clean only with `noImplicitAny: false`.
			vfile("loose.ts", "export function f(x) {\n\treturn x\n}\n", hookCwd),
			// Clean only with `strictNullChecks: false`.
			vfile("nullable.ts", "export const n: string = null\n", hookCwd),
			// `allowJs` and `checkJs` stay on under replaceTsconfig.
			vfile("typed.js", '/** @type {number} */\nexport const a = "x"\n', hookCwd),
		]

		const native = collectNativeDiagnostics(API, hookCwd, files, options)
		const classic = (await classicEngine.collect(files, options)) as RawDiagnostic[]

		const names = (diagnostics: RawDiagnostic[]) =>
			[...erroredFiles(diagnostics)].map((f) => f.split(/[\\/]/).pop()).sort()
		expect(names(classic)).toEqual(["typed.js", "unresolved.ts"])
		expect(names(native)).toEqual(names(classic))
	})
})
