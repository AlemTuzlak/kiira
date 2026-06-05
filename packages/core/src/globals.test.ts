import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles, setTypescriptLibDir } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/globals")

async function globalErrors(): Promise<number> {
	const result = await checkMarkdownFiles({
		cwd: fixtures,
		files: ["doc.md"],
		config: { include: ["**/*.md"] },
	})
	return result.diagnostics.filter((d) => d.severity === "error").length
}

describe("default lib globals", () => {
	afterEach(() => setTypescriptLibDir(undefined))

	it("resolves ES and DOM globals (Date, JSON, console) when no project tsconfig is present", async () => {
		// With the default `lib` including DOM, none of `Date`/`JSON`/`console` should
		// be reported as an undefined name.
		expect(await globalErrors()).toBe(0)
	})

	it("honors a custom lib directory (the mechanism bundled hosts rely on)", async () => {
		const realLibDir = dirname(createRequire(import.meta.url).resolve("typescript"))
		// Pointed at the real lib dir, globals still resolve…
		setTypescriptLibDir(realLibDir)
		expect(await globalErrors()).toBe(0)
		// …and pointed at a directory without lib files, they do not — proving the
		// override is actually used (so a bundled host that ships libs must point here).
		setTypescriptLibDir(fixtures)
		expect(await globalErrors()).toBeGreaterThan(0)
	})
})
