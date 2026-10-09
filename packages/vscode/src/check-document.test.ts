import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { definePlugin, defineRule } from "kiira-core/plugin"
import { checkDocument } from "./check-document"
import { diagnosticCodeLabel, selectDiagnostics } from "./diagnostics"

const here = dirname(fileURLToPath(import.meta.url))
// Reuse the CLI fixture project (a workspace with node_modules available above it).
const cwd = resolve(here, "../../cli/tests/fixtures/project")

describe("checkDocument", () => {
	it("reports type errors from in-memory document text", async () => {
		const result = await checkDocument({
			cwd,
			markdownFile: "inline.md",
			text: ["```ts", 'const n: number = "nope"', "```", ""].join("\n"),
			config: { include: ["**/*.md"] },
		})
		const error = result.diagnostics.find((d) => d.code === 2322)
		expect(error).toBeDefined()
		expect(error?.markdownFile).toBe("inline.md")
		// The fence opens on line 0, so the code is on line 1.
		expect(error?.markdownRange.start.line).toBe(1)
	})

	it("returns no diagnostics for clean text and exposes virtual files", async () => {
		const result = await checkDocument({
			cwd,
			markdownFile: "inline.md",
			text: ["```ts", "const n: number = 1", "```", ""].join("\n"),
			config: { include: ["**/*.md"] },
		})
		expect(result.diagnostics).toHaveLength(0)
		expect(result.virtualFiles).toHaveLength(1)
		expect(result.virtualFiles[0]?.content).toContain("const n: number = 1")
	})

	it("surfaces a document-rule diagnostic on a prose line outside any fence", async () => {
		const plugin = definePlugin({
			name: "docs",
			rules: {
				"no-todo": defineRule({
					meta: { scope: "document", defaultSeverity: "warn" },
					create(ctx) {
						ctx.text.split("\n").forEach((line, index) => {
							if (line.includes("TODO")) {
								const range = { start: { line: index, character: 0 }, end: { line: index, character: 4 } }
								ctx.report({ range, message: "Resolve this TODO." })
							}
						})
					},
				}),
			},
		})
		const result = await checkDocument({
			cwd,
			markdownFile: "inline.md",
			text: ["# Notes", "", "TODO: finish", "", "```ts", "const n: number = 1", "```", ""].join("\n"),
			config: { include: ["**/*.md"], plugins: [plugin] },
		})
		// The editor's own filter keeps it: it only drops generated fixture diagnostics.
		const shown = selectDiagnostics(result.diagnostics, { showGenerated: false })
		const todo = shown.find((d) => d.code === "docs/no-todo")
		expect(todo).toMatchObject({ severity: "warning", source: "kiira", markdownRange: { start: { line: 2 } } })
		expect(diagnosticCodeLabel(todo?.code)).toBe("docs/no-todo")
	})

	it("returns the text it read, so a quick fix can tell when a file changed since", async () => {
		const reader = defineRule({
			meta: { scope: "document", defaultSeverity: "warn" },
			create(ctx) {
				ctx.fs.readText("./good.md")
			},
		})
		const text = "# Unsaved\n"
		const result = await checkDocument({
			cwd,
			markdownFile: "inline.md",
			text,
			config: { include: ["**/*.md"], plugins: [definePlugin({ name: "t", rules: { reader } })] },
		})
		expect(result.sources).toEqual({
			"inline.md": text,
			"good.md": readFileSync(resolve(cwd, "good.md"), "utf8"),
		})
	})
})
