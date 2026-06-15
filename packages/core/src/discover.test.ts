import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { discoverMarkdownFiles } from "./discover"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/discover")

describe("discoverMarkdownFiles", () => {
	it("finds all Markdown files relative to cwd using posix separators", async () => {
		const files = await discoverMarkdownFiles({
			cwd: fixtures,
			include: ["**/*.md"],
		})
		expect(files).toEqual(["a.md", "generated/c.md", "nested/b.md"])
	})

	it("applies exclude globs", async () => {
		const files = await discoverMarkdownFiles({
			cwd: fixtures,
			include: ["**/*.md"],
			exclude: ["generated/**"],
		})
		expect(files).toEqual(["a.md", "nested/b.md"])
	})

	it("ignores non-Markdown files", async () => {
		const files = await discoverMarkdownFiles({
			cwd: fixtures,
			include: ["**/*"],
		})
		expect(files).not.toContain("not-markdown.txt")
	})

	it("returns a sorted, de-duplicated list when include globs overlap", async () => {
		const files = await discoverMarkdownFiles({
			cwd: fixtures,
			include: ["**/*.md", "a.md"],
		})
		expect(files).toEqual(["a.md", "generated/c.md", "nested/b.md"])
	})

	it("discovers .mdx files alongside .md", async () => {
		const files = await discoverMarkdownFiles({
			cwd: fixtures,
			include: ["**/*.{md,mdx}"],
		})
		expect(files).toContain("page.mdx")
		expect(files).toContain("a.md")
	})
})
