import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles, checkMarkdownText, collectSuggestions } from "../check"
import { resolveConfig } from "../config"
import { extractSnippetsFromContent } from "../extract"
import type { KiiraConfig } from "../types"
import { FENCE_TAGS, docWithFence, tempProject } from "./test-helpers"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../../tests/fixtures")

const JSX_CODE = "export const C = () => <div>{1}</div>"

function codes(diagnostics: Array<{ code?: string | number }>): Array<string | number | undefined> {
	return diagnostics.map((d) => d.code)
}

describe("parse-error", () => {
	const broken = ["<Callout>", "", "Some text with no closing tag."].join("\n")

	it("reports an MDX parse failure with the rule id as its code", async () => {
		const { diagnostics, snippets } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "broken.mdx",
			text: broken,
			config: {},
		})
		expect(snippets).toEqual([])
		expect(diagnostics).toHaveLength(1)
		expect(diagnostics[0]).toMatchObject({ severity: "error", source: "kiira", code: "parse-error" })
		expect(diagnostics[0]?.message).toMatch(/^Failed to parse MDX: /)
	})

	it("follows the configured level", async () => {
		const run = (rule: "off" | "warn") =>
			checkMarkdownText({
				cwd: tempProject(),
				markdownFile: "broken.mdx",
				text: broken,
				config: { rules: { "parse-error": rule } },
			})
		expect((await run("off")).diagnostics).toEqual([])
		expect((await run("warn")).diagnostics[0]?.severity).toBe("warning")
	})

	it("is returned by the extractSnippetsFromContent wrapper", () => {
		const { diagnostics } = extractSnippetsFromContent({
			markdownFile: "broken.mdx",
			content: broken,
			config: resolveConfig({}),
		})
		expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([["parse-error", "error"]])
		const off = extractSnippetsFromContent({
			markdownFile: "broken.mdx",
			content: broken,
			config: resolveConfig({ rules: { "parse-error": "off" } }),
		})
		expect(off.diagnostics).toEqual([])
	})
})

describe("fence-meta", () => {
	it.each(FENCE_TAGS)("warns on an invalid validate value in a %s fence, anchored to the fence", async (tag) => {
		const text = ["# Title", "", `\`\`\`${tag} validate=sometimes`, "const a = 1", "```", ""].join("\n")
		const { diagnostics } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text,
			config: {},
		})
		expect(diagnostics).toHaveLength(1)
		expect(diagnostics[0]).toMatchObject({
			severity: "warning",
			source: "kiira",
			code: "fence-meta",
			message: 'Invalid `validate` value "sometimes". Expected "type", "runtime", or "none".',
			markdownRange: { start: { line: 2, character: 0 }, end: { line: 4, character: 3 } },
		})
	})

	it("reports one warning per invalid value and is returned by the extraction wrapper", () => {
		const content = ["```ts validate=a package=b", "const a = 1", "```"].join("\n")
		const { diagnostics } = extractSnippetsFromContent({
			markdownFile: "doc.md",
			content,
			config: resolveConfig({}),
		})
		expect(codes(diagnostics)).toEqual(["fence-meta", "fence-meta"])
	})

	it("can be turned off", async () => {
		const { diagnostics } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: ["```ts validate=a", "const a = 1", "```"].join("\n"),
			config: { rules: { "fence-meta": "off" } },
		})
		expect(diagnostics).toEqual([])
	})
})

describe("language-tag", () => {
	it.each(FENCE_TAGS)("handles a %s fence that contains JSX", async (tag, lang) => {
		const { diagnostics, virtualFiles } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: docWithFence(tag, JSX_CODE),
			config: {},
		})
		const warning = diagnostics.find((d) => d.code === "language-tag")
		if (lang === "ts") {
			expect(warning).toMatchObject({
				severity: "warning",
				source: "kiira",
				message:
					"This `ts` code fence contains JSX. Change the language tag to `tsx` (run `kiira check --fix` to apply).",
				markdownRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
				fix: { kind: "fence-language", line: 2, language: "tsx" },
			})
			// Checked as tsx whether or not the rule reports it.
			expect(virtualFiles[0]?.lang).toBe("tsx")
		} else {
			expect(warning).toBeUndefined()
			expect(virtualFiles[0]?.lang).toBe(lang)
		}
	})

	it("does not change how the fence is checked when turned off", async () => {
		const { diagnostics, virtualFiles } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: docWithFence("ts", JSX_CODE),
			config: { rules: { "language-tag": "off" } },
		})
		expect(diagnostics.some((d) => d.code === "language-tag")).toBe(false)
		expect(virtualFiles[0]?.lang).toBe("tsx")
	})

	it("skips fences that are not checked", async () => {
		const { diagnostics } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: docWithFence("ts ignore", JSX_CODE),
			config: {},
		})
		expect(diagnostics).toEqual([])
	})
})

describe("diagnostic order", () => {
	it("keeps extraction rules ahead of type-check diagnostics, and the language-tag rule after them", async () => {
		const text = ["```ts validate=bogus", 'const n: number = "x"', "```", "", "```ts", JSX_CODE, "```", ""].join("\n")
		const { diagnostics } = await checkMarkdownText({ cwd: tempProject(), markdownFile: "doc.md", text, config: {} })
		const order = codes(diagnostics)
		expect(order[0]).toBe("fence-meta")
		expect(order.indexOf(2322)).toBeGreaterThan(0)
		expect(order.indexOf("language-tag")).toBeGreaterThan(order.indexOf(2322))
	})
})

describe("unused-symbols and relative-imports", () => {
	const run = (fixture: string, config: KiiraConfig) =>
		checkMarkdownFiles({
			cwd: resolve(fixtures, fixture),
			files: ["doc.md"],
			config: { include: ["**/*.md"], ...config },
		})

	it("downgrades unused-symbol diagnostics to warnings at warn, and keeps them as TypeScript diagnostics", async () => {
		const result = await run("unused", { rules: { "unused-symbols": "warn" } })
		const unused = result.diagnostics.find((d) => d.code === 6133)
		expect(unused).toMatchObject({ severity: "warning", source: "typescript" })
		expect(result.stats.errors).toBe(0)
		expect(result.stats.warnings).toBeGreaterThan(0)
	})

	it("keeps unused-symbol diagnostics as errors at error, and reports none while off", async () => {
		const on = await run("unused", { rules: { "unused-symbols": "error" } })
		expect(on.diagnostics.find((d) => d.code === 6133)?.severity).toBe("error")
		const off = await run("unused", {})
		expect(off.diagnostics.some((d) => d.code === 6133)).toBe(false)
	})

	it("applies unused-symbols per file through overrides", async () => {
		const result = await run("unused", {
			overrides: [{ include: ["**/doc.md"], rules: { "unused-symbols": "warn" } }],
		})
		expect(result.diagnostics.find((d) => d.code === 6133)?.severity).toBe("warning")
	})

	it("downgrades unresolved relative imports to warnings at warn", async () => {
		const warn = await run("relative-imports", { rules: { "relative-imports": "warn" } })
		const diagnostic = warn.diagnostics.find((d) => d.code === 2307 && d.message.includes("./tool-definitions"))
		expect(diagnostic).toMatchObject({ severity: "warning", source: "typescript" })
		const error = await run("relative-imports", { rules: { "relative-imports": "error" } })
		expect(error.diagnostics.find((d) => d.code === 2307 && d.message.includes("./tool-definitions"))?.severity).toBe(
			"error"
		)
	})

	it("keeps the legacy config keys working as aliases", async () => {
		const result = await run("relative-imports", { checkRelativeImports: true })
		expect(result.diagnostics.some((d) => d.code === 2307 && d.message.includes("./tool-definitions"))).toBe(true)
	})
})

describe("compatibility wrappers", () => {
	it("collectSuggestions returns the group and jsx-framework diagnostics of a checked run", async () => {
		const cwd = resolve(fixtures, "group")
		const config: KiiraConfig = { include: ["**/*.md"] }
		const result = await checkMarkdownFiles({ cwd, files: ["ungrouped.md"], config })
		const suggestions = await collectSuggestions({
			cwd,
			files: ["ungrouped.md"],
			snippets: result.snippets,
			diagnostics: result.diagnostics,
			config,
		})
		expect(suggestions.length).toBeGreaterThan(0)
		expect(suggestions).toEqual(result.diagnostics.filter((d) => d.code === "group"))

		const off = await collectSuggestions({
			cwd,
			files: ["ungrouped.md"],
			snippets: result.snippets,
			diagnostics: result.diagnostics,
			config: { ...config, rules: { group: "off", "jsx-framework": "off" } },
		})
		expect(off).toEqual([])
	})

	it("collectSuggestions returns the jsx-framework suggestion", async () => {
		const cwd = resolve(fixtures, "jsxframework")
		const config: KiiraConfig = { include: ["**/*.md"] }
		const result = await checkMarkdownFiles({ cwd, files: ["ai-solid.md"], config })
		const suggestions = await collectSuggestions({
			cwd,
			files: ["ai-solid.md"],
			snippets: result.snippets,
			diagnostics: result.diagnostics,
			config,
		})
		expect(codes(suggestions)).toEqual(["jsx-framework"])
	})
})
