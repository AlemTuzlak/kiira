import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { type CheckInput, check } from "./index"
import { definePlugin, defineRule } from "./plugin"

// Never spawn a package manager in tests; assert the call instead.
const ensureExternalPackages = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("./external", async (importOriginal) => ({
	...(await importOriginal<typeof import("./external")>()),
	ensureExternalPackages,
}))

function reporter(name: string, message: string) {
	const rule = defineRule({
		meta: { scope: "document", defaultSeverity: "error" },
		create(ctx) {
			const start = { line: 0, character: 0 }
			ctx.report({ range: { start, end: { line: 0, character: 1 } }, message })
		},
	})
	return definePlugin({ name, rules: { found: rule } })
}

function workspace(config?: object): string {
	const cwd = mkdtempSync(join(tmpdir(), "kiira-check-api-"))
	writeFileSync(join(cwd, "doc.md"), "# Title\n")
	if (config) {
		writeFileSync(join(cwd, "kiira.config.json"), JSON.stringify(config))
	}
	return cwd
}

describe("check", () => {
	it("returns the diagnostics of an inline plugin's document rule", async () => {
		const input: CheckInput = {
			cwd: workspace(),
			config: { include: ["**/*.md"], rules: { "demo/found": "error" } },
			plugins: [reporter("demo", "found it")],
		}
		const result = await check(input)
		expect(result.diagnostics).toMatchObject([{ code: "demo/found", message: "found it", markdownFile: "doc.md" }])
	})

	it("loads the config from cwd when none is passed", async () => {
		const cwd = workspace({ include: ["doc.md"], rules: { "demo/found": "error" } })
		const result = await check({ cwd, plugins: [reporter("demo", "found it")] })
		expect(result.stats).toMatchObject({ markdownFiles: 1, errors: 1 })
	})

	it("lets a passed plugin replace a config plugin of the same name", async () => {
		const result = await check({
			cwd: workspace(),
			config: {
				include: ["**/*.md"],
				plugins: [reporter("demo", "from config"), reporter("other", "kept")],
				rules: { "demo/found": "error", "other/found": "error" },
			},
			plugins: [reporter("demo", "from call")],
		})
		expect(result.diagnostics.map((d) => d.message).sort()).toEqual(["from call", "kept"])
	})

	it("resolves a relative cwd and installs the config's external packages", async () => {
		const cwd = workspace()
		const processCwd = vi.spyOn(process, "cwd").mockReturnValue(dirname(cwd))
		const projectCwd = defineRule({
			meta: { scope: "document", defaultSeverity: "error" },
			create(ctx) {
				const start = { line: 0, character: 0 }
				ctx.report({ range: { start, end: { line: 0, character: 1 } }, message: ctx.project.cwd })
			},
		})
		try {
			const result = await check({
				cwd: basename(cwd),
				config: { include: ["**/*.md"], externalPackages: { "left-pad": "1.3.0" } },
				plugins: [definePlugin({ name: "demo", rules: { cwd: projectCwd } })],
			})
			expect(result.diagnostics.map((d) => d.message)).toEqual([cwd])
			expect(ensureExternalPackages).toHaveBeenCalledWith(cwd, { "left-pad": "1.3.0" }, expect.anything())
		} finally {
			processCwd.mockRestore()
		}
	})
})
