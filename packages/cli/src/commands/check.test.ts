import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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
})
