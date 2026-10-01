import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runCheck } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(here, "../../tests/fixtures/plugin-js")

async function run(extra: { rules?: Record<string, "off" | "warn" | "error">; reporter?: "pretty" | "github" } = {}) {
	const logs: string[] = []
	const errors: string[] = []
	const code = await runCheck({
		cwd: fixture,
		files: [],
		reporter: "json",
		static: true,
		raw: true,
		log: (m) => logs.push(m),
		error: (m) => errors.push(m),
		...extra,
	})
	const output = logs.join("\n")
	return { code, errors, output, report: (extra.reporter ?? "json") === "json" ? JSON.parse(output) : undefined }
}

describe("a plugin written in plain JavaScript", () => {
	it("runs from a .mjs config that imports kiira-core/plugin, with its rule's options", async () => {
		const { code, errors, report } = await run()
		expect(errors).toEqual([])
		expect(code).toBe(1)
		expect(report.stats).toMatchObject({ errors: 1, warnings: 0, snippets: 1 })
		expect(report.diagnostics).toEqual([
			{
				severity: "error",
				source: "kiira",
				code: "docs/no-word",
				message: 'Remove "TODO" before publishing.',
				markdownFile: "doc.md",
				markdownRange: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
				generated: false,
			},
		])
	})

	it("shows the rule id as the code in the pretty and GitHub reporters", async () => {
		expect((await run({ reporter: "pretty" })).output).toContain("doc.md:3:1 error docs/no-word Remove")
		expect((await run({ reporter: "github" })).output).toContain("file=doc.md,line=3,col=1,title=docs/no-word::")
	})

	it("honors --rule over the config", async () => {
		const warn = await run({ rules: { "docs/no-word": "warn" } })
		expect(warn.code).toBe(0)
		expect(warn.report.diagnostics[0]).toMatchObject({ severity: "warning", code: "docs/no-word" })
		const off = await run({ rules: { "docs/no-word": "off" } })
		expect(off.code).toBe(0)
		expect(off.report.diagnostics).toEqual([])
	})

	it("rejects an unknown rule id", async () => {
		await expect(run({ rules: { "docs/nope": "off" } })).rejects.toThrow(/Unknown rule "docs\/nope" in --rule/)
	})
})

describe("the kiira-core/plugin entry", () => {
	// A plugin author's import must pull in nothing else: no chunks, no packages.
	const cjs = createRequire(import.meta.url).resolve("kiira-core/plugin")
	const esm = join(dirname(cjs), "plugin.mjs")

	it.each([
		["plugin.mjs", esm],
		["plugin.cjs", cjs],
	])("%s has no import or require of another module", (_name, path) => {
		const source = readFileSync(path, "utf8")
		expect(source).not.toMatch(/^\s*import\s/m)
		expect(source).not.toMatch(/\bimport\s*\(/)
		expect(source).not.toMatch(/\brequire\s*\(/)
		expect(source).not.toMatch(/^\s*export\s.+\sfrom\s/m)
	})
})
