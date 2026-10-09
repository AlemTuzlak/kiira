// Proves that the plugin API can express each behavior of TanStack Intent's skill validator.
// Tests use minimal inline plugins and throwaway projects; nothing here is exported.
// Kiira does not parse YAML, so every frontmatter check works on `frontmatter.raw` as text.
import { execFileSync } from "node:child_process"
import { basename, dirname, posix, relative } from "node:path"
import ts from "typescript"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { check } from "../src/index"
import { definePlugin, defineRule } from "../src/plugin"
import { docWithFence, tempProject } from "../src/rules/test-helpers"
import type { KiiraConfig, KiiraDiagnostic, KiiraProject, KiiraTextEdit, SourcePosition } from "../src/types"

const tsconfig = (compilerOptions: Record<string, unknown> = {}) =>
	JSON.stringify({
		compilerOptions: {
			strict: true,
			lib: ["es2022"],
			types: [],
			moduleResolution: "Bundler",
			module: "ESNext",
			...compilerOptions,
		},
	})

const withTsconfig = (files: Record<string, string> = {}, compilerOptions?: Record<string, unknown>) =>
	tempProject({ "tsconfig.json": tsconfig(compilerOptions), ...files })

const run = (cwd: string, config: KiiraConfig) => check({ cwd, config: { engine: "classic", ...config } })

const codes = (diagnostics: KiiraDiagnostic[]) => diagnostics.map((d) => d.code)
const messages = (diagnostics: KiiraDiagnostic[]) => diagnostics.map((d) => d.message)

/** Apply edits the way `--fix` does, minus the safety checks: replace each range, last edit first. */
function applyEdits(text: string, edits: KiiraTextEdit[]): string {
	const lines = text.split("\n")
	const offset = ({ line, character }: SourcePosition) =>
		lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + character
	let out = text
	for (const edit of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) {
		out = out.slice(0, offset(edit.range.start)) + edit.newText + out.slice(offset(edit.range.end))
	}
	return out
}

const skillDoc = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# Skill\n`

/** A document rule that validates a skill's frontmatter from its raw text. */
const skillFrontmatter = defineRule({
	meta: { scope: "document", defaultSeverity: "error" },
	create(ctx) {
		const block = ctx.frontmatter
		const start = { line: 0, character: 0 }
		const range = block?.range ?? { start, end: start }
		const say = (message: string) => ctx.report({ range, message })
		if (!block) {
			say("missing frontmatter block")
			return
		}
		const lines = block.raw.split(/\r?\n/)
		if (!lines.every((line) => line.trim() === "" || /^(\s|#|[A-Za-z][\w-]*:)/.test(line))) {
			say("frontmatter is not a map")
			return
		}
		const scalar = (key: string) => new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(block.raw)?.[1]
		const name = scalar("name")
		if (!name) {
			say("`name` is required")
		} else {
			if (name.length > 64) say("`name` is longer than 64 characters")
			if (name.includes("/")) say("`name` must not contain `/`")
			if (name !== basename(dirname(ctx.file))) say("`name` must equal the parent folder")
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) say("`name` must be lowercase words joined by hyphens")
		}
		const description = scalar("description")
		if (!description) say("`description` is required")
		else if (description.length > 1024) say("`description` is longer than 1024 characters")
		const spec = new Set([
			"name",
			"description",
			"license",
			"compatibility",
			"metadata",
			"allowed-tools",
			"type",
			"requires",
		])
		for (const [, key] of block.raw.matchAll(/^([A-Za-z][\w-]*):/gm)) {
			if (key && !spec.has(key)) say(`\`${key}\` is not a spec key`)
		}
		if (scalar("type") === "framework" && scalar("requires") === undefined) say("`type: framework` requires `requires`")
	},
})

describe("Intent skill validation with the plugin API", () => {
	// A git hook (the pre-commit test run) exports GIT_INDEX_FILE and friends, which would point the
	// git commands in these tests, and `isTracked`, at the outer repository instead of the temp one.
	beforeEach(() => {
		for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) {
			vi.stubEnv(name, undefined)
		}
	})
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("discovery: preset include(project) + allowEmpty", async () => {
		const discovery = {
			name: "intent",
			// The workspace root checks `skills/` plus each package's; otherwise just the package's own.
			include: (project: KiiraProject) => [
				"skills/**/SKILL.md",
				...project.workspacePackages.map(
					(pkg) => `${relative(project.cwd, pkg.dir).replaceAll("\\", "/")}/skills/**/SKILL.md`
				),
			],
			allowEmpty: true,
		}
		const config = { presets: [discovery] }

		const workspace = withTsconfig({
			"package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
			"packages/p/package.json": JSON.stringify({ name: "p" }),
			"skills/a/SKILL.md": "# a\n",
			"skills/a/nested/deeper/SKILL.md": "# nested\n",
			"packages/p/skills/b/SKILL.md": "# b\n",
			"README.md": "# not a skill\n",
		})
		const found = await run(workspace, config)
		expect(Object.keys(found.sources).sort()).toEqual([
			"packages/p/skills/b/SKILL.md",
			"skills/a/SKILL.md",
			"skills/a/nested/deeper/SKILL.md",
		])

		const single = withTsconfig({ "package.json": JSON.stringify({ name: "solo" }), "skills/x/SKILL.md": "# x\n" })
		expect(Object.keys((await run(single, config)).sources)).toEqual(["skills/x/SKILL.md"])

		// Nothing found is a skipped run with no errors, so the exit code is 0.
		const empty = await run(withTsconfig({ "package.json": JSON.stringify({ name: "none" }) }), config)
		expect(empty).toMatchObject({ skipped: true, diagnostics: [], stats: { errors: 0 } })
	})

	it("frontmatter errors: document rule + frontmatter.raw", async () => {
		const docs = {
			"skills/missing/SKILL.md": "# no block\n",
			"skills/not-map/SKILL.md": skillDoc("- just\n- a list"),
			"skills/no-name/SKILL.md": skillDoc("description: d"),
			"skills/wrong-folder/SKILL.md": skillDoc("name: other\ndescription: d"),
			"skills/Bad_Name/SKILL.md": skillDoc("name: Bad_Name\ndescription: d"),
			"skills/slash/SKILL.md": skillDoc("name: a/b\ndescription: d"),
			"skills/long/SKILL.md": skillDoc(`name: long\ndescription: ${"d".repeat(1025)}`),
			"skills/extra/SKILL.md": skillDoc("name: extra\ndescription: d\nauthor: me"),
			"skills/framework/SKILL.md": skillDoc("name: framework\ndescription: d\ntype: framework"),
			"skills/ok/SKILL.md": skillDoc("name: ok\ndescription: d\nmetadata:\n  author: me"),
		}
		const { diagnostics } = await run(withTsconfig(docs), {
			include: ["skills/**/SKILL.md"],
			plugins: [definePlugin({ name: "intent", rules: { frontmatter: skillFrontmatter } })],
		})
		const by = (folder: string) => messages(diagnostics.filter((d) => d.markdownFile === `skills/${folder}/SKILL.md`))

		expect(by("missing")).toEqual(["missing frontmatter block"])
		expect(by("not-map")).toEqual(["frontmatter is not a map"])
		expect(by("no-name")).toEqual(["`name` is required"])
		expect(by("wrong-folder")).toEqual(["`name` must equal the parent folder"])
		expect(by("Bad_Name")).toEqual(["`name` must be lowercase words joined by hyphens"])
		expect(by("slash")).toContain("`name` must not contain `/`")
		expect(by("long")).toEqual(["`description` is longer than 1024 characters"])
		expect(by("extra")).toEqual(["`author` is not a spec key"])
		expect(by("framework")).toEqual(["`type: framework` requires `requires`"])
		expect(by("ok")).toEqual([])
		expect(new Set(diagnostics.map((d) => d.code))).toEqual(new Set(["intent/frontmatter"]))
	})

	it("spec warnings: document rule at warn severity", async () => {
		const warnings = defineRule({
			meta: { scope: "document", defaultSeverity: "warn" },
			create(ctx) {
				const raw = ctx.frontmatter?.raw ?? ""
				const compatibility = /^compatibility:[ \t]*(.*)$/m.exec(raw)?.[1]
				if (compatibility !== undefined && compatibility.length > 500) {
					ctx.report({
						range: ctx.frontmatter?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						message: "`compatibility` is longer than 500 characters",
					})
				}
				// `allowed-tools` must be a string; a list is a type error.
				if (/^allowed-tools:[ \t]*$/m.test(raw) && /^[ \t]*-/m.test(raw)) {
					ctx.report({
						range: ctx.frontmatter?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						message: "`allowed-tools` must be a string",
					})
				}
			},
		})
		const docs = {
			"docs/a.md": skillDoc(`compatibility: ${"c".repeat(501)}`),
			"docs/b.md": skillDoc("allowed-tools:\n  - Read"),
			"docs/c.md": skillDoc("license: MIT"),
		}
		const { diagnostics, stats } = await run(withTsconfig(docs), {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { "spec-warnings": warnings } })],
		})

		expect(diagnostics.map((d) => [d.markdownFile, d.severity])).toEqual([
			["docs/a.md", "warning"],
			["docs/b.md", "warning"],
		])
		expect(stats).toMatchObject({ errors: 0, warnings: 2 })
	})

	it("500-line limit: document rule", async () => {
		const maxLines = defineRule({
			meta: {
				scope: "document",
				defaultSeverity: "error",
				options: { default: { max: 500 } },
			},
			create(ctx) {
				const count = ctx.text.split("\n").length - (ctx.text.endsWith("\n") ? 1 : 0)
				if (count > ctx.options.max) {
					const line = ctx.options.max
					ctx.report({
						range: { start: { line, character: 0 }, end: { line, character: 0 } },
						message: `${count} lines; the limit is ${ctx.options.max}`,
					})
				}
			},
		})
		const lines = (n: number) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join("\n")}\n`
		const { diagnostics } = await run(withTsconfig({ "docs/ok.md": lines(500), "docs/long.md": lines(501) }), {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { "max-lines": maxLines } })],
		})

		expect(diagnostics).toMatchObject([
			{ markdownFile: "docs/long.md", message: "501 lines; the limit is 500", markdownRange: { start: { line: 500 } } },
		])
	})

	it("fence languages: preset and override codeFenceLanguages", async () => {
		const wrong = (lang: string) =>
			lang.startsWith("j") ? `/** @type {number} */\nexport const x = "a"` : 'export const x: number = "a"'
		const tags = ["ts", "tsx", "typescript", "js", "jsx", "javascript"]
		const doc = [...tags, "mjs", "python"].map((tag) => `\`\`\`${tag}\n${wrong(tag)}\n\`\`\`\n`).join("\n")
		const cwd = withTsconfig({ "docs/all.md": doc, "docs/only-ts.md": doc }, { allowJs: true, checkJs: true })
		const intent = { name: "intent", codeFenceLanguages: tags }

		const result = await run(cwd, { include: ["docs/*.md"], presets: [intent] })
		// `mjs` is a default fence identifier but not in Intent's set; `python` was never one.
		expect(result.snippets.filter((s) => s.markdownFile === "docs/all.md").map((s) => s.lang)).toEqual([
			"ts",
			"tsx",
			"ts",
			"js",
			"jsx",
			"js",
		])
		// JS fences are checked too (checkJs), so every recognized fence reports TS2322.
		expect(codes(result.diagnostics.filter((d) => d.markdownFile === "docs/all.md"))).toEqual(Array(6).fill(2322))

		const narrowed = await run(cwd, {
			include: ["docs/*.md"],
			presets: [intent],
			overrides: [{ include: ["docs/only-ts.md"], codeFenceLanguages: ["ts"] }],
		})
		expect(narrowed.snippets.filter((s) => s.markdownFile === "docs/only-ts.md")).toHaveLength(1)
		expect(narrowed.snippets.filter((s) => s.markdownFile === "docs/all.md")).toHaveLength(6)
	})

	it("fixed compiler options ignoring the tsconfig: TS hook replaceTsconfig + compilerOptions", async () => {
		const files = { "docs/a.md": docWithFence("ts", "export function f(x) {\n\treturn x\n}") }
		const plugin = (replace: boolean) =>
			definePlugin({
				name: "intent",
				typescript: () =>
					replace
						? { replaceTsconfig: true, compilerOptions: { lib: ["es2022"], types: [], strict: false } }
						: undefined,
			})

		const strict = await run(withTsconfig(files), { include: ["docs/*.md"], plugins: [plugin(false)] })
		expect(codes(strict.diagnostics)).toContain(7006)

		const fixed = await run(withTsconfig(files), { include: ["docs/*.md"], plugins: [plugin(true)] })
		expect(fixed.diagnostics).toEqual([])
	})

	it("no type entry: project rule + project.isTracked", async () => {
		const noTypeEntry = defineRule({
			meta: { scope: "project", defaultSeverity: "error", options: { default: { library: "my-lib" } } },
			create(ctx) {
				const pkg = ctx.project.packageJson
				// Only a git-tracked package.json counts as the package that owns the library.
				if (pkg?.name !== ctx.options.library || !ctx.project.isTracked("package.json")) return
				if (pkg.types === undefined && pkg.typings === undefined && pkg.exports === undefined) {
					ctx.report({
						file: "package.json",
						message: `no type entry found for ${ctx.options.library} in ${ctx.project.cwd}`,
					})
				}
			},
		})
		const cwd = withTsconfig({ "package.json": JSON.stringify({ name: "my-lib" }), "docs/a.md": "# a\n" })
		const config = {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { "type-entry": noTypeEntry } })],
		}

		expect((await run(cwd, config)).diagnostics).toEqual([])

		execFileSync("git", ["init", "-q"], { cwd })
		execFileSync("git", ["add", "package.json"], { cwd })
		const { diagnostics } = await run(cwd, config)
		expect(diagnostics).toMatchObject([
			{ code: "intent/type-entry", markdownFile: "package.json", message: `no type entry found for my-lib in ${cwd}` },
		])
	})

	it("library self-mapping and workspace package paths: TS hook paths + project.isTracked", async () => {
		const selfMap = definePlugin({
			name: "intent",
			typescript: (_file, ctx) => {
				const paths: Record<string, string[]> = {}
				const name = ctx.project.packageJson?.name
				// The first git-tracked entry wins, so a build output that is not committed is skipped.
				const entry = ["dist/index.d.ts", "src/index.ts"].find((candidate) => ctx.project.isTracked(candidate))
				if (typeof name === "string" && entry) paths[name] = [`./${entry}`]
				for (const pkg of ctx.project.workspacePackages) {
					paths[pkg.name] = [`./${relative(ctx.project.cwd, pkg.dir).replaceAll("\\", "/")}/src/index.ts`]
				}
				return { paths }
			},
		})
		const fence = 'import { hello } from "my-lib"\nimport { other } from "other"\nexport const both = [hello, other]'
		const cwd = withTsconfig({
			"package.json": JSON.stringify({ name: "my-lib", workspaces: ["packages/*"] }),
			"src/index.ts": "export const hello = 1\n",
			"packages/other/package.json": JSON.stringify({ name: "other" }),
			"packages/other/src/index.ts": "export const other = 2\n",
			"docs/a.md": docWithFence("ts", fence),
		})
		execFileSync("git", ["init", "-q"], { cwd })
		execFileSync("git", ["add", "src/index.ts"], { cwd })

		const without = await run(cwd, { include: ["docs/*.md"] })
		expect(codes(without.diagnostics)).toContain(2307)

		const mapped = await run(cwd, { include: ["docs/*.md"], plugins: [selfMap] })
		expect(mapped.diagnostics).toEqual([])
	})

	it("ignored TS codes, and TS2307/2792 only for library specifiers: TS hook filterDiagnostic", async () => {
		const ignored = new Set([
			1375, 2304, 2318, 2503, 2552, 2580, 2581, 2582, 2583, 2584, 2591, 2592, 2593, 2602, 2686, 2688, 7006, 7026, 7031,
			17004, 18004,
		])
		const plugin = definePlugin({
			name: "intent",
			typescript: () => ({
				filterDiagnostic: (diagnostic) => {
					const code = diagnostic.code
					if (typeof code !== "number") return true
					if (code === 2307 || code === 2792) return !/'my-lib(\/[^']*)?'/.test(diagnostic.message)
					return !ignored.has(code)
				},
			}),
		})
		const fence = [
			'import { a } from "my-lib/sub"',
			'import { b } from "other-lib"',
			"missing()",
			"export function f(x) {",
			"\treturn [a, b, x]",
			"}",
		].join("\n")
		const cwd = withTsconfig({ "docs/a.md": docWithFence("ts", fence) })

		const all = await run(cwd, { include: ["docs/*.md"] })
		expect(codes(all.diagnostics).sort()).toEqual([2304, 2307, 2307, 7006])

		const filtered = await run(cwd, { include: ["docs/*.md"], plugins: [plugin] })
		expect(codes(filtered.diagnostics)).toEqual([2307])
		expect(filtered.diagnostics[0]?.message).toContain("other-lib")
	})

	it("@deprecated named imports from the library: program rule", async () => {
		const deprecatedImport = defineRule({
			meta: { scope: "program", defaultSeverity: "warn", options: { default: { packages: ["my-lib"] } } },
			create(ctx) {
				for (const virtualFile of ctx.virtualFiles) {
					const sourceFile = ctx.program.getSourceFile(virtualFile.fileName)
					if (!sourceFile) continue
					for (const statement of sourceFile.statements) {
						if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
						if (!ctx.options.packages.includes(statement.moduleSpecifier.text)) continue
						const bindings = statement.importClause?.namedBindings
						if (!bindings || !ts.isNamedImports(bindings)) continue
						for (const element of bindings.elements) {
							const symbol = ctx.checker.getSymbolAtLocation(element.name)
							const target = symbol && ctx.checker.getAliasedSymbol(symbol)
							if (!target?.getJsDocTags().some((tag) => tag.name === "deprecated")) continue
							const range = ctx.toMarkdownRange(virtualFile, element.getStart(sourceFile), element.getEnd())
							if (range) ctx.report({ range, message: `\`${element.name.text}\` is deprecated` })
						}
					}
				}
			},
		})
		const cwd = withTsconfig({
			"node_modules/my-lib/package.json": JSON.stringify({ name: "my-lib", version: "1.0.0", types: "index.d.ts" }),
			"node_modules/my-lib/index.d.ts":
				"/** @deprecated use fresh */\nexport declare const old: number\nexport declare const fresh: number\n",
			"docs/a.md": docWithFence("ts", 'import { old, fresh } from "my-lib"\nexport const both = [old, fresh]'),
		})
		const { diagnostics } = await run(cwd, {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { "deprecated-import": deprecatedImport } })],
		})

		expect(diagnostics).toMatchObject([
			{
				code: "intent/deprecated-import",
				severity: "warning",
				message: "`old` is deprecated",
				markdownRange: { start: { line: 3, character: 9 }, end: { line: 3, character: 12 } },
			},
		])
	})

	it("inline relative links outside fences to a missing file: document rule", async () => {
		interface MdNode {
			type: string
			url?: string
			position?: { start: { line: number; column: number }; end: { line: number; column: number } }
			children?: MdNode[]
		}
		const brokenLink = defineRule({
			meta: { scope: "document", defaultSeverity: "error" },
			create(ctx) {
				const visit = (node: MdNode) => {
					// Fences are `code` nodes, so a link written inside one is never visited.
					if (node.type === "link" && node.url && node.position && !/^([a-z]+:|#|\/\/)/i.test(node.url)) {
						const target = posix.join(posix.dirname(ctx.file), node.url.split("#")[0] ?? "")
						if (!ctx.fs.exists(target)) {
							const { start, end } = node.position
							ctx.report({
								range: {
									start: { line: start.line - 1, character: start.column - 1 },
									end: { line: end.line - 1, character: end.column - 1 },
								},
								message: `${node.url} does not exist`,
							})
						}
					}
					for (const child of node.children ?? []) visit(child)
				}
				visit(ctx.mdast as unknown as MdNode)
			},
		})
		const text = [
			"# Links",
			"",
			"[missing](./nope.md) and [real](./real.md#top) and [web](https://example.com) and [anchor](#links).",
			"",
			"```md",
			"[inside a fence](./also-missing.md)",
			"```",
			"",
		].join("\n")
		const { diagnostics } = await run(withTsconfig({ "docs/a.md": text, "docs/real.md": "# Real\n" }), {
			include: ["docs/a.md"],
			plugins: [definePlugin({ name: "intent", rules: { "broken-link": brokenLink } })],
		})

		expect(diagnostics).toMatchObject([
			{
				message: "./nope.md does not exist",
				markdownRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 20 } },
			},
		])
	})

	it("skills/_artifacts required files and package.json warnings: project rule reporting on any file", async () => {
		const artifacts = defineRule({
			meta: {
				scope: "project",
				defaultSeverity: "error",
				options: { default: { files: ["domain_map.yaml", "skill_tree.yaml", "skill_spec.md"] } },
			},
			create(ctx) {
				for (const name of ctx.options.files) {
					const file = `skills/_artifacts/${name}`
					const text = ctx.fs.readText(file)
					if (text === undefined) ctx.report({ file, message: `${name} is missing` })
					else if (text.trim() === "") ctx.report({ file, message: `${name} is empty` })
					// A plugin that needs real YAML validation brings its own parser here.
					else if (name.endsWith(".yaml") && !/^[A-Za-z_][\w-]*:/m.test(text))
						ctx.report({ file, message: `${name} is not a map` })
				}
				if (ctx.project.packageJson?.description === undefined) {
					ctx.report({ file: "package.json", severity: "warning", message: "package.json has no description" })
				}
			},
		})
		const cwd = withTsconfig({
			"package.json": JSON.stringify({ name: "p" }),
			"skills/_artifacts/domain_map.yaml": "domains:\n  - a\n",
			"skills/_artifacts/skill_tree.yaml": "\n",
			"docs/a.md": "# a\n",
		})
		const { diagnostics, stats } = await run(cwd, {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { artifacts } })],
		})

		expect(diagnostics.map((d) => [d.markdownFile, d.severity, d.message])).toEqual([
			["skills/_artifacts/skill_tree.yaml", "error", "skill_tree.yaml is empty"],
			["skills/_artifacts/skill_spec.md", "error", "skill_spec.md is missing"],
			["package.json", "warning", "package.json has no description"],
		])
		expect(stats).toMatchObject({ errors: 2, warnings: 1 })
	})

	it("frontmatter repair: a document rule returns exact edits for LF and CRLF files", async () => {
		// Moves a non-spec `author:` key under `metadata:`. `--fix` applies these edits with the safe writer
		// (unchanged-file check, overlap refusal, CRLF kept, atomic write), which packages/cli/src/fix.test.ts
		// covers; here the edits are applied directly to show that the fix is exact.
		const repair = defineRule({
			meta: { scope: "document", defaultSeverity: "error" },
			create(ctx) {
				const block = ctx.frontmatter
				if (!block) return
				const lines = block.raw.split(/\r?\n/)
				const index = lines.findIndex((line) => line.startsWith("author:"))
				if (index === -1) return
				const line = block.range.start.line + 1 + index
				const range = { start: { line, character: 0 }, end: { line, character: lines[index]?.length ?? 0 } }
				ctx.report({
					range,
					message: "`author` belongs under `metadata`",
					fix: { kind: "edits", edits: [{ file: ctx.file, range, newText: `metadata:\n  ${lines[index]}` }] },
				})
			},
		})
		const config = { include: ["docs/*.md"], plugins: [definePlugin({ name: "intent", rules: { repair } })] }
		const editsFor = async (text: string) => {
			const { diagnostics } = await run(withTsconfig({ "docs/a.md": text }), config)
			const fix = diagnostics.find((d) => d.code === "intent/repair")?.fix
			return fix?.kind === "edits" ? fix.edits : []
		}
		const body = "# Skill\n"

		const lf = `---\nname: a\nauthor: me\n---\n\n${body}`
		expect(applyEdits(lf, await editsFor(lf))).toBe(`---\nname: a\nmetadata:\n  author: me\n---\n\n${body}`)

		// The edit stops before the line ending, so CRLF is untouched, and the writer turns the
		// `\n` in `newText` into `\r\n` in a CRLF file.
		const crlf = `---\r\nname: a\r\nauthor: me\r\n---\r\n\r\n${body}`
		const edits = await editsFor(crlf)
		expect(edits[0]?.range).toEqual({ start: { line: 2, character: 0 }, end: { line: 2, character: 10 } })
		expect(applyEdits(crlf, edits)).toBe(`---\r\nname: a\r\nmetadata:\n  author: me\r\n---\r\n\r\n${body}`)
	})

	it("--check: a fixable error still counts in stats.errors", async () => {
		const fixable = defineRule({
			meta: { scope: "document", defaultSeverity: "error" },
			create(ctx) {
				const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
				ctx.report({
					range,
					message: "pending fix",
					fix: { kind: "edits", edits: [{ file: ctx.file, range, newText: "#" }] },
				})
			},
		})
		const { diagnostics, stats } = await run(withTsconfig({ "docs/a.md": "x\n" }), {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { fixable } })],
		})

		// `kiira check` exits 1 when `stats.errors > 0`, whether or not `--fix` could repair it.
		expect(diagnostics).toMatchObject([{ severity: "error", fix: { kind: "edits" } }])
		expect(stats.errors).toBe(1)
	})

	it("repair --patch: the result has the text that was read and the edits a dry-run diff needs", async () => {
		const rename = defineRule({
			meta: { scope: "document", defaultSeverity: "warn" },
			create(ctx) {
				const block = ctx.frontmatter
				const at = /^title:/m.exec(block?.raw ?? "")
				if (!block || !at) return
				const line = block.range.start.line + 1 + (block.raw.slice(0, at.index).match(/\n/g)?.length ?? 0)
				const range = { start: { line, character: 0 }, end: { line, character: 5 } }
				ctx.report({
					range,
					message: "rename title to name",
					fix: { kind: "edits", edits: [{ file: ctx.file, range, newText: "name" }] },
				})
			},
		})
		const text = "---\ntitle: a\n---\n"
		const cwd = withTsconfig({ "docs/a.md": text })
		const { diagnostics, sources } = await run(cwd, {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { rename } })],
		})

		// The run read the file and holds the exact text, so the CLI can print the patch (`--fix --dry-run`)
		// without touching disk. Its diff output is covered in packages/cli/src/commands/check.test.ts.
		const edits = diagnostics[0]?.fix?.kind === "edits" ? diagnostics[0].fix.edits : []
		expect(sources["docs/a.md"]).toBe(text)
		expect(applyEdits(text, edits)).toBe("---\nname: a\n---\n")
	})

	it("BEFORE/AFTER split into separate fences: document rule edits fix", async () => {
		const split = defineRule({
			meta: { scope: "document", defaultSeverity: "warn" },
			create(ctx) {
				for (const snippet of ctx.snippets) {
					const lines = snippet.code.split("\n")
					const before = lines.findIndex((line) => line.trim() === "// BEFORE")
					const after = lines.findIndex((line) => line.trim() === "// AFTER")
					if (before === -1 || after < before) continue
					const first = lines
						.slice(before + 1, after)
						.join("\n")
						.trim()
					const second = lines
						.slice(after + 1)
						.join("\n")
						.trim()
					const fence = (code: string) => `\`\`\`${snippet.lang}\n${code}\n\`\`\``
					ctx.report({
						range: snippet.markdownRange,
						message: "Split BEFORE and AFTER into separate fences",
						fix: {
							kind: "edits",
							edits: [{ file: ctx.file, range: snippet.markdownRange, newText: `${fence(first)}\n\n${fence(second)}` }],
						},
					})
				}
			},
		})
		const text = docWithFence("ts", "// BEFORE\nexport const a: number = 1\n// AFTER\nexport const a: string = 'one'")
		const config = { include: ["docs/*.md"], plugins: [definePlugin({ name: "intent", rules: { split } })] }
		const { diagnostics } = await run(withTsconfig({ "docs/a.md": text }), config)

		const fix = diagnostics.find((d) => d.code === "intent/split")?.fix
		const fixed = applyEdits(text, fix?.kind === "edits" ? fix.edits : [])
		expect(fixed).toBe(
			"# Title\n\n```ts\nexport const a: number = 1\n```\n\n```ts\nexport const a: string = 'one'\n```\n"
		)

		const again = await run(withTsconfig({ "docs/a.md": fixed }), config)
		expect(again.snippets).toHaveLength(2)
		expect(again.diagnostics).toEqual([])
	})

	it("--github-summary: a plugin diagnostic has the file, line, message, and counts the step summary uses", async () => {
		const flag = defineRule({
			meta: { scope: "document", defaultSeverity: "error" },
			create(ctx) {
				const start = { line: 2, character: 0 }
				ctx.report({ range: { start, end: { line: 2, character: 3 } }, message: "flagged" })
			},
		})
		const { diagnostics, stats } = await run(withTsconfig({ "docs/a.md": "# a\n\nbad\n" }), {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { flag } })],
		})

		// The summary lists each error as `file:line` and its message, and counts files, snippets and errors.
		// Plugin diagnostics carry exactly those fields; the markdown itself is covered by the
		// "runCheck GitHub step summary" tests in packages/cli/src/commands/check.test.ts.
		expect(diagnostics).toMatchObject([
			{
				code: "intent/flag",
				severity: "error",
				markdownFile: "docs/a.md",
				markdownRange: { start: { line: 2 } },
				message: "flagged",
			},
		])
		expect(stats).toMatchObject({ markdownFiles: 1, errors: 1 })
	})

	it("--set-version: rule option + edits fix", async () => {
		const setVersion = defineRule({
			meta: { scope: "project", defaultSeverity: "error", options: { default: { version: "1.0.0" } } },
			create(ctx) {
				const text = ctx.fs.readText("package.json")
				const line = text?.split("\n").findIndex((l) => /^\s*"version":/.test(l)) ?? -1
				if (!text || line === -1) return
				const source = text.split("\n")[line] ?? ""
				const match = /"version":\s*"([^"]*)"/.exec(source)
				if (!match || match[1] === ctx.options.version) return
				const character = match.index + match[0].lastIndexOf(match[1] ?? "")
				const range = { start: { line, character }, end: { line, character: character + (match[1]?.length ?? 0) } }
				ctx.report({
					file: "package.json",
					range,
					message: `version is ${match[1]}, expected ${ctx.options.version}`,
					fix: { kind: "edits", edits: [{ file: "package.json", range, newText: ctx.options.version }] },
				})
			},
		})
		const text = '{\n\t"name": "p",\n\t"version": "0.9.0"\n}\n'
		const { diagnostics } = await run(withTsconfig({ "package.json": text, "docs/a.md": "# a\n" }), {
			include: ["docs/*.md"],
			plugins: [definePlugin({ name: "intent", rules: { "set-version": setVersion } })],
			rules: { "intent/set-version": ["error", { version: "1.2.3" }] },
		})

		const fix = diagnostics[0]?.fix
		expect(diagnostics[0]).toMatchObject({ markdownFile: "package.json", message: "version is 0.9.0, expected 1.2.3" })
		expect(applyEdits(text, fix?.kind === "edits" ? fix.edits : [])).toBe(
			'{\n\t"name": "p",\n\t"version": "1.2.3"\n}\n'
		)
	})
})
