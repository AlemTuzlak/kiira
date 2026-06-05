import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/unused")

describe("checkUnusedSymbols", () => {
	it("suppresses unused-symbol errors (TS6133) by default", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"] },
		})
		expect(result.diagnostics.some((d) => d.code === 6133)).toBe(false)
		expect(result.stats.errors).toBe(0)
	})

	it("reports them when checkUnusedSymbols is enabled (forced on even though the tsconfig omits the flag)", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"], checkUnusedSymbols: true },
		})
		const unused = result.diagnostics.find((d) => d.code === 6133)
		expect(unused).toBeDefined()
		expect(unused?.message).toContain("unused")
	})
})
