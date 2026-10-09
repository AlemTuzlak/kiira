import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { externalCacheDir } from "kiira-core"
import { runCheck } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../../tests/fixtures/project")

function capture() {
	const logs: string[] = []
	const errors: string[] = []
	return {
		logs,
		errors,
		log: (m: string) => logs.push(m),
		error: (m: string) => errors.push(m),
	}
}

describe("runCheck", () => {
	it("exits 1 and reports diagnostics for a file with type errors", async () => {
		const io = capture()
		const code = await runCheck({
			cwd: fixtures,
			files: ["bad.md"],
			reporter: "json",
			...io,
		})
		expect(code).toBe(1)
		const report = JSON.parse(io.logs.join("\n"))
		expect(report.stats.errors).toBe(1)
		expect(report.diagnostics[0].code).toBe(2322)
		expect(report.diagnostics[0].markdownFile).toBe("bad.md")
	})

	it("exits 0 for files that type-check cleanly", async () => {
		const io = capture()
		const code = await runCheck({
			cwd: fixtures,
			files: ["good.md"],
			reporter: "json",
			...io,
		})
		expect(code).toBe(0)
		const report = JSON.parse(io.logs.join("\n"))
		expect(report.stats.errors).toBe(0)
		// The ignored fence is counted but not checked.
		expect(report.stats.ignored).toBe(1)
	})

	it("emits GitHub annotations with the github reporter", async () => {
		const io = capture()
		await runCheck({ cwd: fixtures, files: ["bad.md"], reporter: "github", ...io })
		expect(io.logs.join("\n")).toContain("::error file=bad.md,")
	})

	it("rewrites a mistagged ts fence to tsx with --fix", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-fix-"))
		try {
			const md = ["# Comp", "", "```ts", "export const C = () => <div>{1}</div>", "```", ""].join("\n")
			writeFileSync(join(dir, "comp.md"), md)
			const io = capture()
			await runCheck({ cwd: dir, files: ["comp.md"], reporter: "json", fix: true, ...io })

			expect(readFileSync(join(dir, "comp.md"), "utf8").split("\n")[2]).toBe("```tsx")
			expect(io.logs.join("\n")).toContain("Fixed 1 fence")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("prints an info line and exits 0 when allowEmpty is set and nothing matched", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-empty-"))
		try {
			writeFileSync(
				join(dir, "kiira.config.json"),
				JSON.stringify({ include: ["nothing/**/*.md"], presets: [{ name: "p", allowEmpty: true }] })
			)
			const pretty = capture()
			expect(await runCheck({ cwd: dir, files: [], reporter: "pretty", raw: true, ...pretty })).toBe(0)
			expect(pretty.logs).toEqual(["No files matched; nothing to check."])

			const json = capture()
			await runCheck({ cwd: dir, files: [], reporter: "json", ...json })
			expect(JSON.parse(json.logs.join("\n")).stats.markdownFiles).toBe(0)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("keeps the normal empty report when nothing matched and allowEmpty is not set", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-empty-"))
		try {
			writeFileSync(join(dir, "kiira.config.json"), JSON.stringify({ include: ["nothing/**/*.md"] }))
			const io = capture()
			expect(await runCheck({ cwd: dir, files: [], reporter: "pretty", raw: true, ...io })).toBe(0)
			expect(io.logs.join("\n")).toContain("Kiira found no errors in 0 files.")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("replaces config and preset includes with entries, and applies --rule levels", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-entry-"))
		try {
			writeFileSync(
				join(dir, "kiira.config.json"),
				JSON.stringify({ presets: [{ name: "p", include: ["other/**/*.md"] }] })
			)
			mkdirSync(join(dir, "docs"))
			mkdirSync(join(dir, "other"))
			const md = ["# Comp", "", "```ts", "export const C = () => <div>{1}</div>", "```", ""].join("\n")
			writeFileSync(join(dir, "docs", "a.md"), md)
			writeFileSync(join(dir, "other", "b.md"), md)

			const io = capture()
			await runCheck({ cwd: dir, files: ["docs"], reporter: "json", rules: { "language-tag": "error" }, ...io })
			const report = JSON.parse(io.logs.join("\n"))
			expect(report.stats.markdownFiles).toBe(1)
			const files = new Set(report.diagnostics.map((d: { markdownFile: string }) => d.markdownFile))
			expect([...files]).toEqual(["docs/a.md"])
			const tag = report.diagnostics.find((d: { code: string }) => d.code === "language-tag")
			expect(tag).toMatchObject({ severity: "error" })
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("resolves imports of declared externalPackages from the isolated cache", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-ext-cli-"))
		try {
			// Pre-populate the isolated cache with a fake typed package so the
			// idempotent install is a no-op (deps unchanged + node_modules exists)
			// and no real package manager is spawned.
			const cache = externalCacheDir(dir)
			const pkgDir = join(cache, "node_modules", "faux-lib")
			mkdirSync(pkgDir, { recursive: true })
			writeFileSync(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "faux-lib", version: "1.0.0", types: "index.d.ts" })
			)
			writeFileSync(join(pkgDir, "index.d.ts"), "export const hello: (name: string) => string\n")
			writeFileSync(
				join(cache, "package.json"),
				JSON.stringify({ name: ".kiira", private: true, version: "0.0.0", dependencies: { "faux-lib": "^1" } })
			)

			writeFileSync(
				join(dir, "kiira.config.json"),
				JSON.stringify({ include: ["**/*.md"], externalPackages: { "faux-lib": "^1" } })
			)
			writeFileSync(join(dir, "doc.md"), '```ts\nimport { hello } from "faux-lib"\nhello("world")\n```\n')

			const io = capture()
			const code = await runCheck({ cwd: dir, files: [], reporter: "json", ...io })

			expect(io.errors).toEqual([])
			expect(code).toBe(0)
			const report = JSON.parse(io.logs.join("\n"))
			expect(report.stats.errors).toBe(0)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("runCheck --fix with rule edits", () => {
	// A plain-object plugin, so the temp project needs no imports. The rule rewrites `OLD` to `NEW` inside fences.
	const config = `export default {
	include: ["**/*.md"],
	plugins: [
		{
			name: "docs",
			rules: {
				rewrite: {
					meta: { scope: "document", defaultSeverity: "warn" },
					create(ctx) {
						for (const snippet of ctx.snippets) {
							snippet.code.split("\\n").forEach((text, index) => {
								const character = text.indexOf("OLD")
								if (character === -1) return
								const line = snippet.codeStart.line + index
								ctx.report({
									range: { start: { line, character }, end: { line, character: character + 3 } },
									message: "Use NEW.",
									fix: {
										kind: "edits",
										edits: [{ file: ctx.file, range: { start: { line, character }, end: { line, character: character + 3 } }, newText: "NEW" }],
									},
								})
							})
						}
					},
				},
			},
		},
	],
	rules: { "docs/rewrite": "warn" },
}
`

	function project(markdown: string): string {
		const dir = mkdtempSync(join(tmpdir(), "kiira-edits-"))
		writeFileSync(join(dir, "kiira.config.mjs"), config)
		writeFileSync(join(dir, "doc.md"), markdown)
		return dir
	}

	it.each(["ts", "tsx", "js", "jsx", "typescript", "typescriptreact", "javascript", "mjs", "cjs", "javascriptreact"])(
		"applies an edits fix inside a %s fence",
		async (lang) => {
			const dir = project(`# Doc\n\n\`\`\`${lang}\nconst value = "OLD"\n\`\`\`\n`)
			try {
				const io = capture()
				await runCheck({ cwd: dir, files: [], reporter: "json", fix: true, ...io })

				expect(io.errors).toEqual([])
				expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe(`# Doc\n\n\`\`\`${lang}\nconst value = "NEW"\n\`\`\`\n`)
				expect(io.logs.join("\n")).toContain("Fixed 1 edit.")
			} finally {
				rmSync(dir, { recursive: true, force: true })
			}
		}
	)

	it("prints a unified diff and writes nothing with --dry-run, exiting as the original check did", async () => {
		const markdown = '# Doc\n\n```ts\nconst value = "OLD"\n```\n'
		const dir = project(markdown)
		try {
			const io = capture()
			const code = await runCheck({
				cwd: dir,
				files: [],
				reporter: "pretty",
				raw: true,
				static: true,
				fix: true,
				dryRun: true,
				...io,
			})

			expect(code).toBe(0)
			expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe(markdown)
			expect(io.logs[0]).toBe(
				[
					"--- a/doc.md",
					"+++ b/doc.md",
					"@@ -1,5 +1,5 @@",
					" # Doc",
					" ",
					" ```ts",
					'-const value = "OLD"',
					'+const value = "NEW"',
					" ```",
				].join("\n")
			)
			expect(io.logs[1]).toBe("Dry run: would change 1 file (1 edit) and add 0 config overrides. Nothing was written.")
			expect(io.errors).toEqual([])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("keeps stdout valid JSON with --dry-run and --reporter json, sending the diff to stderr", async () => {
		const dir = project('```ts\nconst value = "OLD"\n```\n')
		try {
			const io = capture()
			await runCheck({ cwd: dir, files: [], reporter: "json", fix: true, dryRun: true, ...io })

			expect(JSON.parse(io.logs.join("\n")).stats.markdownFiles).toBe(1)
			expect(io.errors[0]).toContain("--- a/doc.md\n+++ b/doc.md\n")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("keeps the original exit code in a dry run when errors would be fixed away", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-dry-"))
		try {
			writeFileSync(join(dir, "kiira.config.json"), JSON.stringify({ rules: { "language-tag": "error" } }))
			const markdown = "```ts\nexport const C = () => <div>{1}</div>\n```\n"
			writeFileSync(join(dir, "doc.md"), markdown)
			const io = capture()
			const code = await runCheck({
				cwd: dir,
				files: [],
				reporter: "pretty",
				raw: true,
				static: true,
				fix: true,
				dryRun: true,
				...io,
			})

			expect(code).toBe(1)
			expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe(markdown)
			expect(io.logs.join("\n")).toContain("-```ts\n+```tsx")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("prints why a file was skipped when --fix refuses it", async () => {
		const dir = project('```ts\nconst value = "OLD"\n```\n')
		try {
			// A rule edit aimed at a file the check never read.
			writeFileSync(join(dir, "notes.txt"), "x\n")
			writeFileSync(join(dir, "kiira.config.mjs"), config.replace("file: ctx.file,", 'file: "notes.txt",'))
			const io = capture()
			await runCheck({ cwd: dir, files: [], reporter: "json", fix: true, ...io })

			expect(io.errors).toEqual(["Skipped notes.txt: the check did not read this file."])
			expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("x\n")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("runCheck GitHub step summary", () => {
	const summaryPath = join(mkdtempSync(join(tmpdir(), "kiira-summary-")), "summary.md")

	function run(reporter: "github" | "pretty" | "json", env: Record<string, string | undefined>) {
		return runCheck({ cwd: fixtures, files: ["bad.md"], reporter, static: true, raw: true, env, ...capture() })
	}

	it("appends a summary for the github reporter, keeping existing content", async () => {
		writeFileSync(summaryPath, "earlier step\n")
		await run("github", { GITHUB_STEP_SUMMARY: summaryPath })
		expect(readFileSync(summaryPath, "utf8")).toBe(
			[
				"earlier step",
				"### Kiira",
				"",
				"Failed",
				"",
				"- Files: 1",
				"- Snippets checked: 1",
				"- Errors: 1",
				"- Warnings: 0",
				"",
				"- `bad.md:4` Type 'string' is not assignable to type 'number'.",
				"",
			].join("\n")
		)
	})

	it("warns and keeps the exit code when the summary cannot be written", async () => {
		const io = capture()
		const notAFile = dirname(summaryPath)
		const code = await runCheck({
			cwd: fixtures,
			files: ["bad.md"],
			reporter: "github",
			static: true,
			env: { GITHUB_STEP_SUMMARY: notAFile },
			...io,
		})
		expect(code).toBe(1)
		expect(io.errors.join("\n")).toContain(`could not write the step summary to ${notAFile}`)
	})

	it("writes nothing for other reporters or without the variable", async () => {
		writeFileSync(summaryPath, "")
		await run("pretty", { GITHUB_STEP_SUMMARY: summaryPath })
		await run("json", { GITHUB_STEP_SUMMARY: summaryPath })
		await run("github", {})
		expect(readFileSync(summaryPath, "utf8")).toBe("")
	})
})
