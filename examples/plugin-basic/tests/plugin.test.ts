import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { check } from "kiira-core"
import { describe, expect, it } from "vitest"
import config from "../kiira.config"

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), "..")
// The built CLI, found through the workspace link. `pnpm test` builds it first.
const cli = join(dirname(createRequire(import.meta.url).resolve("kiira/package.json")), "dist/index.mjs")

const index = "---\ntitle: Home\nslug: home\n---\n\n# Home\n"
const page = (frontmatter: string, body = "# Page\n") => `---\n${frontmatter}\n---\n\n${body}`
const fence = (code: string, lang = "ts") => `\`\`\`${lang}\n${code}\n\`\`\`\n`

/** A throwaway project that loads the example's own config. A value of `undefined` leaves a default file out. */
function project(files: Record<string, string | undefined>): string {
	const dir = mkdtempSync(join(tmpdir(), "kiira-plugin-basic-"))
	const all: Record<string, string | undefined> = {
		"package.json": JSON.stringify({ name: "fixture" }),
		"tsconfig.docs.json": JSON.stringify({
			compilerOptions: {
				strict: true,
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				types: [],
				allowJs: true,
				checkJs: true,
			},
		}),
		"kiira.config.ts": `export { default } from ${JSON.stringify(join(exampleDir, "kiira.config.ts"))}\n`,
		"docs/index.md": index,
		...files,
	}
	for (const [path, text] of Object.entries(all)) {
		if (text !== undefined) {
			mkdirSync(dirname(join(dir, path)), { recursive: true })
			writeFileSync(join(dir, path), text)
		}
	}
	return dir
}

const run = (cwd: string, files?: string[]) => check({ cwd, config, files })

function runCli(cwd: string, args: string[]) {
	const { status, stdout, stderr } = spawnSync(process.execPath, [cli, "check", "--reporter", "json", ...args], {
		cwd,
		encoding: "utf8",
	})
	return { status, stdout, stderr }
}

describe("the example's own docs", () => {
	it("pass with no errors or warnings", async () => {
		const result = await check({ cwd: exampleDir, config })
		expect(result.diagnostics).toEqual([])
		expect(result.stats.markdownFiles).toBe(3)
		// The `appConfig` fence in guide.md only passes because of the TypeScript hook.
		expect(result.stats.checked).toBe(4)
	})
})

describe("team/frontmatter (document rule reading frontmatter.raw)", () => {
	it("requires frontmatter", async () => {
		const { diagnostics } = await run(project({ "docs/a.md": "# No frontmatter\n" }))
		expect(diagnostics).toMatchObject([
			{ code: "team/frontmatter", severity: "error", markdownFile: "docs/a.md", message: /Add frontmatter/ },
		])
	})

	it("requires a title", async () => {
		const { diagnostics } = await run(project({ "docs/a.md": page("slug: a") }))
		expect(diagnostics).toMatchObject([
			{ code: "team/frontmatter", markdownRange: { start: { line: 0 }, end: { line: 2 } }, message: /`title:`/ },
		])
		expect(diagnostics[0]?.fix).toBeUndefined()
	})

	it("offers an edits fix that inserts a slug before the closing delimiter", async () => {
		const { diagnostics } = await run(project({ "docs/guide.md": page("title: Getting Started Guide") }))
		expect(diagnostics).toMatchObject([
			{
				code: "team/frontmatter",
				fix: {
					kind: "edits",
					edits: [
						{
							file: "docs/guide.md",
							range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
							newText: "slug: getting-started-guide\n",
						},
					],
				},
			},
		])
	})
})

describe("kiira check --fix and --dry-run apply the edits fix", () => {
	const before = page("title: Getting Started Guide")
	const after = page("title: Getting Started Guide\nslug: getting-started-guide")

	it("--dry-run prints a diff, writes nothing and keeps the exit code", () => {
		const cwd = project({ "docs/guide.md": before })
		const { status, stdout, stderr } = runCli(cwd, ["--fix", "--dry-run"])

		expect(status).toBe(1)
		expect(readFileSync(join(cwd, "docs/guide.md"), "utf8")).toBe(before)
		// With the JSON reporter the diff goes to stderr, so stdout stays one JSON document.
		expect(stderr).toContain("+slug: getting-started-guide")
		expect(stderr).toContain("Nothing was written.")
		expect(JSON.parse(stdout).stats.errors).toBe(1)
	})

	it("--fix writes the slug and the re-check passes", () => {
		const cwd = project({ "docs/guide.md": before })
		const { status, stdout } = runCli(cwd, ["--fix"])

		expect(readFileSync(join(cwd, "docs/guide.md"), "utf8")).toBe(after)
		expect(status).toBe(0)
		expect(stdout).toContain("Fixed 1 edit.")
	})

	it("--fix keeps CRLF line endings", () => {
		const cwd = project({ "docs/guide.md": before.replaceAll("\n", "\r\n") })
		runCli(cwd, ["--fix"])

		expect(readFileSync(join(cwd, "docs/guide.md"), "utf8")).toBe(after.replaceAll("\n", "\r\n"))
	})
})

describe("team/no-any-exports (program rule using the type checker)", () => {
	it("flags an `any` export on the line of its declaration", async () => {
		const body = [fence('export const parsed = JSON.parse("{}")'), fence('export const named: string = "x"')].join("\n")
		const { diagnostics } = await run(project({ "docs/a.md": page("title: A\nslug: a", body) }))

		expect(diagnostics).toMatchObject([
			{
				code: "team/no-any-exports",
				severity: "warning",
				markdownFile: "docs/a.md",
				// Frontmatter takes lines 0-3, then a blank line and the fence opening on line 5.
				markdownRange: { start: { line: 6, character: 13 } },
				message: expect.stringContaining("`parsed`"),
			},
		])
	})

	it("checks JS fences through the same program", async () => {
		const body = fence('export const parsed = JSON.parse("{}")', "js")
		const { diagnostics } = await run(project({ "docs/a.md": page("title: A\nslug: a", body) }))

		expect(diagnostics.map((d) => d.code)).toEqual(["team/no-any-exports"])
	})
})

describe("team/docs-index (project rule)", () => {
	it("reports on package.json when docs/index.md is missing", async () => {
		const { diagnostics } = await run(project({ "docs/index.md": undefined, "docs/a.md": page("title: A\nslug: a") }))

		expect(diagnostics).toMatchObject([
			{
				code: "team/docs-index",
				severity: "error",
				markdownFile: "package.json",
				message: "Add docs/index.md: the docs need an index page.",
			},
		])
	})

	it("takes its file from the rule options", async () => {
		const cwd = project({ "docs/index.md": undefined, "docs/home.md": index })
		const result = await check({ cwd, config: { ...config, rules: { "team/docs-index": ["error", { file: "docs/home.md" }] } } })

		expect(result.diagnostics).toEqual([])
	})
})

describe("team/docs preset", () => {
	it("derives its include globs from the workspace packages", async () => {
		const cwd = project({
			"package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
			"docs/ignored.md": "# Not in a package, so not checked\n",
			"packages/a/package.json": JSON.stringify({ name: "a" }),
			"packages/a/docs/x.md": page("title: X\nslug: x"),
		})
		const result = await check({ cwd, config: { ...config, rules: { "team/docs-index": "off" } } })

		expect(Object.keys(result.sources)).toEqual(["packages/a/docs/x.md"])
		expect(result.diagnostics).toEqual([])
	})

	it("skips the run with allowEmpty when nothing matches", async () => {
		const result = await run(project({ "docs/index.md": undefined }))

		expect(result.skipped).toBe(true)
		expect(result.diagnostics).toEqual([])
	})

	it("limits fences to its codeFenceLanguages", async () => {
		const body = fence("this is not code", "mjs")
		const result = await run(project({ "docs/a.md": page("title: A\nslug: a", body) }))

		// `mjs` is a default fence identifier, but this preset lists only the Intent set.
		expect(result.stats.snippets).toBe(0)
	})
})

describe("TypeScript hook", () => {
	const code = fence("console.log(appConfig.name)")

	it("drops the diagnostic for the assumed global", async () => {
		const result = await run(project({ "docs/a.md": page("title: A\nslug: a", code) }))

		expect(result.diagnostics).toEqual([])
	})

	it("reads ctx.frontmatter, so a page can opt out", async () => {
		const result = await run(project({ "docs/a.md": page("title: A\nslug: a\nstrict: true", code) }))

		expect(result.diagnostics).toMatchObject([{ source: "typescript", code: 2304 }])
	})
})
