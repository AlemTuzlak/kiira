import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildBaseOptions, checkMarkdownFiles, optionsForFile } from "./check"
import { resolveConfig } from "./config"
import { externalCacheDir } from "./external"
import type { KiiraDiagnostic } from "./types"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/check")

function errors(diagnostics: KiiraDiagnostic[]): KiiraDiagnostic[] {
	return diagnostics.filter((d) => d.severity === "error")
}

describe("checkMarkdownFiles", () => {
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
			optionsForFile(fixtures, {}, [{ include: ["**/*.md"], defaultGroup: "none" }], "docs.md")
		).not.toThrow()
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
