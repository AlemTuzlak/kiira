import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/jsxframework")

describe("framework jsxImportSource suggestion", () => {
	it("suggests a jsxImportSource override (with a config-override fix) from the file path", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["ai-solid.md"],
			config: { include: ["**/*.md"] },
		})

		const suggestion = result.diagnostics.find((d) => d.code === "jsx-framework")
		expect(suggestion).toBeDefined()
		expect(suggestion?.fix).toEqual({
			kind: "config-override",
			include: "**/*solid*",
			compilerOptions: { jsxImportSource: "solid-js" },
		})
	})

	it("suggests for every affected file (the fix is de-duplicated at apply time)", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["ai-solid.md", "widget-solid.md"],
			config: { include: ["**/*.md"] },
		})
		const suggestions = result.diagnostics.filter((d) => d.code === "jsx-framework")
		expect(suggestions.map((d) => d.markdownFile).sort()).toEqual(["ai-solid.md", "widget-solid.md"])
	})

	it("throws on an invalid compiler option in an override", async () => {
		await expect(
			checkMarkdownFiles({
				cwd: fixtures,
				files: ["ai-solid.md"],
				config: { include: ["**/*.md"], overrides: [{ include: ["**/*.md"], jsxImportSrc: "oops" }] },
			})
		).rejects.toThrow(/Invalid compilerOptions/)
	})

	it("does not re-suggest when an override already covers the file", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["ai-solid.md"],
			config: {
				include: ["**/*.md"],
				overrides: [{ include: ["**/*solid*"], jsxImportSource: "solid-js" }],
			},
		})
		expect(result.diagnostics.some((d) => d.code === "jsx-framework")).toBe(false)
	})
})
