import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
	codeFenceLanguagesForFile,
	defineConfig,
	findConfigFile,
	loadConfig,
	loadConfigFile,
	resolveConfig,
	rulesForFile,
} from "./config"
import { defineRule } from "./plugin"
import type { KiiraConfig, KiiraPlugin, KiiraPreset, ResolvedKiiraConfig } from "./types"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures")

describe("defineConfig", () => {
	it("returns its argument unchanged", () => {
		const config = { include: ["a.md"] }
		expect(defineConfig(config)).toBe(config)
	})
})

describe("resolveConfig", () => {
	it("applies defaults to an empty config", () => {
		const resolved = resolveConfig()
		expect(resolved).toEqual({
			include: ["**/*.{md,mdx}"],
			exclude: [],
			allowEmpty: false,
			tsconfig: undefined,
			engine: "auto",
			overrides: [],
			packageMode: "workspace",
			defaultValidate: "type",
			defaultFixture: undefined,
			defaultGroup: "none",
			checkUnusedSymbols: false,
			checkRelativeImports: false,
			externalPackages: {},
			fixtures: {},
			languages: ["ts", "tsx", "js", "jsx"],
			markdown: {
				codeFenceLanguages: [
					"ts",
					"typescript",
					"tsx",
					"typescriptreact",
					"js",
					"javascript",
					"mjs",
					"cjs",
					"jsx",
					"javascriptreact",
				],
			},
			plugins: [],
			presets: [],
			ruleRegistry: expect.any(Object),
			ruleSettings: {
				"parse-error": { severity: "error", options: undefined },
				"fence-meta": { severity: "warn", options: undefined },
				"language-tag": { severity: "warn", options: undefined },
				group: { severity: "warn", options: undefined },
				"jsx-framework": { severity: "warn", options: undefined },
				"unused-symbols": { severity: "off", options: undefined },
				"relative-imports": { severity: "off", options: undefined },
				"broken-link": { severity: "off", options: { anchors: false } },
				"max-lines": { severity: "off", options: undefined },
				"deprecated-import": { severity: "off", options: undefined },
			},
			ruleOverrides: {},
		})
	})

	it("preserves externalPackages and defaults it to an empty object", () => {
		expect(resolveConfig({ externalPackages: { zod: "^3" } }).externalPackages).toEqual({ zod: "^3" })
		expect(resolveConfig().externalPackages).toEqual({})
	})

	it("preserves provided values", () => {
		const resolved = resolveConfig({
			include: ["docs/**/*.md"],
			languages: ["ts"],
			defaultValidate: "none",
		})
		expect(resolved.include).toEqual(["docs/**/*.md"])
		expect(resolved.languages).toEqual(["ts"])
		expect(resolved.defaultValidate).toBe("none")
		// codeFenceLanguages defaults to the configured languages plus their aliases.
		expect(resolved.markdown.codeFenceLanguages).toEqual(["ts", "typescript"])
	})

	it("defaults include to cover .md and .mdx", () => {
		expect(resolveConfig({}).include).toEqual(["**/*.{md,mdx}"])
	})

	it("defaults defaultGroup to none", () => {
		expect(resolveConfig({}).defaultGroup).toBe("none")
	})

	it("passes through an explicit defaultGroup", () => {
		expect(resolveConfig({ defaultGroup: "file" }).defaultGroup).toBe("file")
	})
})

describe("findConfigFile", () => {
	it("finds a JSON config", () => {
		const found = findConfigFile(resolve(fixtures, "config-json"))
		expect(found?.endsWith("kiira.config.json")).toBe(true)
	})

	it("returns null when no config exists", () => {
		expect(findConfigFile(resolve(fixtures, "config-none"))).toBeNull()
	})
})

describe("loadConfig", () => {
	it("loads a TypeScript config via its default export", async () => {
		const config = await loadConfig(resolve(fixtures, "config-ts"))
		expect(config.include).toEqual(["docs/**/*.md"])
		expect(config.defaultValidate).toBe("none")
	})

	it("loads a JSON config", async () => {
		const config = await loadConfig(resolve(fixtures, "config-json"))
		expect(config.include).toEqual(["readme/**/*.md"])
		expect(config.packageMode).toBe("packed")
	})

	it("returns a default config when none is found", async () => {
		const config = await loadConfig(resolve(fixtures, "config-none"))
		expect(config.include).toEqual(["**/*.{md,mdx}"])
	})
})

describe("loadConfigFile", () => {
	it("loads a config from an explicit path", async () => {
		const config = await loadConfigFile(resolve(fixtures, "config-json/kiira.config.json"))
		expect(config.include).toEqual(["readme/**/*.md"])
	})

	describe("without jiti", () => {
		const noJiti = {
			loadJiti: () =>
				Promise.reject(Object.assign(new Error("Cannot find package 'jiti'"), { code: "ERR_MODULE_NOT_FOUND" })),
		}
		let dir: string

		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "kiira-config-"))
		})
		afterEach(() => rmSync(dir, { recursive: true, force: true }))

		it("imports a .mjs config natively and takes its default export", async () => {
			const file = join(dir, "kiira.config.mjs")
			writeFileSync(file, 'export default { include: ["docs/**/*.md"] }\n')
			const urls: string[] = []
			const config = await loadConfigFile(file, {
				...noJiti,
				importNative: (url) => {
					urls.push(url)
					return import(url)
				},
			})
			expect(config.include).toEqual(["docs/**/*.md"])
			expect(urls).toEqual([pathToFileURL(file).href])
		})

		it("falls back to the module itself when there is no default export", async () => {
			const config = await loadConfigFile(join(dir, "kiira.config.cjs"), {
				...noJiti,
				importNative: async () => ({ include: ["a.md"] }),
			})
			expect(config.include).toEqual(["a.md"])
		})

		it("explains how to load a TypeScript config when the native import fails", async () => {
			await expect(
				loadConfigFile(join(dir, "kiira.config.ts"), {
					...noJiti,
					importNative: () => Promise.reject(new Error("Unknown file extension")),
				})
			).rejects.toThrow(
				'Loading a TypeScript Kiira config needs the "jiti" package or a Node version that strips types natively.'
			)
		})

		it("rethrows a jiti load error that is not a missing module", async () => {
			const importNative = vi.fn()
			await expect(
				loadConfigFile(join(dir, "kiira.config.ts"), {
					loadJiti: () => Promise.reject(new SyntaxError("broken jiti")),
					importNative,
				})
			).rejects.toThrow("broken jiti")
			expect(importNative).not.toHaveBeenCalled()
		})

		it("rethrows native import errors for non-TypeScript configs", async () => {
			await expect(
				loadConfigFile(join(dir, "kiira.config.mjs"), {
					...noJiti,
					importNative: () => Promise.reject(new Error("boom")),
				})
			).rejects.toThrow("boom")
		})
	})
})

const shout = defineRule({
	meta: { scope: "document", defaultSeverity: "warn", options: { default: { times: 1 } } },
	create() {},
})

const strict = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "off",
		options: {
			validate: (options) => (typeof options === "number" ? undefined : "expected a number"),
		},
	},
	create() {},
})

const demo: KiiraPlugin = {
	name: "demo",
	rules: { shout, strict },
	presets: [{ name: "loud", rules: { "demo/shout": "error" } }],
}

function levels(resolved: ResolvedKiiraConfig, file = "doc.md"): Record<string, string> {
	return Object.fromEntries(Object.entries(rulesForFile(resolved, file)).map(([id, s]) => [id, s.severity]))
}

describe("resolveConfig rules", () => {
	it("registers built-in rules unprefixed and plugin rules as <plugin>/<rule>", () => {
		const resolved = resolveConfig({ plugins: [demo] })
		expect(Object.keys(resolved.ruleRegistry)).toEqual([
			"parse-error",
			"fence-meta",
			"language-tag",
			"group",
			"jsx-framework",
			"unused-symbols",
			"relative-imports",
			"broken-link",
			"max-lines",
			"deprecated-import",
			"demo/shout",
			"demo/strict",
		])
	})

	it("returns an already-resolved config unchanged", () => {
		const resolved = resolveConfig({ plugins: [demo], rules: { "demo/shout": "off" } })
		expect(resolveConfig(resolved)).toBe(resolved)
	})

	it("lets a resolved config take CLI rule levels without re-resolving it", () => {
		const resolved = resolveConfig({ plugins: [demo] })
		const withCli = resolveConfig(resolved, { "demo/shout": "off" })
		expect(withCli.ruleRegistry).toBe(resolved.ruleRegistry)
		expect(levels(withCli)["demo/shout"]).toBe("off")
		expect(() => resolveConfig(resolved, { nope: "off" })).toThrow(/Unknown rule "nope" in --rule/)
	})

	it("applies each layer on top of the previous one", () => {
		const base: KiiraPreset = { name: "base", rules: { "demo/shout": "off", group: "error" } }
		const ext: KiiraPreset = { name: "ext", extends: ["demo/loud"], rules: { group: "off" } }
		const config: KiiraConfig = {
			plugins: [demo],
			presets: [base, ext],
			rules: { "demo/shout": "warn" },
			overrides: [
				{ include: ["docs/**"], rules: { "demo/shout": "error" } },
				{ include: ["docs/a.md"], rules: { "demo/shout": "off" } },
			],
		}
		const resolved = resolveConfig(config)

		// built-in default -> preset -> `rules` -> matching overrides in order -> CLI.
		expect(levels(resolveConfig({ plugins: [demo] }))["demo/shout"]).toBe("warn")
		expect(levels(resolveConfig({ plugins: [demo], presets: ["demo/loud"] }))["demo/shout"]).toBe("error")
		expect(levels(resolved, "other.md")["demo/shout"]).toBe("warn")
		expect(levels(resolved, "docs/b.md")["demo/shout"]).toBe("error")
		expect(levels(resolved, "docs/a.md")["demo/shout"]).toBe("off")
		const cli = resolveConfig(resolved, { "demo/shout": "error" })
		expect(levels(cli, "docs/a.md")["demo/shout"]).toBe("error")
	})

	it("applies presets in order, with extends flattened in front of the extending preset", () => {
		const a: KiiraPreset = { name: "a", rules: { group: "error" } }
		const b: KiiraPreset = { name: "b", extends: ["p/a"], rules: { "jsx-framework": "error" } }
		const plugin: KiiraPlugin = { name: "p", presets: [a, b] }
		const resolved = resolveConfig({ plugins: [plugin], presets: ["p/b"] })
		expect(resolved.presets.map((p) => p.name)).toEqual(["a", "b"])
		expect(levels(resolved).group).toBe("error")
		// Later presets win over what they extend.
		const flipped = resolveConfig({
			plugins: [{ name: "p", presets: [a, { name: "c", extends: ["p/a"], rules: { group: "off" } }] }],
			presets: ["p/c"],
		})
		expect(levels(flipped).group).toBe("off")
	})

	it("applies a preset shared through extends once, at its first use", () => {
		const base: KiiraPreset = { name: "base", rules: { group: "warn" } }
		const left: KiiraPreset = { name: "left", extends: ["p/base"], rules: { group: "error" } }
		const right: KiiraPreset = { name: "right", extends: ["p/base"], rules: { "jsx-framework": "error" } }
		const plugin: KiiraPlugin = { name: "p", presets: [base, left, right] }
		const resolved = resolveConfig({ plugins: [plugin], presets: ["p/left", "p/right"] })
		expect(resolved.presets.map((p) => p.name)).toEqual(["base", "left", "right"])
		// A second copy of `base` after `left` would set `group` back to "warn".
		expect(levels(resolved)).toMatchObject({ group: "error", "jsx-framework": "error" })
	})

	it("treats the legacy toggles as the same layer as `rules`, with an explicit rule winning", () => {
		expect(levels(resolveConfig({ checkUnusedSymbols: true }))["unused-symbols"]).toBe("error")
		expect(levels(resolveConfig({ checkRelativeImports: true }))["relative-imports"]).toBe("error")
		expect(levels(resolveConfig({ checkUnusedSymbols: false }))["unused-symbols"]).toBe("off")
		const both = resolveConfig({ checkUnusedSymbols: true, rules: { "unused-symbols": "warn" } })
		expect(levels(both)["unused-symbols"]).toBe("warn")
		expect(both.checkUnusedSymbols).toBe(true)
		const viaPreset = resolveConfig({ presets: [{ name: "p", rules: { "unused-symbols": "warn" } }] })
		expect(viaPreset.checkUnusedSymbols).toBe(true)
		// The CLI level reaches the base-level compiler option toggle.
		expect(resolveConfig({ checkUnusedSymbols: true }, { "unused-symbols": "off" }).checkUnusedSymbols).toBe(false)
	})

	it("keeps rule options from the default or the setting through later severity-only layers", () => {
		const resolved = resolveConfig({
			plugins: [demo],
			rules: { "demo/shout": ["warn", { times: 3 }] },
			overrides: [{ include: ["a.md"], rules: { "demo/shout": "error" } }],
		})
		expect(resolveConfig({ plugins: [demo] }).ruleSettings["demo/shout"]?.options).toEqual({ times: 1 })
		expect(resolved.ruleSettings["demo/shout"]?.options).toEqual({ times: 3 })
		expect(rulesForFile(resolved, "a.md")["demo/shout"]).toEqual({ severity: "error", options: { times: 3 } })
		const cli = resolveConfig(resolved, { "demo/shout": "off" })
		expect(rulesForFile(cli, "b.md")["demo/shout"]).toEqual({ severity: "off", options: { times: 3 } })
	})

	it("applies override presets (rules only) and override rules per file", () => {
		const resolved = resolveConfig({
			plugins: [demo],
			overrides: [{ include: ["docs/**"], presets: ["demo/loud"], rules: { group: "off" } }],
		})
		expect(levels(resolved, "docs/x.md")).toMatchObject({ "demo/shout": "error", group: "off" })
		expect(levels(resolved, "x.md")).toMatchObject({ "demo/shout": "warn", group: "warn" })
	})
})

describe("resolveConfig errors", () => {
	it.each([
		[
			"an unknown rule",
			{ rules: { nope: "off" } },
			/Unknown rule "nope" in `rules`\. Known rules: parse-error, fence-meta/,
		],
		[
			"an unknown rule in an override",
			{ overrides: [{ include: ["a.md"], rules: { nope: "off" } }] },
			/Unknown rule "nope" in override \["a\.md"\]/,
		],
		[
			"an unknown rule in a preset",
			{ presets: [{ name: "p", rules: { nope: "off" } }] },
			/Unknown rule "nope" in preset "p"/,
		],
		["an unknown preset", { presets: ["nope"] }, /Unknown preset "nope"\. Known presets: recommended\./],
		["an unknown override preset", { overrides: [{ include: ["a.md"], presets: ["nope"] }] }, /Unknown preset "nope"/],
		[
			"an invalid level",
			{ rules: { group: "loud" } },
			/Invalid level "loud" for rule "group" in `rules`\. Expected "off", "warn", or "error"/,
		],
		[
			"a malformed pair",
			{ rules: { group: ["warn"] } },
			/Rule "group" in `rules` must be a level or a \[level, options\] pair/,
		],
		["a plugin without a name", { plugins: [{ rules: {} }] }, /Each Kiira plugin needs a non-empty `name`/],
		["an inline preset without a name", { presets: [{ rules: {} }] }, /Each inline preset needs a non-empty `name`/],
	] as Array<[string, unknown, RegExp]>)("rejects %s", (_name, config, message) => {
		expect(() => resolveConfig(config as KiiraConfig)).toThrow(message)
	})

	it("rejects options that fail the rule's validate", () => {
		expect(() => resolveConfig({ plugins: [demo], rules: { "demo/strict": ["warn", "x"] } })).toThrow(
			/Invalid options for rule "demo\/strict" in `rules`: expected a number/
		)
		const ok = resolveConfig({ plugins: [demo], rules: { "demo/strict": ["warn", 2] } })
		expect(ok.ruleSettings["demo/strict"]).toEqual({ severity: "warn", options: 2 })
	})

	it("rejects duplicate rules and presets", () => {
		const twice: KiiraPlugin = { name: "dup", rules: { shout } }
		expect(() => resolveConfig({ plugins: [twice, twice] })).toThrow(/Rule "dup\/shout" is defined twice/)
		const presets: KiiraPlugin = { name: "dup", presets: [{ name: "x" }, { name: "x" }] }
		expect(() => resolveConfig({ plugins: [presets] })).toThrow(/Preset "dup\/x" is defined twice/)
	})

	it("rejects a rule that was not made with defineRule", () => {
		const broken = { name: "bad", rules: { r: {} } } as unknown as KiiraPlugin
		expect(() => resolveConfig({ plugins: [broken] })).toThrow(/Rule "bad\/r" must be created with defineRule/)
	})

	it("rejects a preset cycle", () => {
		const plugin: KiiraPlugin = {
			name: "c",
			presets: [
				{ name: "a", extends: ["c/b"] },
				{ name: "b", extends: ["c/a"] },
			],
		}
		expect(() => resolveConfig({ plugins: [plugin], presets: ["c/a"] })).toThrow(
			/Preset "c\/a" extends itself \(via c\/a -> c\/b -> c\/a\)/
		)
	})

	it("does not mistake presets with the same name in different plugins for a cycle", () => {
		const a: KiiraPlugin = { name: "a", presets: [{ name: "recommended", rules: { group: "error" } }] }
		const b: KiiraPlugin = { name: "b", presets: [{ name: "recommended", extends: ["a/recommended"] }] }
		const resolved = resolveConfig({ plugins: [a, b], presets: ["b/recommended"] })
		expect(resolved.presets).toEqual([a.presets?.[0], b.presets?.[0]])
		expect(levels(resolved).group).toBe("error")
	})

	it.each([
		["scope", { scope: "documents", defaultSeverity: "warn" }, /Rule "bad\/r" has an invalid scope "documents"/],
		[
			"defaultSeverity",
			{ scope: "document", defaultSeverity: "warning" },
			/Rule "bad\/r" has an invalid defaultSeverity "warning"\. Expected "off", "warn", or "error"/,
		],
	])("rejects a rule with an invalid %s", (_field, meta, message) => {
		const plugin = { name: "bad", rules: { r: { meta, create() {} } } } as unknown as KiiraPlugin
		expect(() => resolveConfig({ plugins: [plugin] })).toThrow(message)
	})
})

describe("resolveConfig presets", () => {
	it("unions array includes with the top-level include and concatenates excludes", () => {
		const resolved = resolveConfig({
			include: ["docs/**/*.md"],
			exclude: ["docs/old/**"],
			presets: [
				{ name: "a", include: ["README.md"], exclude: ["skip/**"] },
				{ name: "b", include: ["packages/*/README.md"] },
			],
		})
		expect(resolved.include).toEqual(["docs/**/*.md", "README.md", "packages/*/README.md"])
		expect(resolved.exclude).toEqual(["docs/old/**", "skip/**"])
	})

	it("keeps the default include only when neither the config nor a preset gives one", () => {
		expect(resolveConfig({ presets: [{ name: "a" }] }).include).toEqual(["**/*.{md,mdx}"])
		expect(resolveConfig({ presets: [{ name: "a", include: ["a.md"] }] }).include).toEqual(["a.md"])
		expect(resolveConfig({ presets: [{ name: "a", include: () => ["a.md"] }] }).include).toEqual([])
	})

	it("sets allowEmpty when any preset does", () => {
		expect(resolveConfig({}).allowEmpty).toBe(false)
		expect(resolveConfig({ presets: [{ name: "a" }, { name: "b", allowEmpty: true }] }).allowEmpty).toBe(true)
	})

	it("lets the last preset set codeFenceLanguages unless markdown.codeFenceLanguages is explicit", () => {
		const presets = [
			{ name: "a", codeFenceLanguages: ["ts"] },
			{ name: "b", codeFenceLanguages: ["js", "jsx"] },
		]
		expect(resolveConfig({ presets }).markdown.codeFenceLanguages).toEqual(["js", "jsx"])
		const explicit = resolveConfig({ presets, markdown: { codeFenceLanguages: ["tsx"] } })
		expect(explicit.markdown.codeFenceLanguages).toEqual(["tsx"])
	})
})

describe("rulesForFile memoization", () => {
	it("returns the same settings object for the same config and file", () => {
		const resolved = resolveConfig({ overrides: [{ include: ["docs/**"], rules: { group: "off" } }] })
		expect(rulesForFile(resolved, "docs/a.md")).toBe(rulesForFile(resolved, "docs/a.md"))
		expect(rulesForFile(resolved)).toBe(rulesForFile(resolved))
		expect(rulesForFile(resolved, "docs/a.md").group?.severity).toBe("off")
		expect(rulesForFile(resolved, "other.md").group?.severity).toBe("warn")
	})

	it("does not share settings between two resolved configs", () => {
		const a = resolveConfig({ rules: { group: "off" } })
		const b = resolveConfig({ rules: { group: "error" } })
		expect(rulesForFile(a, "x.md").group?.severity).toBe("off")
		expect(rulesForFile(b, "x.md").group?.severity).toBe("error")
	})
})

describe("codeFenceLanguagesForFile", () => {
	it("uses the last matching override, including its presets, per file", () => {
		const resolved = resolveConfig({
			markdown: { codeFenceLanguages: ["ts"] },
			overrides: [
				{ include: ["docs/**"], codeFenceLanguages: ["js"] },
				{ include: ["docs/a.md"], presets: [{ name: "p", codeFenceLanguages: ["jsx"] }] },
				{
					include: ["docs/b.md"],
					presets: [{ name: "p", codeFenceLanguages: ["jsx"] }],
					codeFenceLanguages: ["tsx"],
				},
			],
		})
		expect(codeFenceLanguagesForFile(resolved, "x.md")).toEqual(["ts"])
		expect(codeFenceLanguagesForFile(resolved, "docs/x.md")).toEqual(["js"])
		expect(codeFenceLanguagesForFile(resolved, "docs/a.md")).toEqual(["jsx"])
		expect(codeFenceLanguagesForFile(resolved, "docs/b.md")).toEqual(["tsx"])
	})
})
