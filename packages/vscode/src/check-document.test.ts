import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkDocument } from "./check-document"

const here = dirname(fileURLToPath(import.meta.url))
// Reuse the CLI fixture project (a workspace with node_modules available above it).
const cwd = resolve(here, "../../cli/tests/fixtures/project")

describe("checkDocument", () => {
	it("reports type errors from in-memory document text", async () => {
		const result = await checkDocument({
			cwd,
			markdownFile: "inline.md",
			text: ["```ts", 'const n: number = "nope"', "```", ""].join("\n"),
			config: { include: ["**/*.md"] },
		})
		const error = result.diagnostics.find((d) => d.code === 2322)
		expect(error).toBeDefined()
		expect(error?.markdownFile).toBe("inline.md")
		// The fence opens on line 0, so the code is on line 1.
		expect(error?.markdownRange.start.line).toBe(1)
	})

	it("returns no diagnostics for clean text and exposes virtual files", async () => {
		const result = await checkDocument({
			cwd,
			markdownFile: "inline.md",
			text: ["```ts", "const n: number = 1", "```", ""].join("\n"),
			config: { include: ["**/*.md"] },
		})
		expect(result.diagnostics).toHaveLength(0)
		expect(result.virtualFiles).toHaveLength(1)
		expect(result.virtualFiles[0]?.content).toContain("const n: number = 1")
	})
})
