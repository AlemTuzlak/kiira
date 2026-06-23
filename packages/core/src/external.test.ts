import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	collectExternalPackages,
	detectPackageManager,
	ensureExternalPackages,
	externalCacheDir,
	externalResolution,
} from "./external"

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "kiira-ext-"))
}

describe("detectPackageManager", () => {
	it("defaults to npm when no lockfile is present", () => {
		expect(detectPackageManager(tempDir())).toBe("npm")
	})

	it("detects pnpm, yarn, and bun from their lockfiles", () => {
		const pnpm = tempDir()
		writeFileSync(join(pnpm, "pnpm-lock.yaml"), "")
		expect(detectPackageManager(pnpm)).toBe("pnpm")

		const yarn = tempDir()
		writeFileSync(join(yarn, "yarn.lock"), "")
		expect(detectPackageManager(yarn)).toBe("yarn")

		const bun = tempDir()
		writeFileSync(join(bun, "bun.lock"), "")
		expect(detectPackageManager(bun)).toBe("bun")
	})

	it("prefers bun when both bun and npm lockfiles exist", () => {
		const dir = tempDir()
		writeFileSync(join(dir, "bun.lockb"), "")
		writeFileSync(join(dir, "package-lock.json"), "{}")
		expect(detectPackageManager(dir)).toBe("bun")
	})
})

describe("collectExternalPackages", () => {
	it("merges top-level and per-override packages (override wins on duplicate)", () => {
		const merged = collectExternalPackages({
			externalPackages: { zod: "^3", shared: "^1" },
			overrides: [{ externalPackages: { competitor: "^2", shared: "^9" } }, {}],
		})
		expect(merged).toEqual({ zod: "^3", shared: "^9", competitor: "^2" })
	})

	it("returns an empty object when nothing is declared", () => {
		expect(collectExternalPackages({})).toEqual({})
	})
})

describe("externalResolution", () => {
	it("returns undefined when no packages are declared", () => {
		expect(externalResolution(tempDir(), {})).toBeUndefined()
	})

	it("returns undefined when the cache has not been installed yet", () => {
		expect(externalResolution(tempDir(), { zod: "^3" })).toBeUndefined()
	})

	it("returns the node_modules glob and @types typeRoot once the cache exists", () => {
		const cwd = tempDir()
		const nm = join(externalCacheDir(cwd), "node_modules")
		mkdirSync(join(nm, "@types"), { recursive: true })
		const res = externalResolution(cwd, { zod: "^3" })
		expect(res?.nodeModulesGlob).toBe(`${nm.split("\\").join("/")}/*`)
		expect(res?.typeRoots).toEqual([`${nm.split("\\").join("/")}/@types`])
	})

	it("omits typeRoots when there is no @types directory", () => {
		const cwd = tempDir()
		mkdirSync(join(externalCacheDir(cwd), "node_modules"), { recursive: true })
		expect(externalResolution(cwd, { zod: "^3" })?.typeRoots).toEqual([])
	})
})

type Call = { cmd: string; args: string[]; cwd: string }

/** A fake install runner that records calls and simulates an installed tree. */
function fakeRunner(results: Array<{ ok: boolean }>) {
	const calls: Call[] = []
	let i = 0
	const runInstall = (cmd: string, args: string[], cwd: string) => {
		calls.push({ cmd, args, cwd })
		const result = results[i] ?? { ok: true }
		i += 1
		if (result.ok) {
			mkdirSync(join(cwd, "node_modules"), { recursive: true })
		}
		return { ok: result.ok, output: "" }
	}
	return { calls, runInstall }
}

describe("ensureExternalPackages", () => {
	it("does nothing when no packages are declared", async () => {
		const { calls, runInstall } = fakeRunner([])
		await ensureExternalPackages(tempDir(), {}, { runInstall })
		expect(calls).toEqual([])
	})

	it("writes the cache package.json and runs the detected PM", async () => {
		const cwd = tempDir()
		writeFileSync(join(cwd, "pnpm-lock.yaml"), "")
		const { calls, runInstall } = fakeRunner([{ ok: true }])

		await ensureExternalPackages(cwd, { zod: "^3" }, { runInstall })

		const pkg = JSON.parse(readFileSync(join(externalCacheDir(cwd), "package.json"), "utf8"))
		expect(pkg.dependencies).toEqual({ zod: "^3" })
		expect(pkg.private).toBe(true)
		expect(calls).toHaveLength(1)
		expect(calls[0].cmd).toBe("pnpm")
		expect(calls[0].args).toEqual(["install", "--ignore-workspace"])
		expect(calls[0].cwd).toBe(externalCacheDir(cwd))
	})

	it("skips the install when deps are unchanged and the cache exists", async () => {
		const cwd = tempDir()
		const first = fakeRunner([{ ok: true }])
		await ensureExternalPackages(cwd, { zod: "^3" }, { runInstall: first.runInstall })
		expect(first.calls).toHaveLength(1)

		const second = fakeRunner([{ ok: true }])
		await ensureExternalPackages(cwd, { zod: "^3" }, { runInstall: second.runInstall })
		expect(second.calls).toHaveLength(0)
	})

	it("reinstalls when the declared deps change", async () => {
		const cwd = tempDir()
		const first = fakeRunner([{ ok: true }])
		await ensureExternalPackages(cwd, { zod: "^3" }, { runInstall: first.runInstall })

		const second = fakeRunner([{ ok: true }])
		await ensureExternalPackages(cwd, { zod: "^3", valibot: "^1" }, { runInstall: second.runInstall })
		expect(second.calls).toHaveLength(1)
	})

	it("retries a failed install on the next run instead of skipping", async () => {
		const cwd = tempDir()
		// First install succeeds: leaves a manifest and a node_modules behind.
		await ensureExternalPackages(cwd, { zod: "^3" }, { runInstall: fakeRunner([{ ok: true }]).runInstall })

		// Change the deps; this install fails (the prior node_modules still exists).
		const failed = fakeRunner([{ ok: false }])
		await ensureExternalPackages(cwd, { valibot: "^1" }, { runInstall: failed.runInstall })
		expect(failed.calls).toHaveLength(1)

		// Same deps again must RETRY (not be treated as up-to-date), because the
		// failed attempt left no valid manifest.
		const retry = fakeRunner([{ ok: true }])
		await ensureExternalPackages(cwd, { valibot: "^1" }, { runInstall: retry.runInstall })
		expect(retry.calls).toHaveLength(1)
	})

	it("falls back to npm when the detected PM fails", async () => {
		const cwd = tempDir()
		writeFileSync(join(cwd, "pnpm-lock.yaml"), "")
		const { calls, runInstall } = fakeRunner([{ ok: false }, { ok: true }])

		await ensureExternalPackages(cwd, { zod: "^3" }, { runInstall })

		expect(calls).toHaveLength(2)
		expect(calls[0].cmd).toBe("pnpm")
		expect(calls[1].cmd).toBe("npm")
	})

	it("warns and does not throw when every install attempt fails", async () => {
		const cwd = tempDir()
		const { runInstall } = fakeRunner([{ ok: false }, { ok: false }])
		const warnings: string[] = []
		await ensureExternalPackages(cwd, { zod: "^3" }, { runInstall, warn: (m) => warnings.push(m) })
		expect(warnings.join("\n")).toMatch(/external packages/i)
	})
})
