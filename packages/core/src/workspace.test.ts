import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"
import type { TypedownDiagnostic } from "./types"
import { buildWorkspaceResolution, discoverWorkspacePackages, parsePnpmWorkspacePackages } from "./workspace"

const here = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(here, "../tests/fixtures/workspace")

function errors(diagnostics: TypedownDiagnostic[]): TypedownDiagnostic[] {
	return diagnostics.filter((d) => d.severity === "error")
}

describe("parsePnpmWorkspacePackages", () => {
	it("extracts the packages globs", () => {
		const yaml = "packages:\n  - 'packages/*'\n  - 'apps/*'\nonlyBuiltDependencies:\n  - esbuild\n"
		expect(parsePnpmWorkspacePackages(yaml)).toEqual(["packages/*", "apps/*"])
	})

	it("ignores comment lines (even at column 0) inside the packages block", () => {
		const yaml = "packages:\n# our packages\n  - 'packages/*'\n  - 'apps/*'\n"
		expect(parsePnpmWorkspacePackages(yaml)).toEqual(["packages/*", "apps/*"])
	})
})

describe("discoverWorkspacePackages", () => {
	it("finds named packages from pnpm-workspace.yaml", async () => {
		const packages = await discoverWorkspacePackages(workspace)
		expect(packages.map((p) => p.name)).toEqual(["@demo/lib"])
	})
})

describe("buildWorkspaceResolution", () => {
	it("maps exports to absolute source paths, even for renamed subpaths", async () => {
		const resolution = await buildWorkspaceResolution(workspace)
		const root = resolution?.paths["@demo/lib"]
		// "." export points at dist, but resolves to the source file.
		expect(root?.[0]?.endsWith("packages/lib/src/index.ts")).toBe(true)
		expect(root?.[0]?.startsWith("/") || /^[A-Za-z]:/.test(root?.[0] ?? "")).toBe(true)
		// "./helpers" -> dist/internal/helpers; the renamed subpath still resolves
		// to its source (src/internal/helpers.ts), keeping the package on one side
		// of the src/dist line.
		expect(resolution?.paths["@demo/lib/helpers"]?.[0]?.endsWith("packages/lib/src/internal/helpers.ts")).toBe(true)
	})

	it("returns undefined when cwd is not a workspace", async () => {
		expect(await buildWorkspaceResolution(here)).toBeUndefined()
	})

	it("collects @types directories from workspace packages as typeRoots", async () => {
		const dir = mkdtempSync(join(tmpdir(), "typedown-ws-"))
		try {
			writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
			const pkg = join(dir, "packages", "lib")
			mkdirSync(join(pkg, "node_modules", "@types", "react"), { recursive: true })
			writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@demo/lib" }))

			const resolution = await buildWorkspaceResolution(dir)
			expect(resolution?.typeRoots.some((r) => r.endsWith("packages/lib/node_modules/@types"))).toBe(true)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("checkMarkdownFiles with workspace resolution", () => {
	it("resolves a workspace package import and flags a missing member (not a missing module)", async () => {
		const result = await checkMarkdownFiles({
			cwd: workspace,
			files: ["docs/usage.md"],
			config: { include: ["**/*.md"], packageMode: "workspace" },
		})
		// The valid import resolves; the bad import is a missing-member (TS2305),
		// proving `@demo/lib` resolved rather than failing as a missing module (TS2307).
		expect(errors(result.diagnostics).some((d) => d.code === 2305)).toBe(true)
		expect(errors(result.diagnostics).some((d) => d.code === 2307)).toBe(false)
	})
})
