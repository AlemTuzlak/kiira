import { checkMarkdownText } from "../check"
import { resolveConfig, rulesForFile } from "../config"
import type { KiiraConfig, KiiraDiagnostic, KiiraPreset } from "../types"
import { FENCE_TAGS, docWithFence, tempProject } from "./test-helpers"

async function check(cwd: string, markdownFile: string, text: string, config: KiiraConfig): Promise<KiiraDiagnostic[]> {
	const { diagnostics } = await checkMarkdownText({ cwd, markdownFile, text, config: { engine: "classic", ...config } })
	return diagnostics.filter((d) => typeof d.code === "string")
}

function messages(diagnostics: KiiraDiagnostic[]): string[] {
	return diagnostics.map((d) => d.message)
}

describe("broken-link", () => {
	const rules: KiiraConfig["rules"] = { "broken-link": "error" }
	const project = () =>
		tempProject({
			"README.md": "# Readme\n",
			"docs/other.md": "# Intro\n\n## Setup\n\n## Setup\n\n## Héllo, wörld!\n\n## `code` _kept_\n",
			"docs/page.mdx": "# Page\n\n## Deep dive\n",
			"docs/pic.png": "",
		})

	it("reports a missing file and accepts an existing one", async () => {
		const text = "[gone](./gone.md) and [here](./other.md)\n"
		const diagnostics = await check(project(), "docs/guide.md", text, { rules })
		expect(diagnostics).toMatchObject([
			{
				code: "broken-link",
				severity: "error",
				message: "Link target not found: ./gone.md",
				markdownRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } },
			},
		])
	})

	it("resolves a plain document's links relative to its directory, and a leading slash from cwd", async () => {
		const text = "[up](../README.md) [root](/README.md) [bad](README.md)\n"
		const diagnostics = await check(project(), "docs/guide.md", text, { rules })
		expect(messages(diagnostics)).toEqual(["Link target not found: README.md"])
	})

	it("ignores URLs with a scheme, protocol-relative URLs, and anchors while anchors are off", async () => {
		const text = [
			"[a](https://example.com/x) [b](mailto:me@example.com) [c](//cdn.example.com/x)",
			"[d](#nowhere) [e](other.md#nowhere) [f](tel:123)",
			"",
		].join("\n")
		expect(await check(project(), "docs/guide.md", text, { rules })).toEqual([])
	})

	it("strips the query and hash before checking the file", async () => {
		const text = "[a](other.md?plain=1) [b](other.md#whatever) [c](gone.md?x=1#y) [d](my%20file.md)\n"
		const diagnostics = await check(project(), "docs/guide.md", text, { rules })
		expect(messages(diagnostics)).toEqual([
			"Link target not found: gone.md?x=1#y",
			"Link target not found: my%20file.md",
		])
	})

	it("checks images and definitions", async () => {
		const text = ["![ok](pic.png) ![bad](missing.png)", "", "[ref]: ./missing.md", "[ok]: ./other.md", ""].join("\n")
		const diagnostics = await check(project(), "docs/guide.md", text, { rules })
		expect(diagnostics.map((d) => [d.message, d.markdownRange.start.line])).toEqual([
			["Link target not found: missing.png", 0],
			["Link target not found: ./missing.md", 2],
		])
	})

	it("checks links in an MDX document", async () => {
		const text = ["import X from './x'", "", "# Title", "", "[gone](./gone.md) [here](./other.md)", ""].join("\n")
		const diagnostics = await check(project(), "docs/guide.mdx", text, { rules })
		expect(diagnostics).toMatchObject([
			{ message: "Link target not found: ./gone.md", markdownRange: { start: { line: 4, character: 0 } } },
		])
	})

	describe("with anchors", () => {
		const anchors: KiiraConfig["rules"] = { "broken-link": ["error", { anchors: true }] }

		it("accepts existing headings, including duplicates, Unicode, and inline code", async () => {
			const text = [
				"[a](other.md#intro) [b](other.md#setup) [c](other.md#setup-1) [d](other.md#h%C3%A9llo-w%C3%B6rld)",
				"[e](other.md#code-kept) [f](page.mdx#deep-dive) [g](other.md#Setup)",
				"",
			].join("\n")
			expect(await check(project(), "docs/guide.md", text, { rules: anchors })).toEqual([])
		})

		it("reports a missing heading and a missing duplicate suffix", async () => {
			const text = "[a](other.md#missing) [b](other.md#setup-2) [c](page.mdx#nope) [d](gone.md#intro)\n"
			const diagnostics = await check(project(), "docs/guide.md", text, { rules: anchors })
			expect(messages(diagnostics)).toEqual([
				"Link anchor not found: other.md#missing",
				"Link anchor not found: other.md#setup-2",
				"Link anchor not found: page.mdx#nope",
				"Link target not found: gone.md#intro",
			])
		})

		it("checks a same-file #heading against the document itself", async () => {
			const text = ["# Top", "", "## Same", "", "## Same", "", "[a](#top) [b](#same-1) [c](#nope)", ""].join("\n")
			const diagnostics = await check(project(), "docs/guide.md", text, { rules: anchors })
			expect(messages(diagnostics)).toEqual(["Link anchor not found: #nope"])
		})

		it("does not check anchors into files that are not Markdown", async () => {
			expect(await check(project(), "docs/guide.md", "[a](pic.png#frag)\n", { rules: anchors })).toEqual([])
		})
	})

	it("rejects an `anchors` option that is not a boolean", () => {
		expect(() => resolveConfig({ rules: { "broken-link": ["error", { anchors: "yes" }] } })).toThrow(
			/Invalid options for rule "broken-link" in `rules`: `anchors` must be a boolean/
		)
	})
})

describe("max-lines", () => {
	const at = (max: number): KiiraConfig => ({ rules: { "max-lines": ["error", { max }] } })
	const lines = (n: number, eol = "\n") => `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join(eol)}`

	it("stays quiet at or under the limit", async () => {
		expect(await check(tempProject(), "a.md", lines(3), at(3))).toEqual([])
		expect(await check(tempProject(), "a.md", lines(2), at(3))).toEqual([])
	})

	it("reports once, on the first line past the limit", async () => {
		const diagnostics = await check(tempProject(), "a.md", lines(5), at(3))
		expect(diagnostics).toMatchObject([
			{
				code: "max-lines",
				severity: "error",
				message: "File has 5 lines (max 3).",
				markdownRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 6 } },
			},
		])
	})

	it("counts a trailing newline as an extra line", async () => {
		expect(await check(tempProject(), "a.md", `${lines(3)}\n`, at(3))).toMatchObject([
			{
				message: "File has 4 lines (max 3).",
				markdownRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } },
			},
		])
	})

	it("counts CRLF line endings as one line each", async () => {
		expect(await check(tempProject(), "a.md", lines(3, "\r\n"), at(3))).toEqual([])
		expect(messages(await check(tempProject(), "a.md", lines(4, "\r\n"), at(3)))).toEqual(["File has 4 lines (max 3)."])
	})

	it("fails config resolution without `max`", () => {
		expect(() => resolveConfig({ rules: { "max-lines": "error" } })).toThrow(
			/Invalid options for rule "max-lines" in `rules`: `max` is required/
		)
		expect(() => resolveConfig({ rules: { "max-lines": ["warn", {}] } })).toThrow(/`max` must be a positive integer/)
		expect(() => resolveConfig({ overrides: [{ include: ["a.md"], rules: { "max-lines": "warn" } }] })).toThrow(
			/`max` is required/
		)
		expect(() => rulesForFile(resolveConfig({}, { "max-lines": "error" }), "a.md")).toThrow(/`max` is required/)
	})

	it.each([0, -1, 1.5, "3", null])("fails config resolution for max %j", (max) => {
		expect(() => resolveConfig({ rules: { "max-lines": ["error", { max }] } })).toThrow(
			/`max` must be a positive integer/
		)
	})

	it("accepts a bare level when options come from elsewhere, and while off", () => {
		const preset: KiiraPreset = { name: "p", rules: { "max-lines": ["warn", { max: 10 }] } }
		const resolved = resolveConfig({ presets: [preset], rules: { "max-lines": "error" } })
		expect(resolved.ruleSettings["max-lines"]).toEqual({ severity: "error", options: { max: 10 } })
		expect(() => resolveConfig({ rules: { "max-lines": "off" } })).not.toThrow()
		expect(() => resolveConfig({})).not.toThrow()
	})
})

describe("deprecated-import", () => {
	const library = () =>
		tempProject({
			"pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
			"packages/old/package.json": JSON.stringify({
				name: "@demo/old",
				exports: { ".": { types: "./dist/index.d.ts" }, "./sub": { types: "./dist/sub.d.ts" } },
			}),
			"packages/old/src/index.ts": [
				"/** @deprecated use newThing instead */",
				"export function oldThing(): void {}",
				"export function fine(): void {}",
				"/** @deprecated */",
				"export default function legacy(): void {}",
				"export { oldThing as renamed }",
				'export { impl as reexported } from "./impl"',
				"",
			].join("\n"),
			"packages/old/src/impl.ts": "/** @deprecated moved to impl2 */\nexport const impl = 1\n",
			"packages/old/src/sub.ts": "/** @deprecated gone from sub */\nexport const subThing = 1\n",
			"packages/other/package.json": JSON.stringify({
				name: "@demo/other",
				exports: { ".": { types: "./dist/index.d.ts" } },
			}),
			"packages/other/src/index.ts": "/** @deprecated other */\nexport const otherThing = 1\n",
		})
	const rules: KiiraConfig["rules"] = { "deprecated-import": "warn" }
	const run = (code: string, config: KiiraConfig = { rules }, file = "doc.md", tag = "ts") =>
		check(library(), file, docWithFence(tag, code), config)

	it("reports named imports with the tag text, anchored to the binding in the Markdown", async () => {
		const diagnostics = await run('import { oldThing, fine } from "@demo/old"\noldThing(); fine()')
		expect(diagnostics).toMatchObject([
			{
				code: "deprecated-import",
				severity: "warning",
				message: "'oldThing' is deprecated: use newThing instead",
				markdownRange: { start: { line: 3, character: 9 }, end: { line: 3, character: 17 } },
			},
		])
	})

	it("reports a default import and uses the local name", async () => {
		const diagnostics = await run('import legacy, { fine as ok } from "@demo/old"\nlegacy(); ok()')
		expect(messages(diagnostics)).toEqual(["'legacy' is deprecated"])
		expect(messages(await run('import renamedDefault from "@demo/old"\nrenamedDefault()'))).toEqual([
			"'renamedDefault' is deprecated",
		])
	})

	it("follows an alias and a re-export to the deprecated declaration", async () => {
		const diagnostics = await run('import { renamed, reexported as again } from "@demo/old"\nrenamed(); again')
		expect(messages(diagnostics)).toEqual([
			"'renamed' is deprecated: use newThing instead",
			"'again' is deprecated: moved to impl2",
		])
	})

	it("does not report imports that are not deprecated", async () => {
		expect(await run('import { fine } from "@demo/old"\nfine()')).toEqual([])
	})

	it("reports as an error at `error` and is quiet while off", async () => {
		const code = 'import { oldThing } from "@demo/old"\noldThing()'
		expect((await run(code, { rules: { "deprecated-import": "error" } }))[0]?.severity).toBe("error")
		expect(await run(code, {})).toEqual([])
	})

	it("limits checking to `packages`, including their subpaths", async () => {
		const code = [
			'import { oldThing } from "@demo/old"',
			'import { subThing } from "@demo/old/sub"',
			'import { otherThing } from "@demo/other"',
			"oldThing(); subThing; otherThing",
		].join("\n")
		const only = (packages: string[]): KiiraConfig => ({
			rules: { "deprecated-import": ["warn", { packages }] },
		})
		expect(messages(await run(code, only(["@demo/old"])))).toEqual([
			"'oldThing' is deprecated: use newThing instead",
			"'subThing' is deprecated: gone from sub",
		])
		expect(messages(await run(code, only(["@demo/old/sub"])))).toEqual(["'subThing' is deprecated: gone from sub"])
		expect(await run(code, only(["@demo/ol"]))).toEqual([])
		expect(messages(await run(code, { rules }))).toHaveLength(3)
	})

	it("rejects invalid options", () => {
		expect(() => resolveConfig({ rules: { "deprecated-import": ["warn", { packages: "x" }] } })).toThrow(
			/`packages` must be an array of strings/
		)
	})

	it("checks fences in an MDX document", async () => {
		const diagnostics = await run('import { oldThing } from "@demo/old"\noldThing()', { rules }, "doc.mdx")
		expect(messages(diagnostics)).toEqual(["'oldThing' is deprecated: use newThing instead"])
	})

	it("skips imports that come from generated fixture code", async () => {
		const diagnostics = await run("const x = 1", {
			rules,
			defaultFixture: "setup",
			fixtures: { setup: { type: "prepend", content: 'import { oldThing } from "@demo/old"\noldThing()' } },
		})
		expect(diagnostics).toEqual([])
	})

	it.each(FENCE_TAGS)("reports in a %s fence", async (tag) => {
		const diagnostics = await run('import { oldThing } from "@demo/old"\noldThing()', { rules }, "doc.md", tag)
		expect(messages(diagnostics)).toEqual(["'oldThing' is deprecated: use newThing instead"])
	})
})

describe("recommended preset", () => {
	const levelsOf = (config: KiiraConfig) =>
		Object.fromEntries(Object.entries(resolveConfig(config).ruleSettings).map(([id, s]) => [id, s.severity]))

	it("leaves all three optional rules off by default", () => {
		const levels = levelsOf({})
		expect([levels["broken-link"], levels["max-lines"], levels["deprecated-import"]]).toEqual(["off", "off", "off"])
	})

	it("turns on exactly broken-link and deprecated-import", () => {
		const base = levelsOf({})
		const levels = levelsOf({ presets: ["recommended"] })
		const changed = Object.keys(levels).filter((id) => levels[id] !== base[id])
		expect(changed.sort()).toEqual(["broken-link", "deprecated-import"])
		expect(levels["broken-link"]).toBe("error")
		expect(levels["deprecated-import"]).toBe("warn")
	})

	it("lets `rules` override it", () => {
		expect(levelsOf({ presets: ["recommended"], rules: { "broken-link": "off" } })["broken-link"]).toBe("off")
	})
})
