import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/overrides")

describe("config overrides", () => {
	it("applies per-glob compiler options to matching files only", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["strict.md", "loose.md"],
			config: {
				include: ["**/*.md"],
				overrides: [{ include: ["**/loose.md"], noImplicitAny: false }],
			},
		})

		const implicitAny = result.diagnostics.filter((d) => d.code === 7006)
		// The implicit-any error fires for strict.md but is overridden away for loose.md.
		expect(implicitAny).toHaveLength(1)
		expect(implicitAny[0]?.markdownFile).toBe("strict.md")
	})

	it("reports the error for both files without the override", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["strict.md", "loose.md"],
			config: { include: ["**/*.md"] },
		})
		expect(result.diagnostics.filter((d) => d.code === 7006)).toHaveLength(2)
	})
})
