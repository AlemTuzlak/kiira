import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { buildBaseOptions } from "./check"
import { resolveConfig } from "./config"
import { type RawDiagnostic, classicEngine } from "./engine"
import { type NativeApiConstructor, collectNativeDiagnostics, compilerOptionsToTsconfigJson } from "./native-engine"
import { createProject, createRuleFs } from "./rules/run"
import type { TypescriptHookResult, VirtualFile } from "./types"
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
})

describe("options produced by a TypeScript hook", () => {
	const hookCwd = join(cwd, "../tests/fixtures/ts-hook")

	/** The options a document gets from a hook, applied over Kiira's defaults like `replaceTsconfig` does. */
	async function hookOptions(result: TypescriptHookResult): Promise<ts.CompilerOptions> {
		const resolved = resolveConfig({ plugins: [{ name: "hook", typescript: () => result }] })
		const hook = runTypescriptHooks(resolved, {
			file: "doc.md",
			text: "",
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
			paths: { "@docs/*": ["./src/*"] },
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
