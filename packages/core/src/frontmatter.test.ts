import { checkMarkdownText } from "./check"
import { resolveConfig } from "./config"
import { extractSnippetsFromContent, loadMdxSupport, parseDocument } from "./extract"
import { detectFrontmatter } from "./frontmatter"
import { definePlugin, defineRule } from "./plugin"
import { FENCE_TAGS, tempProject } from "./rules/test-helpers"
import type { RuleDocumentContext } from "./types"

beforeAll(loadMdxSupport)

const FILES = ["doc.md", "doc.mdx"]

describe("detectFrontmatter", () => {
	it("returns the raw text, range, and body start of a block", () => {
		const found = detectFrontmatter("---\nname: x\ntags: [a]\n---\n# Title\n")
		expect(found?.frontmatter).toEqual({
			raw: "name: x\ntags: [a]",
			range: { start: { line: 0, character: 0 }, end: { line: 3, character: 3 } },
			bodyStart: { line: 4, character: 0 },
		})
		expect(found?.blanked).toBe("   \n       \n         \n   \n# Title\n")
	})

	it("keeps CRLF in raw and in the blanked text", () => {
		const found = detectFrontmatter("---\r\nname: x\r\ntags: [a]\r\n---  \t\r\nbody\r\n")
		expect(found?.frontmatter.raw).toBe("name: x\r\ntags: [a]")
		expect(found?.frontmatter.range).toEqual({
			start: { line: 0, character: 0 },
			end: { line: 3, character: 6 },
		})
		expect(found?.frontmatter.bodyStart).toEqual({ line: 4, character: 0 })
		expect(found?.blanked).toBe("   \r\n       \r\n         \r\n      \r\nbody\r\n")
	})

	it("handles an empty block and a closing line at the end of the file", () => {
		expect(detectFrontmatter("---\n---")?.frontmatter.raw).toBe("")
		expect(detectFrontmatter("---\na\n---")?.blanked).toBe("   \n \n   ")
	})

	it("is not frontmatter without a closing line", () => {
		expect(detectFrontmatter("---\nname: x\n")).toBeUndefined()
		expect(detectFrontmatter("---\nname: x\n---x\n")).toBeUndefined()
		expect(detectFrontmatter("---")).toBeUndefined()
	})

	it("is not frontmatter unless `---` is at offset 0", () => {
		expect(detectFrontmatter("# Title\n\n---\nname: x\n---\n")).toBeUndefined()
		expect(detectFrontmatter("\n---\nname: x\n---\n")).toBeUndefined()
		expect(detectFrontmatter("--- \nname: x\n---\n")).toBeUndefined()
	})

	it("skips a byte order mark and gives the same block as without it", () => {
		const withBom = detectFrontmatter("﻿---\nname: x\n---\nbody\n")
		expect(withBom?.frontmatter).toEqual(detectFrontmatter("---\nname: x\n---\nbody\n")?.frontmatter)
		expect(withBom?.blanked).toBe("﻿   \n       \n   \nbody\n")
	})

	it("is not frontmatter when a code fence opens inside the block", () => {
		expect(detectFrontmatter("---\n\n```ts\nconst a = 1\n```\n\n---\n")).toBeUndefined()
		expect(detectFrontmatter("---\n~~~\nx\n~~~\n---\n")).toBeUndefined()
	})
})

describe("parsing a document with frontmatter", () => {
	it.each(FILES)("leaves no node for the block in %s", (file) => {
		const text = "---\ntitle: x\n---\nText after\n"
		const { mdast, frontmatter } = parseDocument(file, text)
		expect(mdast.children.map((n) => n.type)).toEqual(["paragraph"])
		expect(mdast.children[0]?.position?.start.line).toBe(4)
		expect(frontmatter?.raw).toBe("title: x")
	})

	it.each(FILES)("parses a document without frontmatter from the untouched text in %s", (file) => {
		const text = "# Title\n\n---\n\nText\n\n```ts\nconst a = 1\n```\n"
		const { mdast, frontmatter } = parseDocument(file, text)
		expect(frontmatter).toBeUndefined()
		expect(mdast.children.map((n) => n.type)).toEqual(["heading", "thematicBreak", "paragraph", "code"])
	})

	it.each(FILES)("treats an unclosed block as today in %s", (file) => {
		const text = "---\nname: x\n\ntext\n"
		const { mdast, frontmatter } = parseDocument(file, text)
		expect(frontmatter).toBeUndefined()
		expect(mdast.children.map((n) => n.type)).toEqual(["thematicBreak", "paragraph", "paragraph"])
	})

	it("keeps the frontmatter when an MDX parse fails", () => {
		const { frontmatter, parseError } = parseDocument("doc.mdx", "---\nname: x\n---\n<Unclosed>\n")
		expect(parseError).toBeDefined()
		expect(frontmatter?.raw).toBe("name: x")
	})

	it.each(FILES)("keeps node offsets in line with the text in %s", (file) => {
		const text = "---\ntitle: x\n---\n\nSome *text* here\n"
		const [paragraph] = parseDocument(file, text).mdast.children
		const { start, end } = paragraph?.position ?? {}
		expect(text.slice(start?.offset, end?.offset)).toBe("Some *text* here")
		expect(start).toMatchObject({ line: 5, column: 1 })
	})

	it.each(FILES)("keeps fence positions in %s", (file) => {
		const config = resolveConfig({})
		const content = "---\na: 1\nb: 2\n---\n\n```ts\nconst a = 1\n```\n"
		const [snippet] = extractSnippetsFromContent({ markdownFile: file, content, config }).snippets
		expect(snippet?.markdownRange.start).toEqual({ line: 5, character: 0 })
		expect(snippet?.codeStart).toEqual({ line: 6, character: 0 })
	})
})

describe("rules and diagnostics", () => {
	function probe() {
		const seen: RuleDocumentContext[] = []
		const plugin = definePlugin({
			name: "t",
			rules: {
				r: defineRule({
					meta: { scope: "document", defaultSeverity: "warn" },
					create(ctx) {
						seen.push(ctx)
					},
				}),
			},
		})
		return { seen, plugin }
	}

	it.each(FILES)("reports TypeScript errors on their original line in %s", async (file) => {
		const text = ["---", "a: 1", "b: 2", "---", "", "```ts", 'const n: number = "x"', "```", ""].join("\n")
		const result = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: file,
			text,
			config: { engine: "classic" },
		})
		const error = result.diagnostics.find((d) => d.code === 2322)
		expect(error?.markdownRange.start.line).toBe(6)
	})

	it.each(FILES)("gives rules the frontmatter and the full text in %s", async (file) => {
		const { seen, plugin } = probe()
		const text = "---\r\nname: x\r\n---\r\n# Title\r\n"
		await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: file,
			text,
			config: { plugins: [plugin], engine: "classic", rules: { "t/r": "warn" } },
		})
		const [ctx] = seen
		expect(ctx?.text).toBe(text)
		expect(ctx?.frontmatter).toEqual({
			raw: "name: x",
			range: { start: { line: 0, character: 0 }, end: { line: 2, character: 3 } },
			bodyStart: { line: 3, character: 0 },
		})
		expect(ctx?.mdast.children.map((n) => n.type)).toEqual(["heading"])
	})

	it("leaves frontmatter undefined without a block", async () => {
		const { seen, plugin } = probe()
		await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: "# Title\n\n---\n\ntext\n",
			config: { plugins: [plugin], engine: "classic", rules: { "t/r": "warn" } },
		})
		expect(seen[0]?.frontmatter).toBeUndefined()
		expect(seen[0]?.mdast.children.map((n) => n.type)).toEqual(["heading", "thematicBreak", "paragraph"])
	})

	it.each(FENCE_TAGS.flatMap(([tag]) => FILES.map((file) => [tag, file] as const)))(
		"keeps the line of a ```%s fence in %s",
		(tag, file) => {
			const content = `---\nname: x\n---\n\n\`\`\`${tag}\nconst a = 1\n\`\`\`\n`
			const snippets = extractSnippetsFromContent({
				markdownFile: file,
				content,
				config: resolveConfig({}),
			}).snippets
			expect(snippets).toHaveLength(1)
			expect(snippets[0]?.markdownRange.start.line).toBe(4)
		}
	)
})
