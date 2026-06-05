import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveConfig } from "./config"
import { extractMarkdownSnippets, extractSnippetsFromContent } from "./extract"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/markdown")

describe("extractMarkdownSnippets", () => {
	it("extracts supported-language fences and skips unsupported ones", async () => {
		const snippets = await extractMarkdownSnippets({
			cwd: fixtures,
			files: ["intro.md"],
			config: { include: ["**/*.md"] },
		})

		// ts, tsx, and the ignored ts fence are extracted; bash is skipped.
		expect(snippets.map((s) => s.lang)).toEqual(["ts", "tsx", "ts"])
	})

	it("captures file, code, and zero-based positions for the first snippet", async () => {
		const [first] = await extractMarkdownSnippets({
			cwd: fixtures,
			files: ["intro.md"],
			config: { include: ["**/*.md"] },
		})

		expect(first).toBeDefined()
		expect(first?.markdownFile).toBe("intro.md")
		expect(first?.lang).toBe("ts")
		expect(first?.code).toBe('import { useChat } from "@tanstack/ai/react"\n\nexport const x = 1')
		expect(first?.markdownRange.start.line).toBe(2)
		expect(first?.markdownRange.end.line).toBe(6)
		// The code content begins on the line after the opening fence.
		expect(first?.codeStart).toEqual({ line: 3, character: 0 })
	})

	it("parses fence metadata onto the snippet", async () => {
		const snippets = await extractMarkdownSnippets({
			cwd: fixtures,
			files: ["intro.md"],
			config: { include: ["**/*.md"] },
		})
		const tsx = snippets.find((s) => s.lang === "tsx")
		expect(tsx?.meta).toEqual({ fixture: "react", name: "demo" })
	})

	it("marks ignored fences with meta.ignore", async () => {
		const snippets = await extractMarkdownSnippets({
			cwd: fixtures,
			files: ["intro.md"],
			config: { include: ["**/*.md"] },
		})
		const ignored = snippets.filter((s) => s.meta.ignore)
		expect(ignored).toHaveLength(1)
		expect(ignored[0]?.codeStart.line).toBe(17)
	})

	it("assigns stable, unique ids", async () => {
		const snippets = await extractMarkdownSnippets({
			cwd: fixtures,
			files: ["intro.md"],
			config: { include: ["**/*.md"] },
		})
		const ids = snippets.map((s) => s.id)
		expect(new Set(ids).size).toBe(ids.length)
		expect(ids[0]).toBe("intro.md#0")
	})

	it("honours a restricted language set", async () => {
		const snippets = await extractMarkdownSnippets({
			cwd: fixtures,
			files: ["intro.md"],
			config: { include: ["**/*.md"], languages: ["tsx"] },
		})
		expect(snippets.map((s) => s.lang)).toEqual(["tsx"])
	})

	it("recognizes fence-language aliases via codeFenceLanguages", () => {
		const config = resolveConfig({
			markdown: { codeFenceLanguages: ["typescript", "ts"] },
		})
		const content = ["```typescript", "const a = 1", "```", "", "```ts", "const b = 2", "```"].join("\n")
		const { snippets } = extractSnippetsFromContent({ markdownFile: "a.md", content, config })
		// Both fences are recognized and normalized to "ts".
		expect(snippets.map((s) => s.lang)).toEqual(["ts", "ts"])
	})
})
