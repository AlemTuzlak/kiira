import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MISSING_TYPESCRIPT_MESSAGE, getTypescript, selectTypescript, setTypescriptModule } from "./typescript"
import type { TypeScriptModule, TypescriptResolvers } from "./typescript"

const fake = (name: string, version = "5.9.0") => ({ name, version }) as unknown as TypeScriptModule

function projectWithTypescript(root: string, version: string): void {
	const dir = join(root, "node_modules", "typescript")
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "typescript", version, main: "index.js" }))
	writeFileSync(join(dir, "index.js"), `module.exports = { name: "project-${version}" }\n`)
}

/** Resolvers backed by in-memory modules, so no real install is touched. */
function resolvers(project: Record<string, unknown> | undefined, self: Record<string, unknown> | undefined) {
	const require = (modules: Record<string, unknown> | undefined) => (id: string) => {
		if (!modules || !(id in modules)) {
			throw new Error(`Cannot find module '${id}'`)
		}
		return modules[id]
	}
	return {
		requireFrom: () => require(project),
		self: () => require(self),
	} satisfies TypescriptResolvers
}

describe("typescript resolution", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "kiira-ts-"))
		setTypescriptModule(undefined)
	})
	afterEach(() => {
		setTypescriptModule(undefined)
		rmSync(root, { recursive: true, force: true })
	})

	it("uses the TypeScript installed in the project", () => {
		projectWithTypescript(root, "5.9.0")
		expect(selectTypescript(root)).toEqual({ name: "project-5.9.0" })
		expect(getTypescript()).toEqual({ name: "project-5.9.0" })
	})

	it("accepts TypeScript 6 from the project", () => {
		projectWithTypescript(root, "6.0.1")
		expect(selectTypescript(root)).toEqual({ name: "project-6.0.1" })
	})

	it("skips a project's TypeScript 7, which has no classic API, and falls back to its own", () => {
		projectWithTypescript(root, "7.0.2")
		const own = fake("own")
		const project = { "typescript/package.json": { version: "7.0.2" }, typescript: fake("native-port") }
		expect(selectTypescript(root, resolvers(project, { typescript: own }))).toBe(own)
		// Same through real resolution.
		projectWithTypescript(root, "7.0.2")
		expect(selectTypescript(root)).not.toEqual({ name: "project-7.0.2" })
	})

	it("falls back to kiira-core's own TypeScript when the project has none", () => {
		const own = fake("own")
		expect(selectTypescript(root, resolvers(undefined, { typescript: own }))).toBe(own)
		expect(getTypescript(resolvers(undefined, undefined))).toBe(own)
	})

	it("falls back when the project's TypeScript is older than 5.4", () => {
		const own = fake("own")
		for (const version of ["4.9.5", "5.3.3"]) {
			const project = { "typescript/package.json": { version }, typescript: fake("old", version) }
			expect(selectTypescript(root, resolvers(project, { typescript: own }))).toBe(own)
		}
	})

	it("throws a clear error when its own TypeScript is 7, which has no classic API", () => {
		const native = { version: "7.0.2", versionMajorMinor: "7.0" }
		const project = { "typescript/package.json": { version: "7.0.2" }, typescript: native }
		expect(() => selectTypescript(root, resolvers(project, { typescript: native }))).toThrow(
			/found TypeScript 7\.0\.2.*setTypescriptModule/
		)
		expect(() => getTypescript(resolvers(undefined, { typescript: native }))).toThrow(/found TypeScript 7\.0\.2/)
	})

	it("prefers an injected module over every lookup", () => {
		projectWithTypescript(root, "5.9.0")
		const injected = fake("injected")
		setTypescriptModule(injected)
		expect(selectTypescript(root)).toBe(injected)
		expect(getTypescript()).toBe(injected)
	})

	it("throws a helpful error when nothing resolves", () => {
		expect(() => selectTypescript(root, resolvers(undefined, undefined))).toThrow(MISSING_TYPESCRIPT_MESSAGE)
		expect(MISSING_TYPESCRIPT_MESSAGE).toBe('Kiira needs TypeScript 5.4+ or 6. Install "typescript" in your project.')
	})
})
