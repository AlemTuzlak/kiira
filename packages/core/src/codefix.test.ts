import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getCodeFixes } from "./codefix"
import { resolveConfig } from "./config"
import { extractSnippetsFromContent } from "./extract"
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
