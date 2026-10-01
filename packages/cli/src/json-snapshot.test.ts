import { readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { discoverMarkdownFiles } from "kiira-core"
import { runCheck } from "./commands/check"

const here = dirname(fileURLToPath(import.meta.url))
const coreFixtures = resolve(here, "../../core/tests/fixtures")

// Fixture directories whose checks are self-contained (no config file to load,
// no external install). Each one's JSON report is pinned so that moving the
// built-in diagnostics onto the rule system cannot change a byte of output.
const PINNED = ["check", "codefix", "group", "jsxframework", "markdown", "overrides", "relative-imports", "workspace"]

describe("json reporter output is pinned per fixture", () => {
	for (const name of readdirSync(coreFixtures).filter((d) => PINNED.includes(d))) {
		it(`matches the snapshot for ${name}`, async () => {
			const cwd = join(coreFixtures, name)
			const files = await discoverMarkdownFiles({ cwd, include: ["**/*.{md,mdx}"] })
			const logs: string[] = []
			const errors: string[] = []
			await runCheck({
				cwd,
				files,
				reporter: "json",
				static: true,
				log: (m) => logs.push(m),
				error: (m) => errors.push(m),
			})
			expect(errors).toEqual([])
			expect(logs.join("\n")).toMatchSnapshot()
		})
	}

	it("starts with schemaVersion", async () => {
		const logs: string[] = []
		await runCheck({
			cwd: join(coreFixtures, "check"),
			files: ["docs.md"],
			reporter: "json",
			static: true,
			log: (m) => logs.push(m),
			error: () => {},
		})
		expect(Object.keys(JSON.parse(logs.join("\n")))[0]).toBe("schemaVersion")
	})
})
