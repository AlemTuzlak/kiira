import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/globals")

describe("default lib globals", () => {
	it("resolves ES and DOM globals (Date, JSON, console) when no project tsconfig is present", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"] },
		})
		// With the default `lib` including DOM, none of `Date`/`JSON`/`console` should
		// be reported as an undefined name.
		const errors = result.diagnostics.filter((d) => d.severity === "error")
		expect(errors).toHaveLength(0)
	})
})
