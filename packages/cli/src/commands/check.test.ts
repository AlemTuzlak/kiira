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
