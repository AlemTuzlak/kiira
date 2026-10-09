import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildBaseOptions, checkMarkdownFiles, convertOverrideOptions, optionsForFile } from "./check"
import { overrideMatcher, resolveConfig } from "./config"
import { externalCacheDir } from "./external"
import { definePlugin, defineRule } from "./plugin"
import type { KiiraDiagnostic } from "./types"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/check")

function errors(diagnostics: KiiraDiagnostic[]): KiiraDiagnostic[] {
	return diagnostics.filter((d) => d.severity === "error")
}

describe("checkMarkdownFiles", () => {
	it("returns the exact text of every document and every file a rule read", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "kiira-sources-"))
		const markdown = "```ts\r\nconst a = 1\r\n```\r\n"
		writeFileSync(join(cwd, "doc.md"), markdown)
		writeFileSync(join(cwd, "notes.txt"), "notes")
		const reader = defineRule({
			meta: { scope: "project", defaultSeverity: "warn" },
			create(ctx) {
				ctx.fs.readText("./notes.txt")
				ctx.fs.readText("missing.txt")
			},
		})
		const result = await checkMarkdownFiles({
			cwd,
			files: ["doc.md"],
			config: { plugins: [definePlugin({ name: "t", rules: { reader } })], rules: { "t/reader": "warn" } },
		})
		expect(result.sources).toEqual({ "doc.md": markdown, "notes.txt": "notes" })
	})

	it("checks .mdx files without the caller loading the MDX parser", async () => {
		vi.resetModules()
		const { checkMarkdownFiles: freshCheck } = await import("./check")
		const cwd = mkdtempSync(join(tmpdir(), "kiira-check-mdx-"))
		writeFileSync(
			join(cwd, "page.mdx"),
			["<Callout>", "", "```ts", 'const n: number = "x"', "```", "", "</Callout>", ""].join("\n")
		)
		const result = await freshCheck({ cwd, files: ["page.mdx"], config: { include: ["**/*.mdx"] } })
		expect(result.snippets).toHaveLength(1)
		expect(errors(result.diagnostics).some((d) => d.code === 2322)).toBe(true)
		expect(result.diagnostics.some((d) => d.message.includes("not loaded"))).toBe(false)
	})

	it("reports a missing export as TS2305 mapped to the Markdown source range", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})

		const missing = errors(result.diagnostics).find((d) => d.code === 2305)
		expect(missing).toBeDefined()
		expect(missing?.source).toBe("typescript")
		expect(missing?.markdownFile).toBe("docs.md")
		expect(missing?.markdownRange.start.line).toBe(5)
		// `import { ` is 9 characters, so the member starts at character 9.
		expect(missing?.markdownRange.start.character).toBe(9)
	})

	it("reports a plain type error (TS2322) on its Markdown line", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})
		const typeError = errors(result.diagnostics).find((d) => d.code === 2322)
		expect(typeError?.markdownRange.start.line).toBe(19)
	})

	it("produces no errors for snippets that type-check cleanly", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})
		// Only the two intentionally-broken snippets should error.
		expect(errors(result.diagnostics)).toHaveLength(2)
	})

	it("computes stats", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})
		expect(result.stats.markdownFiles).toBe(1)
		expect(result.stats.snippets).toBe(3)
		expect(result.stats.checked).toBe(3)
		expect(result.stats.ignored).toBe(0)
		expect(result.stats.errors).toBe(2)
	})

	it("maps diagnostics back through prepended fixture lines", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["with-fixture.md"],
			config: {
				include: ["**/*.md"],
				fixtures: {
					node: { type: "prepend", content: "const a = 1\nconst b = 2\nconst c = 3" },
				},
			},
		})
		const typeError = errors(result.diagnostics).find((d) => d.code === 2322)
		expect(typeError).toBeDefined()
		// The error is on the single code line (Markdown line 1), despite the
		// three prepended fixture lines pushing it to virtual line 3.
		expect(typeError?.markdownRange.start.line).toBe(1)
	})

	it("does not leak a defaultGroup override into compilerOptions", () => {
		// `defaultGroup` is a Kiira concept, not a tsconfig option, so it must be
		// stripped before the override is converted — otherwise TS throws "Unknown
		// compiler option 'defaultGroup'".
		expect(() =>
			optionsForFile(
				fixtures,
				{},
				resolveConfig({ overrides: [{ include: ["**/*.md"], defaultGroup: "none" }] }),
				"docs.md"
			)
		).not.toThrow()
	})

	it("does not leak rules, presets, or codeFenceLanguages overrides into compilerOptions", () => {
		const override = {
			include: ["**/*.md"],
			rules: { group: "off" as const },
			presets: [{ name: "p" }],
			codeFenceLanguages: ["ts"],
			noImplicitAny: false,
		}
		expect(optionsForFile(fixtures, {}, resolveConfig({ overrides: [override] }), "docs.md")).toMatchObject({
			noImplicitAny: false,
		})
	})

	it("applies the per-file unused-symbols level, as checking does", () => {
		const resolved = resolveConfig({
			checkUnusedSymbols: true,
			overrides: [{ include: ["loose/**"], rules: { "unused-symbols": "off" } }],
		})
		expect(optionsForFile(fixtures, {}, resolved, "docs.md")).toMatchObject({
			noUnusedLocals: true,
			noUnusedParameters: true,
		})
		expect(optionsForFile(fixtures, {}, resolved, "loose/a.md")).toMatchObject({
			noUnusedLocals: false,
			noUnusedParameters: false,
		})
		const cli = resolveConfig({}, { "unused-symbols": "warn" })
		expect(optionsForFile(fixtures, {}, cli, "docs.md")).toMatchObject({ noUnusedLocals: true })
	})

	it("still accepts a bare overrides array", () => {
		expect(
			optionsForFile(fixtures, { strict: true }, [{ include: ["**/loose/*"], noImplicitAny: false }], "loose/a.md")
		).toEqual({ strict: true, noImplicitAny: false })
	})

	it("reuses the compiled matcher and converted options for the same override and cwd", () => {
		const override = { include: ["**/loose/*"], noImplicitAny: false }
		const other = { ...override }
		expect(overrideMatcher(override)).toBe(overrideMatcher(override))
		expect(overrideMatcher(other)).not.toBe(overrideMatcher(override))
		const options = convertOverrideOptions(fixtures, override)
		expect(convertOverrideOptions(fixtures, override)).toBe(options)
		expect(convertOverrideOptions(fixtures, other)).not.toBe(options)
		expect(convertOverrideOptions(join(fixtures, "sub"), override)).not.toBe(options)
		expect(convertOverrideOptions(fixtures, other)).toEqual(options)
	})
})

function extTempDir(): string {
	return mkdtempSync(join(tmpdir(), "kiira-check-ext-"))
}

describe("buildBaseOptions external packages", () => {
	it("appends the external cache to paths['*'] and typeRoots when declared and installed", async () => {
		const cwd = extTempDir()
		const nm = join(externalCacheDir(cwd), "node_modules")
		mkdirSync(join(nm, "@types"), { recursive: true })

		const options = await buildBaseOptions(
			cwd,
			resolveConfig({ externalPackages: { zod: "^3" }, packageMode: "packed" })
		)

		const star = options.paths?.["*"] ?? []
		expect(star.some((p) => p.includes("/.kiira/node_modules/*"))).toBe(true)
		expect((options.typeRoots ?? []).some((r) => r.endsWith("/.kiira/node_modules/@types"))).toBe(true)
	})

	it("adds nothing when externalPackages is empty", async () => {
		const cwd = extTempDir()
		const options = await buildBaseOptions(cwd, resolveConfig({ packageMode: "packed" }))
		const star = options.paths?.["*"] ?? []
		expect(star.some((p) => p.includes("/.kiira/"))).toBe(false)
	})

	it("appends the external cache AFTER workspace fallbacks in workspace mode", async () => {
		const cwd = extTempDir()
		// Minimal pnpm workspace so buildWorkspaceResolution contributes a node_modules
		// fallback to paths['*'] that the external cache must be appended after.
		writeFileSync(join(cwd, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
		mkdirSync(join(cwd, "node_modules"), { recursive: true })
		mkdirSync(join(cwd, "packages", "foo"), { recursive: true })
		writeFileSync(join(cwd, "packages", "foo", "package.json"), JSON.stringify({ name: "foo", version: "0.0.0" }))
		mkdirSync(join(externalCacheDir(cwd), "node_modules"), { recursive: true })

		const options = await buildBaseOptions(
			cwd,
			resolveConfig({ externalPackages: { zod: "^3" }, packageMode: "workspace" })
		)

		const star = options.paths?.["*"] ?? []
		// A workspace node_modules fallback exists and the external cache is last.
		expect(star.length).toBeGreaterThanOrEqual(2)
		expect(star[star.length - 1].includes("/.kiira/node_modules/*")).toBe(true)
		expect(star.slice(0, -1).some((p) => p.includes("/.kiira/"))).toBe(false)
	})
})
