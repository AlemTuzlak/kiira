import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildBaseOptions, checkMarkdownFiles } from "./check"
import { resolveConfig } from "./config"
import type { KiiraDiagnostic } from "./types"
import {
	buildWorkspaceResolution,
	discoverWorkspacePackages,
	parsePnpmWorkspacePackages,
	resetWorkspaceCache,
} from "./workspace"

/** Lets a test change the workspace right after a glob finishes, before the cache stores its result. */
const globHook = vi.hoisted(() => ({ after: undefined as (() => void) | undefined }))

vi.mock("tinyglobby", async (importOriginal) => {
	const original = await importOriginal<typeof import("tinyglobby")>()
	return {
		...original,
		glob: async (...args: Parameters<typeof original.glob>) => {
			const result = await original.glob(...args)
			globHook.after?.()
			return result
		},
	}
})

const here = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(here, "../tests/fixtures/workspace")

function errors(diagnostics: KiiraDiagnostic[]): KiiraDiagnostic[] {
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

	it("collects @types as typeRoots and maps runtime-only packages to their @types declarations", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-ws-"))
		try {
			writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
			const pkg = join(dir, "packages", "lib")
			mkdirSync(join(pkg, "node_modules", "@types", "react"), { recursive: true })
			writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@demo/lib" }))

			const resolution = await buildWorkspaceResolution(dir)
			expect(resolution?.typeRoots.some((r) => r.endsWith("packages/lib/node_modules/@types"))).toBe(true)
			// `react` -> its @types declarations, so its runtime-only `.js` resolves to types.
			expect(resolution?.paths.react?.[0]?.endsWith("packages/lib/node_modules/@types/react")).toBe(true)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("owner-scoped workspace resolution", () => {
	it("keeps owner and root first, includes direct dependencies and @types, and preserves exhaustive fallback", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-ws-scope-"))
		try {
			writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({ name: "workspace-root", dependencies: { "@demo/root-dep": "*" } })
			)
			const manifests: Record<string, Record<string, unknown>> = {
				owner: {
					name: "@demo/owner",
					dependencies: { "@demo/direct": "*" },
					devDependencies: { "@demo/dev": "*" },
					peerDependencies: { "@demo/peer": "*" },
					optionalDependencies: { "@demo/optional": "*" },
				},
				direct: {
					name: "@demo/direct",
					exports: { ".": { types: "./types/index.d.ts", default: "./dist/index.js" } },
				},
				dev: { name: "@demo/dev" },
				peer: { name: "@demo/peer" },
				optional: { name: "@demo/optional" },
				types: { name: "@demo/types" },
				transitive: { name: "@demo/transitive" },
				"root-dep": { name: "@demo/root-dep" },
			}
			for (const [name, manifest] of Object.entries(manifests)) {
				const packageDir = join(dir, "packages", name)
				mkdirSync(join(packageDir, "node_modules"), { recursive: true })
				writeFileSync(join(packageDir, "package.json"), JSON.stringify(manifest))
			}
			mkdirSync(join(dir, "packages", "direct", "types"), { recursive: true })
			writeFileSync(join(dir, "packages", "direct", "types", "index.d.ts"), "export {}")
			mkdirSync(join(dir, "node_modules", "@types"), { recursive: true })
			mkdirSync(join(dir, "packages", "owner", "node_modules", "@types"), { recursive: true })
			mkdirSync(join(dir, "packages", "types", "node_modules", "@types"), { recursive: true })

			const exhaustive = await buildWorkspaceResolution(dir)
			const explicitExhaustive = await buildWorkspaceResolution(dir, {
				workspacePackageResolution: "exhaustive",
				markdownFiles: ["packages/owner/README.md"],
			})
			expect(explicitExhaustive?.baseUrl).toBe(exhaustive?.baseUrl)
			expect(new Set(explicitExhaustive?.paths["*"] ?? [])).toEqual(new Set(exhaustive?.paths["*"] ?? []))
			expect(explicitExhaustive?.typeRoots).toEqual(exhaustive?.typeRoots)
			expect(Object.keys(explicitExhaustive?.paths ?? {}).sort()).toEqual(Object.keys(exhaustive?.paths ?? {}).sort())

			const owner = await buildWorkspaceResolution(dir, {
				workspacePackageResolution: "owner",
				markdownFiles: ["packages/owner/README.md"],
			})
			const fallbacks = owner?.paths["*"] ?? []
			const checkOptions = await buildBaseOptions(dir, resolveConfig({ workspacePackageResolution: "owner" }), {
				markdownFiles: ["packages/owner/README.md"],
			})
			expect(new Set(checkOptions.paths?.["*"] ?? [])).toEqual(new Set(fallbacks))
			const posix = (...parts: string[]): string => join(...parts).replace(/\\/g, "/")
			expect(fallbacks[0]).toBe(posix(dir, "packages", "owner", "node_modules", "*"))
			expect(fallbacks[1]).toBe(posix(dir, "node_modules", "*"))
			for (const name of ["direct", "dev", "peer", "optional"]) {
				expect(fallbacks).toContain(posix(dir, "packages", name, "node_modules", "*"))
			}
			// A package the owner does not depend on adds only its @types, not its node_modules.
			expect(fallbacks).not.toContain(posix(dir, "packages", "types", "node_modules", "*"))
			expect(fallbacks).not.toContain(posix(dir, "packages", "transitive", "node_modules", "*"))
			expect(new Set(fallbacks).size).toBe(fallbacks.length)
			expect(owner?.paths["@demo/transitive/*"]).toBeDefined()
			expect(owner?.paths["@demo/direct"]?.[0]).toBe(posix(dir, "packages", "direct", "types", "index.d.ts"))
			expect(owner?.typeRoots).toEqual([
				posix(dir, "packages", "owner", "node_modules", "@types"),
				posix(dir, "node_modules", "@types"),
				posix(dir, "packages", "types", "node_modules", "@types"),
			])

			// An absolute Markdown path inside cwd scopes exactly like its relative form.
			const absolute = await buildWorkspaceResolution(dir, {
				workspacePackageResolution: "owner",
				markdownFiles: [join(dir, "packages", "owner", "README.md")],
			})
			expect(new Set(absolute?.paths["*"] ?? [])).toEqual(new Set(fallbacks))
			expect(absolute?.typeRoots).toEqual(owner?.typeRoots)

			const mixed = await buildWorkspaceResolution(dir, {
				workspacePackageResolution: "owner",
				markdownFiles: ["packages/owner/README.md", "packages/direct/README.md"],
			})
			expect(mixed?.paths["*"]).toContain(posix(dir, "packages", "direct", "node_modules", "*"))

			const rootOwner = await buildWorkspaceResolution(dir, {
				workspacePackageResolution: "owner",
				markdownFiles: ["README.md"],
			})
			expect(rootOwner?.paths["*"]?.[0]).toBe(posix(dir, "node_modules", "*"))
			expect(rootOwner?.paths["*"]).toContain(posix(dir, "packages", "root-dep", "node_modules", "*"))

			const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {})
			try {
				const unknown = await buildWorkspaceResolution(dir, {
					workspacePackageResolution: "owner",
					markdownFiles: ["../outside.md"],
				})
				expect(unknown?.baseUrl).toBe(exhaustive?.baseUrl)
				expect(new Set(unknown?.paths["*"] ?? [])).toEqual(new Set(exhaustive?.paths["*"] ?? []))
				expect(unknown?.typeRoots).toEqual(exhaustive?.typeRoots)
				expect(Object.keys(unknown?.paths ?? {}).sort()).toEqual(Object.keys(exhaustive?.paths ?? {}).sort())
				expect(warn).toHaveBeenCalledTimes(1)
				expect(warn.mock.calls[0]?.[0]).toMatch(/fell back to "exhaustive" because \.\.\/outside\.md is outside/)
			} finally {
				warn.mockRestore()
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("keeps tsconfig paths and typeRoots when owner pruning is enabled", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-ws-overrides-"))
		try {
			writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
			mkdirSync(join(dir, "node_modules"), { recursive: true })
			mkdirSync(join(dir, "packages", "owner", "node_modules", "@types"), { recursive: true })
			writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "workspace-root" }))
			writeFileSync(join(dir, "packages", "owner", "package.json"), JSON.stringify({ name: "@demo/owner" }))
			writeFileSync(
				join(dir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						baseUrl: ".",
						paths: { "*": ["user/*"], "@demo/owner": ["user/owner"] },
						typeRoots: ["custom-types"],
					},
				})
			)
			mkdirSync(join(dir, "custom-types"), { recursive: true })

			const options = await buildBaseOptions(dir, resolveConfig({ workspacePackageResolution: "owner" }), {
				markdownFiles: ["packages/owner/README.md"],
			})
			expect(options.paths?.["*"]).toEqual(["user/*"])
			expect(options.paths?.["@demo/owner"]).toEqual(["user/owner"])
			expect(options.typeRoots?.map((root) => root.replace(/\\/g, "/"))).toContain(
				join(dir, "custom-types").replace(/\\/g, "/")
			)
			expect(options.typeRoots).toContain(join(dir, "packages", "owner", "node_modules", "@types").replace(/\\/g, "/"))
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("checks each doc with its own owner's scope, alone or together with other docs", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-ws-partition-"))
		try {
			writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
			writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "workspace-root" }))
			for (const name of ["a", "b"]) {
				mkdirSync(join(dir, "packages", name), { recursive: true })
				writeFileSync(join(dir, "packages", name, "package.json"), JSON.stringify({ name: `@demo/${name}` }))
				writeFileSync(
					join(dir, "packages", name, "README.md"),
					'```ts\nimport { only } from "only-b"\nconst n: number = only\n```\n'
				)
			}
			// `only-b` is installed in package b only.
			const lib = join(dir, "packages", "b", "node_modules", "only-b")
			mkdirSync(lib, { recursive: true })
			writeFileSync(join(lib, "package.json"), JSON.stringify({ name: "only-b", types: "index.d.ts" }))
			writeFileSync(join(lib, "index.d.ts"), "export declare const only: number\n")

			const config = { include: ["**/*.md"], workspacePackageResolution: "owner" as const }
			const errorFiles = (diagnostics: KiiraDiagnostic[]): string[] =>
				[...new Set(diagnostics.filter((d) => d.severity === "error").map((d) => d.markdownFile))].sort()

			const together = await checkMarkdownFiles({
				cwd: dir,
				files: ["packages/a/README.md", "packages/b/README.md"],
				config,
			})
			const aloneA = await checkMarkdownFiles({ cwd: dir, files: ["packages/a/README.md"], config })
			const aloneB = await checkMarkdownFiles({ cwd: dir, files: ["packages/b/README.md"], config })
			expect(errorFiles(together.diagnostics)).toEqual(["packages/a/README.md"])
			expect(errorFiles(aloneA.diagnostics)).toEqual(["packages/a/README.md"])
			expect(errorFiles(aloneB.diagnostics)).toEqual([])
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

describe("workspace cache", () => {
	/** Force a path's mtime forward so a change made within the same millisecond is still detectable. */
	function touch(path: string): void {
		const later = new Date(Date.now() + 5_000)
		utimesSync(path, later, later)
	}

	function makeWorkspace(): string {
		const dir = mkdtempSync(join(tmpdir(), "kiira-ws-cache-"))
		writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
		mkdirSync(join(dir, "packages", "a"), { recursive: true })
		writeFileSync(join(dir, "packages", "a", "package.json"), JSON.stringify({ name: "@demo/a" }))
		return dir
	}

	beforeEach(() => {
		resetWorkspaceCache()
	})

	it("returns the same resolution object while the workspace is unchanged", async () => {
		const dir = makeWorkspace()
		try {
			const first = await buildWorkspaceResolution(dir)
			expect(first).toBe(await buildWorkspaceResolution(dir))
			expect(await discoverWorkspacePackages(dir)).toEqual(await discoverWorkspacePackages(dir))
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("picks up a package added under a workspace glob", async () => {
		const dir = makeWorkspace()
		try {
			expect((await discoverWorkspacePackages(dir)).map((p) => p.name)).toEqual(["@demo/a"])
			mkdirSync(join(dir, "packages", "b"))
			writeFileSync(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "@demo/b" }))
			touch(join(dir, "packages"))
			expect((await discoverWorkspacePackages(dir)).map((p) => p.name).sort()).toEqual(["@demo/a", "@demo/b"])
			expect(await buildWorkspaceResolution(dir)).toHaveProperty(["paths", "@demo/b/*"])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("picks up @types installed into a package after the first resolution", async () => {
		const dir = makeWorkspace()
		try {
			const types = join(dir, "packages", "a", "node_modules", "@types")
			mkdirSync(types, { recursive: true })
			expect((await buildWorkspaceResolution(dir))?.paths).not.toHaveProperty("react")
			mkdirSync(join(types, "react"))
			touch(types)
			expect((await buildWorkspaceResolution(dir))?.paths.react?.[0]?.endsWith("node_modules/@types/react")).toBe(true)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("picks up a package.json added to an existing empty directory", async () => {
		const dir = makeWorkspace()
		try {
			mkdirSync(join(dir, "packages", "b"))
			expect((await discoverWorkspacePackages(dir)).map((p) => p.name)).toEqual(["@demo/a"])
			writeFileSync(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "@demo/b" }))
			touch(join(dir, "packages", "b"))
			expect((await discoverWorkspacePackages(dir)).map((p) => p.name).sort()).toEqual(["@demo/a", "@demo/b"])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("picks up a package added to an existing subfolder of a nested glob", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiira-ws-cache-"))
		try {
			writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/**'\n")
			mkdirSync(join(dir, "packages", "group", "a"), { recursive: true })
			writeFileSync(join(dir, "packages", "group", "a", "package.json"), JSON.stringify({ name: "@demo/a" }))
			expect((await discoverWorkspacePackages(dir)).map((p) => p.name)).toEqual(["@demo/a"])
			mkdirSync(join(dir, "packages", "group", "b"))
			writeFileSync(join(dir, "packages", "group", "b", "package.json"), JSON.stringify({ name: "@demo/b" }))
			touch(join(dir, "packages", "group"))
			expect((await discoverWorkspacePackages(dir)).map((p) => p.name).sort()).toEqual(["@demo/a", "@demo/b"])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("does not cache a package added while the workspace is being scanned", async () => {
		const dir = makeWorkspace()
		globHook.after = () => {
			globHook.after = undefined
			mkdirSync(join(dir, "packages", "b"))
			writeFileSync(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "@demo/b" }))
			touch(join(dir, "packages"))
		}
		try {
			await discoverWorkspacePackages(dir)
			expect((await discoverWorkspacePackages(dir)).map((p) => p.name).sort()).toEqual(["@demo/a", "@demo/b"])
		} finally {
			globHook.after = undefined
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("keeps the cache intact when a caller mutates what it got", async () => {
		const dir = makeWorkspace()
		try {
			const packages = await discoverWorkspacePackages(dir)
			packages.push({ name: "@demo/fake", dir })
			packages.sort().reverse()
			Object.assign(packages[1] ?? {}, { name: "@demo/renamed" })
			expect(await discoverWorkspacePackages(dir)).toEqual([{ name: "@demo/a", dir: join(dir, "packages", "a") }])
			const resolution = await buildWorkspaceResolution(dir)
			const targets = resolution?.paths["@demo/a/*"] ?? []
			const expected = [...targets]
			expect(() => targets.push("x")).toThrow(TypeError)
			expect(() => resolution?.typeRoots.push("x")).toThrow(TypeError)
			expect((await buildWorkspaceResolution(dir))?.paths["@demo/a/*"]).toEqual(expected)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("caches owner-scoped resolutions per owner, frozen, until an owner's package.json changes", async () => {
		const dir = makeWorkspace()
		try {
			mkdirSync(join(dir, "packages", "b", "node_modules"), { recursive: true })
			writeFileSync(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "@demo/b" }))
			const owner = (file: string) =>
				buildWorkspaceResolution(dir, { workspacePackageResolution: "owner", markdownFiles: [file] })
			const a = await owner("packages/a/README.md")
			expect(a).toBe(await owner("packages/a/docs/guide.md"))
			expect(a).not.toBe(await owner("packages/b/README.md"))
			expect(a).not.toBe(await buildWorkspaceResolution(dir))
			expect(Object.isFrozen(a)).toBe(true)
			expect(() => a?.paths["@demo/a/*"]?.push("x")).toThrow(TypeError)
			const bModules = join(dir, "packages", "b", "node_modules", "*").replace(/\\/g, "/")
			expect(a?.paths["*"] ?? []).not.toContain(bModules)

			const manifest = join(dir, "packages", "a", "package.json")
			writeFileSync(manifest, JSON.stringify({ name: "@demo/a", dependencies: { "@demo/b": "workspace:*" } }))
			touch(manifest)
			expect((await owner("packages/a/README.md"))?.paths["*"]).toContain(bModules)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("picks up a renamed export after its package.json changes", async () => {
		const dir = makeWorkspace()
		try {
			expect(await buildWorkspaceResolution(dir)).not.toHaveProperty(["paths", "@demo/a/sub"])
			const manifest = join(dir, "packages", "a", "package.json")
			writeFileSync(manifest, JSON.stringify({ name: "@demo/a", exports: { ".": "./index.js", "./sub": "./sub.js" } }))
			touch(manifest)
			expect(await buildWorkspaceResolution(dir)).toHaveProperty(["paths", "@demo/a/sub"])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
