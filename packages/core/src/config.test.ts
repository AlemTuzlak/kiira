import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { defineConfig, findConfigFile, loadConfig, loadConfigFile, resolveConfig } from "./config"

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
		const noJiti = { loadJiti: () => Promise.reject(new Error("Cannot find package 'jiti'")) }
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
