import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { type RawDiagnostic, classicEngine } from "./engine"
import { type NativeApiConstructor, collectNativeDiagnostics, compilerOptionsToTsconfigJson } from "./native-engine"
import type { VirtualFile } from "./types"

const cwd = fileURLToPath(new URL(".", import.meta.url))

/** Minimal virtual file — the native collector only reads `fileName`, `content`, `lang`. */
function vfile(name: string, content: string): VirtualFile {
	return {
		id: name,
		fileName: join(cwd, ".kiira", "virtual", name),
		lang: "ts",
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
