import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getCodeFixes } from "./codefix"
import { resolveConfig } from "./config"
import { extractSnippetsFromContent } from "./extract"
import { definePlugin } from "./plugin"
import { createVirtualFiles } from "./virtual"

const here = dirname(fileURLToPath(import.meta.url))
const cwd = resolve(here, "../tests/fixtures/codefix")
const config = { include: ["**/*.md"], tsconfig: "tsconfig.json" }

async function virtualFilesFor(file: string) {
	const content = await readFile(resolve(cwd, file), "utf8")
	const resolved = resolveConfig(config)
	const { snippets } = extractSnippetsFromContent({ markdownFile: file, content, config: resolved })
	const { virtualFiles } = await createVirtualFiles({ cwd, snippets, config })
	return virtualFiles
}

describe("getCodeFixes", () => {
	it("offers a spelling fix and maps the edit to the Markdown line", async () => {
		const virtualFiles = await virtualFilesFor("spelling.md")
		const actions = await getCodeFixes({
			cwd,
			virtualFiles,
			config,
			markdownFile: "spelling.md",
			// `consle` lives on zero-based line 3, columns 0-6.
			range: { start: { line: 3, character: 0 }, end: { line: 3, character: 6 } },
			errorCodes: [2552],
		})

		const spelling = actions.find((a) => a.edits.some((e) => e.newText === "console"))
		expect(spelling).toBeDefined()
		const edit = spelling?.edits.find((e) => e.newText === "console")
		expect(edit?.markdownFile).toBe("spelling.md")
		expect(edit?.range.start.line).toBe(3)
		expect(edit?.range.start.character).toBe(0)
	})

	it("offers an auto-import using a module another snippet imports, inserted at the snippet's top", async () => {
		const virtualFiles = await virtualFilesFor("autoimport.md")
		const actions = await getCodeFixes({
			cwd,
			virtualFiles,
			config,
			markdownFile: "autoimport.md",
			// The second snippet's bare `greet()` is on zero-based line 8.
			range: { start: { line: 8, character: 0 }, end: { line: 8, character: 5 } },
			errorCodes: [2304],
		})

		const importFix = actions.find((a) =>
			a.edits.some((e) => e.newText.includes("greet") && e.newText.includes("helpers"))
		)
		expect(importFix).toBeDefined()
		// The import is inserted at the top of the snippet's own code (line 8), not the
		// generated module marker or another fence.
		const edit = importFix?.edits[0]
		expect(edit?.markdownFile).toBe("autoimport.md")
		expect(edit?.range.start.line).toBe(8)
	})
})

describe("getCodeFixes with a TypeScript hook", () => {
	const input = {
		cwd,
		markdownFile: "spelling.md",
		range: { start: { line: 3, character: 0 }, end: { line: 3, character: 6 } },
		errorCodes: [2552],
	}
	const offersConsole = (actions: Awaited<ReturnType<typeof getCodeFixes>>) =>
		actions.some((a) => a.edits.some((e) => e.newText === "console"))

	it("checks with the hook's options, so a fix that depends on them goes away", async () => {
		const virtualFiles = await virtualFilesFor("spelling.md")
		const seen: string[] = []
		// Without DOM or node types there is no `console` to suggest.
		const plugin = definePlugin({
			name: "hook",
			typescript: (_file, ctx) => {
				seen.push(ctx.text)
				return { compilerOptions: { lib: ["es2022"], types: [] } }
			},
		})
		const withHook = await getCodeFixes({
			...input,
			virtualFiles,
			config: { ...config, plugins: [plugin] },
			text: "# document text",
		})
		expect(offersConsole(withHook)).toBe(false)
		expect(offersConsole(await getCodeFixes({ ...input, virtualFiles, config }))).toBe(true)
		expect(seen).toEqual(["# document text"])
	})

	it("hands the hook the checked fences' code when the caller passes no text", async () => {
		const virtualFiles = await virtualFilesFor("spelling.md")
		const seen: string[] = []
		const plugin = definePlugin({
			name: "hook",
			typescript: (_file, ctx) => {
				seen.push(ctx.text)
				return undefined
			},
		})
		await getCodeFixes({ ...input, virtualFiles, config: { ...config, plugins: [plugin] } })
		expect(seen).toEqual(['consle.log("hello")'])
	})

	it("hands the hook every fence parsed from the text, as checking does", async () => {
		const virtualFiles = await virtualFilesFor("spelling.md")
		const seen: string[][] = []
		const plugin = definePlugin({
			name: "hook",
			typescript: (_file, ctx) => {
				seen.push(ctx.snippets.map((s) => s.code))
				return undefined
			},
		})
		const text = `${await readFile(resolve(cwd, "spelling.md"), "utf8")}\n\`\`\`ts ignore\nconst skipped = 1\n\`\`\`\n`
		await getCodeFixes({ ...input, virtualFiles, config: { ...config, plugins: [plugin] }, text })
		expect(seen).toEqual([['consle.log("hello")', "const skipped = 1"]])
	})

	it("reuses the hook's project while the document is unchanged", async () => {
		const virtualFiles = await virtualFilesFor("spelling.md")
		const projects: unknown[] = []
		const plugin = definePlugin({
			name: "hook",
			typescript: (_file, ctx) => {
				projects.push(ctx.project)
				return undefined
			},
		})
		const run = (text: string) =>
			getCodeFixes({ ...input, virtualFiles, config: { ...config, plugins: [plugin] }, text })
		await run("# one")
		await run("# one")
		await run("# two")
		expect(projects[1]).toBe(projects[0])
		expect(projects[2]).not.toBe(projects[0])
	})
})
