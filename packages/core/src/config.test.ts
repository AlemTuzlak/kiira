import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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
})
