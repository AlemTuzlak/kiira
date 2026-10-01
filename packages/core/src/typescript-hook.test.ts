import { checkMarkdownFiles, checkMarkdownText, createOptionsResolver, documentFromVirtualFiles } from "./check"
import { resolveConfig } from "./config"
import { classicEngine } from "./engine"
import { definePlugin, defineRule } from "./plugin"
import { createProject, createRuleFs } from "./rules/run"
import { FENCE_TAGS, docWithFence, tempProject } from "./rules/test-helpers"
import type { KiiraConfig, KiiraDiagnostic, KiiraPreset, TypescriptHookResult } from "./types"
import { applyTypescriptHook, runTypescriptHooks, stableStringify } from "./typescript-hook"

const greet = { "src/greet.ts": 'export function greet(): string {\n\treturn "hi"\n}\n' }

const isJs = (lang: string) => lang === "js" || lang === "jsx"
const implicitAny = "export function f(x) {\n\treturn x\n}"
/** A type error (2322) and an undefined name (2304): TypeScript syntax for ts/tsx, JSDoc types for js/jsx. */
const mismatch = (lang: string) =>
	isJs(lang) ? '/** @type {number} */\nexport const a = "x"\nmissing()' : 'export const a: number = "x"\nmissing()'

const pluginWithHook = (typescript: () => TypescriptHookResult | undefined, name = "hook") =>
	definePlugin({ name, typescript })

async function typescriptCodes(cwd: string, tag: string, code: string, config: KiiraConfig) {
	const { diagnostics } = await checkMarkdownText({
		cwd,
		markdownFile: "doc.md",
		text: docWithFence(tag, code),
		config: { engine: "classic", ...config },
	})
	return diagnostics.filter((d) => d.source === "typescript" && d.severity === "error").map((d) => d.code)
}

async function shared(cwd: string) {
	return { project: await createProject(cwd), fs: createRuleFs(cwd).fs }
}

// A small `lib` keeps each type-check cheap; the default one pulls in all of the DOM typings.
const slim = (extra: Record<string, unknown> = {}) => ({
	"tsconfig.json": JSON.stringify({
		compilerOptions: { strict: true, lib: ["es2022"], types: [], allowJs: true, checkJs: true, ...extra },
	}),
})
const slimLib = { lib: ["es2022"], types: [] }

describe("TypeScript hook on every fence language", () => {
	it.each([
		["ts", implicitAny, 7006],
		["js", mismatch("js"), 2322],
	] as const)("a `%s` fence reports its error without the hook", async (tag, code, expected) => {
		expect(await typescriptCodes(tempProject(slim()), tag, code, {})).toContain(expected)
	})

	it("a fence cannot resolve the alias without the hook", async () => {
		const code = 'import { greet } from "@docs/greet"\nexport const x = greet()'
		expect(await typescriptCodes(tempProject({ ...slim(), ...greet }), "ts", code, {})).toContain(2307)
	})

	it.each(FENCE_TAGS)("compilerOptions apply to a `%s` fence", async (tag, lang) => {
		// JS reports a checkJs error, so turn checkJs off; TS reports TS7006, so turn noImplicitAny off.
		const [code, options, expected] = isJs(lang)
			? [mismatch(lang), { checkJs: false }, 2322]
			: [implicitAny, { noImplicitAny: false }, 7006]
		const plugins = [pluginWithHook(() => ({ compilerOptions: options }))]
		expect(await typescriptCodes(tempProject(slim()), tag, code, { plugins })).not.toContain(expected)
	})

	it.each(FENCE_TAGS)("paths resolve an aliased import in a `%s` fence", async (tag) => {
		const code = 'import { greet } from "@docs/greet"\nexport const x = greet()'
		const plugins = [pluginWithHook(() => ({ paths: { "@docs/*": ["./src/*"] } }))]
		expect(await typescriptCodes(tempProject({ ...slim(), ...greet }), tag, code, { plugins })).toEqual([])
	})

	it.each(FENCE_TAGS)("filterDiagnostic drops a chosen code in a `%s` fence", async (tag, lang) => {
		const plugins = [pluginWithHook(() => ({ filterDiagnostic: (d: KiiraDiagnostic) => d.code !== 2304 }))]
		const codes = await typescriptCodes(tempProject(slim()), tag, mismatch(lang), { plugins })
		expect(codes).toContain(2322)
		expect(codes).not.toContain(2304)
	})

	it.each(FENCE_TAGS)("replaceTsconfig keeps allowJs and checkJs on for a `%s` fence", async (tag, lang) => {
		const cwd = tempProject(slim({ strict: false, allowJs: false, checkJs: false }))
		const plugins = [pluginWithHook(() => ({ replaceTsconfig: true, compilerOptions: slimLib }))]
		expect(await typescriptCodes(cwd, tag, mismatch(lang), { plugins })).toContain(2322)
	})
})

describe("replaceTsconfig", () => {
	const loose = { "tsconfig.docs.json": JSON.stringify({ compilerOptions: { strict: false, ...slimLib } }) }

	it("ignores tsconfig.docs.json and starts from Kiira's defaults", async () => {
		const cwd = tempProject(loose)
		expect(await typescriptCodes(cwd, "ts", implicitAny, {})).not.toContain(7006)
		const plugins = [pluginWithHook(() => ({ replaceTsconfig: true, compilerOptions: slimLib }))]
		expect(await typescriptCodes(cwd, "ts", implicitAny, { plugins })).toContain(7006)
	})

	it("applies the hook's compilerOptions on top of the defaults", async () => {
		const cwd = tempProject(loose)
		const compilerOptions = { ...slimLib, noImplicitAny: false }
		const plugins = [pluginWithHook(() => ({ replaceTsconfig: true, compilerOptions }))]
		expect(await typescriptCodes(cwd, "ts", implicitAny, { plugins })).not.toContain(7006)
	})

	it("keeps checkJs off when the hook's options turn it off", async () => {
		const cwd = tempProject()
		const compilerOptions = { ...slimLib, checkJs: false }
		const plugins = [pluginWithHook(() => ({ replaceTsconfig: true, compilerOptions }))]
		expect(await typescriptCodes(cwd, "js", mismatch("js"), { plugins })).not.toContain(2322)
	})
})

describe("partitioning", () => {
	it("checks files whose hook results differ in separate programs", async () => {
		const cwd = tempProject({
			"strict.md": docWithFence("ts", implicitAny),
			"loose.md": docWithFence("ts", implicitAny),
		})
		const collect = vi.spyOn(classicEngine, "collect")
		try {
			const result = await checkMarkdownFiles({
				cwd,
				files: ["strict.md", "loose.md"],
				config: {
					engine: "classic",
					plugins: [
						definePlugin({
							name: "hook",
							typescript: (file) => (file === "loose.md" ? { compilerOptions: { noImplicitAny: false } } : undefined),
						}),
					],
				},
			})
			expect(result.diagnostics.filter((d) => d.code === 7006).map((d) => d.markdownFile)).toEqual(["strict.md"])
			expect(collect).toHaveBeenCalledTimes(2)
			const [first, second] = collect.mock.calls
			expect(first?.[0].map((vf) => vf.snippet.markdownFile)).toEqual(["strict.md"])
			expect(second?.[0].map((vf) => vf.snippet.markdownFile)).toEqual(["loose.md"])
		} finally {
			collect.mockRestore()
		}
	})

	it("shares one program between files whose final options are equal", async () => {
		const cwd = tempProject({
			"a.md": docWithFence("ts", "export const a = 1"),
			"b.md": docWithFence("ts", "export const b = 2"),
		})
		const collect = vi.spyOn(classicEngine, "collect")
		try {
			await checkMarkdownFiles({
				cwd,
				files: ["a.md", "b.md"],
				config: { engine: "classic", plugins: [pluginWithHook(() => ({ compilerOptions: { noImplicitAny: false } }))] },
			})
			expect(collect).toHaveBeenCalledTimes(1)
		} finally {
			collect.mockRestore()
		}
	})
})

describe("filterDiagnostic", () => {
	it("hands the hook the file and the snippet containing the diagnostic", async () => {
		const cwd = tempProject()
		const seen: Array<{ file: string; code: string }> = []
		const plugins = [
			pluginWithHook(() => ({
				filterDiagnostic: (d, info) => {
					seen.push({ file: info.file, code: info.snippet.code })
					return d.code !== 2304
				},
			})),
		]
		const text = [
			"# T",
			"",
			"```ts",
			"export const one = 1",
			"```",
			"",
			"```ts",
			'export const a: number = "x"',
			"missing()",
			"```",
			"",
		].join("\n")
		const { diagnostics } = await checkMarkdownText({
			cwd,
			markdownFile: "doc.md",
			text,
			config: { engine: "classic", defaultGroup: "file", plugins },
		})
		expect(diagnostics.filter((d) => d.source === "typescript").map((d) => d.code)).toEqual([2322])
		// Both fences share one virtual file; the diagnostics sit in the second fence.
		expect(seen).toHaveLength(2)
		expect(seen.every((s) => s.file === "doc.md" && s.code.startsWith("export const a"))).toBe(true)
	})

	it("runs before document rules see the diagnostics", async () => {
		const cwd = tempProject()
		let seen: unknown[] = []
		const plugin = definePlugin({
			name: "hook",
			typescript: () => ({ filterDiagnostic: () => false }),
			rules: {
				spy: defineRule({
					meta: { scope: "document", defaultSeverity: "warn" },
					create(ctx) {
						seen = [...ctx.diagnostics]
					},
				}),
			},
		})
		await checkMarkdownText({
			cwd,
			markdownFile: "doc.md",
			text: docWithFence("ts", mismatch("ts")),
			config: { engine: "classic", plugins: [plugin] },
		})
		expect(seen).toEqual([])
	})
})

describe("merging hooks", () => {
	it("runs presets' hooks in preset order, then plugins' hooks in plugin order, later results winning", async () => {
		const cwd = tempProject()
		const calls: string[] = []
		const preset = (name: string, result: TypescriptHookResult): KiiraPreset => ({
			name,
			typescript: (file) => {
				calls.push(`${name}:${file}`)
				return result
			},
		})
		const filterA = vi.fn(() => true)
		const filterB = vi.fn(() => false)
		const config = resolveConfig({
			presets: [
				preset("one", {
					compilerOptions: { noImplicitAny: false, strictNullChecks: false },
					paths: { "@a/*": ["./a/*"], "@b/*": ["./b/*"] },
					filterDiagnostic: filterA,
				}),
				preset("two", { compilerOptions: { noImplicitAny: true }, paths: { "@b/*": ["./two/*"] } }),
			],
			plugins: [
				definePlugin({
					name: "p",
					typescript: (file) => {
						calls.push(`plugin:${file}`)
						return { paths: { "@b/*": ["./plugin/*"] }, filterDiagnostic: filterB }
					},
				}),
			],
		})
		const resolver = createOptionsResolver(cwd, config, await shared(cwd))
		const hook = await resolver.hookFor("doc.md", { text: "", snippets: [] })
		expect(calls).toEqual(["one:doc.md", "two:doc.md", "plugin:doc.md"])
		const options = await resolver.optionsFor("doc.md", hook)
		expect(options.noImplicitAny).toBe(true)
		expect(options.strictNullChecks).toBe(false)
		expect(options.paths).toMatchObject({ "@a/*": ["./a/*"], "@b/*": ["./plugin/*"] })
		// A diagnostic is dropped when any filter returns false.
		const diagnostic = { severity: "error", message: "m", source: "typescript" } as KiiraDiagnostic
		const info = { snippet: {} as never, file: "doc.md" }
		expect(hook?.filters.map((keep) => keep(diagnostic, info))).toEqual([true, false])
	})

	it("turns replaceTsconfig on when any hook says so", async () => {
		const cwd = tempProject({ "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false } }) })
		const config = resolveConfig({
			plugins: [
				pluginWithHook(() => ({ replaceTsconfig: false }), "a"),
				pluginWithHook(() => ({ replaceTsconfig: true }), "b"),
				pluginWithHook(() => undefined, "c"),
			],
		})
		const resolver = createOptionsResolver(cwd, config, await shared(cwd))
		const hook = await resolver.hookFor("doc.md", { text: "", snippets: [] })
		expect(hook?.replaceTsconfig).toBe(true)
		expect((await resolver.optionsFor("doc.md", hook)).strict).toBe(true)
	})

	it("returns undefined when no hook returns a result", async () => {
		const cwd = tempProject()
		const config = resolveConfig({ plugins: [pluginWithHook(() => undefined)] })
		const input = { file: "d.md", text: "", snippets: [], ...(await shared(cwd)) }
		expect(runTypescriptHooks(config, input)).toBeUndefined()
	})

	it("layers overrides, then the hook's compilerOptions, then its paths", async () => {
		const cwd = tempProject()
		const config = resolveConfig({
			overrides: [{ include: ["**/*.md"], noImplicitAny: false, strictNullChecks: false }],
			plugins: [pluginWithHook(() => ({ compilerOptions: { strictNullChecks: true }, paths: { "@x/*": ["./x/*"] } }))],
		})
		const resolver = createOptionsResolver(cwd, config, await shared(cwd))
		const hook = await resolver.hookFor("doc.md", { text: "", snippets: [] })
		const options = await resolver.optionsFor("doc.md", hook)
		expect(options.noImplicitAny).toBe(false)
		expect(options.strictNullChecks).toBe(true)
		expect(options.paths).toEqual({ "@x/*": ["./x/*"] })
		expect(options.pathsBasePath).toBe(cwd)
	})

	it("throws naming the plugin and file for invalid compilerOptions", async () => {
		const cwd = tempProject()
		const config = resolveConfig({
			plugins: [pluginWithHook(() => ({ compilerOptions: { target: "nope" } }), "bad")],
		})
		const resolver = createOptionsResolver(cwd, config, await shared(cwd))
		await expect(resolver.hookFor("docs/a.md", { text: "", snippets: [] })).rejects.toThrow(/plugin "bad".*docs\/a\.md/)
	})

	it("names the preset when a preset's hook throws", async () => {
		const cwd = tempProject()
		const boom: KiiraPreset = {
			name: "boom",
			typescript: () => {
				throw new Error("nope")
			},
		}
		const resolver = createOptionsResolver(cwd, resolveConfig({ presets: [boom] }), await shared(cwd))
		await expect(resolver.hookFor("a.md", { text: "", snippets: [] })).rejects.toThrow(/preset "boom".*a\.md.*nope/)
	})

	it("hands hooks the document text, snippets, project, and fs", async () => {
		const cwd = tempProject({ "data.txt": "hello" })
		const seen: unknown[] = []
		const text = docWithFence("ts", "export const a = 1")
		const plugin = definePlugin({
			name: "spy",
			typescript: (file, ctx) => {
				seen.push(
					file,
					ctx.file,
					ctx.text,
					ctx.snippets.map((s) => s.code),
					ctx.project.cwd,
					ctx.fs.readText("data.txt")
				)
				return undefined
			},
		})
		await checkMarkdownText({ cwd, markdownFile: "doc.md", text, config: { engine: "classic", plugins: [plugin] } })
		expect(seen).toEqual(["doc.md", "doc.md", text, ["export const a = 1"], cwd, "hello"])
	})
})

describe("helpers", () => {
	it("stableStringify sorts keys and skips functions", () => {
		expect(stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: () => 1 } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}')
	})

	it("applyTypescriptHook leaves paths alone when the hook has none", () => {
		const base = { strict: true }
		const hook = { compilerOptions: {}, paths: {}, replaceTsconfig: false, filters: [] }
		expect(applyTypescriptHook("/x", base, hook)).toEqual(base)
	})

	it("documentFromVirtualFiles joins the checked fences when there is no text", () => {
		const vf = (id: string, code: string) => ({ snippet: { id, markdownFile: "d.md", code } }) as never
		const doc = documentFromVirtualFiles("d.md", [vf("1", "a"), vf("2", "b"), vf("2", "b")])
		expect(doc.text).toBe("a\n\nb")
		expect(doc.snippets).toHaveLength(2)
		expect(documentFromVirtualFiles("d.md", [vf("1", "a")], "whole").text).toBe("whole")
	})
})
