import { execFileSync } from "node:child_process"
import { mkdirSync, realpathSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles, checkMarkdownText } from "../check"
import { resolveConfig } from "../config"
import { classicEngine } from "../engine"
import { defineRule } from "../plugin"
import { definePlugin } from "../plugin"
import type {
	KiiraConfig,
	KiiraDiagnostic,
	KiiraProject,
	RuleDocumentContext,
	RuleProgramContext,
	RuleProjectContext,
	VirtualFile,
} from "../types"
import { createProject, createRuleFs, programRulesSkipped } from "./run"
import { FENCE_TAGS, docWithFence, tempProject } from "./test-helpers"

const here = dirname(fileURLToPath(import.meta.url))

/** A plugin with one rule; `create` receives the scope's context type from `scope`. */
function pluginWith<TScope extends "document" | "program" | "project">(
	scope: TScope,
	create: Parameters<typeof defineRule<TScope>>[0]["create"],
	name = "t",
	defaultSeverity: "off" | "warn" | "error" = "warn"
) {
	return definePlugin({ name, rules: { r: defineRule({ meta: { scope, defaultSeverity }, create }) } })
}

const noChecking: KiiraConfig = { defaultValidate: "none", engine: "classic" }

describe("document rules", () => {
	it("hand each rule the document, its TypeScript diagnostics, options, and level", async () => {
		const seen: RuleDocumentContext[] = []
		const plugin = definePlugin({
			name: "t",
			rules: {
				r: defineRule({
					meta: { scope: "document", defaultSeverity: "warn", options: { default: { mode: "x" } } },
					create(ctx) {
						seen.push(ctx)
					},
				}),
			},
		})
		const cwd = tempProject({ "data.txt": "hello" })
		const text = ["# Title", "", "```ts", 'const n: number = "x"', "```", ""].join("\n")
		await checkMarkdownText({
			cwd,
			markdownFile: "docs/doc.md",
			text,
			config: { plugins: [plugin], engine: "classic", rules: { "t/r": "error" } },
		})

		const [ctx] = seen
		expect(seen).toHaveLength(1)
		expect(ctx?.file).toBe("docs/doc.md")
		expect(ctx?.text).toBe(text)
		expect(ctx?.severity).toBe("error")
		expect(ctx?.options).toEqual({ mode: "x" })
		expect(ctx?.parseError).toBeUndefined()
		expect(ctx?.mdast.children.map((n) => n.type)).toEqual(["heading", "code"])
		expect(ctx?.snippets.map((s) => s.code)).toEqual(['const n: number = "x"'])
		expect(ctx?.diagnostics.map((d) => d.code)).toEqual([2322])
		expect(ctx?.project.cwd).toBe(cwd)
		expect(ctx?.fs.readText("data.txt")).toBe("hello")
		expect(ctx?.fs.exists("missing.txt")).toBe(false)
		expect(ctx?.config.ruleRegistry["t/r"]).toBeDefined()
	})

	it("see an empty tree and a parseError when the document fails to parse", async () => {
		const seen: RuleDocumentContext[] = []
		const plugin = pluginWith("document", (ctx) => {
			seen.push(ctx)
		})
		await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "broken.mdx",
			text: ["<Callout>", "", "no closing tag"].join("\n"),
			config: { plugins: [plugin], engine: "classic" },
		})
		expect(seen[0]?.mdast.children).toEqual([])
		expect(seen[0]?.parseError?.message).toEqual(expect.any(String))
		expect(seen[0]?.parseError?.position.line).toBeGreaterThanOrEqual(0)
	})

	it("report with the rule id as code, the configured level as severity, and an optional fix", async () => {
		const plugin = pluginWith("document", (ctx) => {
			const at = { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } }
			ctx.report({ range: at, message: "default level" })
			ctx.report({ range: at, message: "forced", severity: "info" })
			ctx.report({
				range: at,
				message: "with fix",
				fix: { kind: "fence-meta", line: 0, append: "group=a" },
			})
		})
		const run = (level: "warn" | "error") =>
			checkMarkdownText({
				cwd: tempProject(),
				markdownFile: "doc.md",
				text: "prose line\n",
				config: { plugins: [plugin], rules: { "t/r": level } },
			})

		const { diagnostics } = await run("warn")
		expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
			["warning", "default level"],
			["info", "forced"],
			["warning", "with fix"],
		])
		expect(diagnostics[0]).toMatchObject({
			source: "kiira",
			code: "t/r",
			markdownFile: "doc.md",
			markdownRange: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } },
		})
		expect(diagnostics[0]).not.toHaveProperty("fix")
		expect(diagnostics[2]?.fix).toEqual({ kind: "fence-meta", line: 0, append: "group=a" })
		expect((await run("error")).diagnostics[0]?.severity).toBe("error")
	})

	it("do not run when the rule is off, and runs per file level through overrides", async () => {
		let runs = 0
		const plugin = pluginWith("document", () => {
			runs += 1
		})
		const config: KiiraConfig = { ...noChecking, plugins: [plugin], rules: { "t/r": "off" } }
		await checkMarkdownText({ cwd: tempProject(), markdownFile: "a.md", text: "x", config })
		expect(runs).toBe(0)

		const overridden = { ...config, overrides: [{ include: ["b.md"], rules: { "t/r": "warn" as const } }] }
		await checkMarkdownText({ cwd: tempProject(), markdownFile: "a.md", text: "x", config: overridden })
		expect(runs).toBe(0)
		await checkMarkdownText({ cwd: tempProject(), markdownFile: "b.md", text: "x", config: overridden })
		expect(runs).toBe(1)
	})

	it("run built-in rules first, then plugin rules in registration order", async () => {
		const order: string[] = []
		const first = pluginWith("document", () => void order.push("first"), "first")
		const second = pluginWith("document", () => void order.push("second"), "second")
		const { diagnostics } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: ["```ts validate=bad", "const a = 1", "```"].join("\n"),
			config: { plugins: [first, second], ...noChecking, defaultValidate: "type" },
		})
		expect(order).toEqual(["first", "second"])
		expect(diagnostics.map((d) => d.code)).toEqual(["fence-meta"])
	})

	it("never let a report raise the configured level, only lower it", async () => {
		const plugin = pluginWith("document", (ctx) => {
			const at = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
			for (const severity of ["error", "warning", "info"] as const) {
				ctx.report({ range: at, message: severity, severity })
			}
		})
		const severities = async (level: "warn" | "error") =>
			(
				await checkMarkdownText({
					cwd: tempProject(),
					markdownFile: "doc.md",
					text: "x",
					config: { ...noChecking, plugins: [plugin], rules: { "t/r": level } },
				})
			).diagnostics.map((d) => d.severity)
		expect(await severities("warn")).toEqual(["warning", "warning", "info"])
		expect(await severities("error")).toEqual(["error", "warning", "info"])
	})

	it("report a rule that throws as an error on the file and keep running the other rules", async () => {
		const failing = pluginWith("document", (ctx) => {
			ctx.report({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, message: "before" })
			throw new Error("boom")
		})
		const healthy = pluginWith(
			"document",
			(ctx) =>
				ctx.report({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, message: "ok" }),
			"u"
		)
		const { diagnostics } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: "x",
			config: { ...noChecking, plugins: [failing, healthy] },
		})
		expect(diagnostics.map((d) => [d.code, d.severity, d.message, d.markdownFile])).toEqual([
			["t/r", "warning", "before", "doc.md"],
			["t/r", "error", 'Rule "t/r" failed on doc.md: boom', "doc.md"],
			["u/r", "warning", "ok", "doc.md"],
		])
	})

	it.each(FENCE_TAGS)("see %s fences as normalized snippets, and report ranges land where given", async (tag, lang) => {
		const plugin = pluginWith("document", (ctx) => {
			for (const snippet of ctx.snippets) {
				ctx.report({ range: snippet.markdownRange, message: `saw ${snippet.lang}` })
				ctx.report({
					range: { start: snippet.codeStart, end: { line: snippet.codeStart.line, character: 5 } },
					message: "code start",
				})
			}
		})
		const { diagnostics } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: docWithFence(tag, "const a = 1"),
			config: { ...noChecking, plugins: [plugin] },
		})
		expect(diagnostics.map((d) => [d.message, d.markdownRange])).toEqual([
			[`saw ${lang}`, { start: { line: 2, character: 0 }, end: { line: 4, character: 3 } }],
			["code start", { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } }],
		])
	})
})

describe("fence languages from presets and overrides", () => {
	// The set Intent documents use: no `mjs`, `cjs`, `typescriptreact`, or `javascriptreact`.
	const INTENT = ["ts", "tsx", "typescript", "js", "jsx", "javascript"]
	const text = (tag: string) => docWithFence(tag, "const a = 1")

	it.each(FENCE_TAGS)("a preset narrows recognition for %s", async (tag, lang) => {
		const { snippets } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: text(tag),
			config: { ...noChecking, presets: [{ name: "intent", codeFenceLanguages: INTENT }] },
		})
		expect(snippets.map((s) => s.lang)).toEqual(INTENT.includes(tag) ? [lang] : [])
	})

	it.each(FENCE_TAGS)("an override narrows recognition for %s in matching files only", async (tag, lang) => {
		const config: KiiraConfig = {
			...noChecking,
			overrides: [{ include: ["intent/**"], codeFenceLanguages: INTENT }],
		}
		const inside = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "intent/doc.md",
			text: text(tag),
			config,
		})
		const outside = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "other/doc.md",
			text: text(tag),
			config,
		})
		expect(inside.snippets.map((s) => s.lang)).toEqual(INTENT.includes(tag) ? [lang] : [])
		expect(outside.snippets.map((s) => s.lang)).toEqual([lang])
	})

	it("an explicit markdown.codeFenceLanguages beats a preset", async () => {
		const { snippets } = await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: text("mjs"),
			config: {
				...noChecking,
				markdown: { codeFenceLanguages: ["mjs"] },
				presets: [{ name: "intent", codeFenceLanguages: INTENT }],
			},
		})
		expect(snippets.map((s) => s.lang)).toEqual(["js"])
	})
})

describe("program rules", () => {
	const reportsTypeErrors = pluginWith("program", (ctx: RuleProgramContext) => {
		for (const vf of ctx.virtualFiles) {
			const sourceFile = ctx.program.getSourceFile(vf.fileName)
			for (const d of sourceFile ? ctx.program.getSemanticDiagnostics(sourceFile) : []) {
				const range = d.start === undefined ? undefined : ctx.toMarkdownRange(vf, d.start, d.start + (d.length ?? 0))
				if (range && d.code === 2322) {
					ctx.report({ range, message: `program saw ${vf.lang}` })
				}
			}
		}
	})

	it.each(FENCE_TAGS)(
		"see %s virtual files, their checkJs diagnostics, and map offsets to Markdown",
		async (tag, lang) => {
			const isJs = lang === "js" || lang === "jsx"
			const code = isJs ? '/** @type {number} */\nconst n = "x"' : 'const n: number = "x"'
			const { diagnostics } = await checkMarkdownText({
				cwd: tempProject(),
				markdownFile: "doc.md",
				text: docWithFence(tag, code),
				config: { engine: "classic", plugins: [reportsTypeErrors] },
			})
			const seen = diagnostics.find((d) => d.code === "t/r")
			const typescript = diagnostics.find((d) => d.code === 2322)
			// The fence opens on line 2, so code starts on line 3; the JSDoc form puts `const` one line later.
			const line = isJs ? 4 : 3
			expect(seen).toMatchObject({ message: `program saw ${lang}`, source: "kiira" })
			expect(seen?.markdownRange).toEqual({ start: { line, character: 6 }, end: { line, character: 7 } })
			expect(seen?.markdownRange).toEqual(typescript?.markdownRange)
		}
	)

	it("only keep each partition's program when a program rule is enabled", async () => {
		const collect = vi.spyOn(classicEngine, "collect")
		try {
			const check = (config: KiiraConfig) =>
				checkMarkdownText({
					cwd: tempProject(),
					markdownFile: "doc.md",
					text: docWithFence("ts", "const a = 1"),
					config,
				})
			await check({ engine: "classic" })
			expect(collect.mock.calls[0]?.[2]).toBeUndefined()
			await check({ engine: "classic", plugins: [reportsTypeErrors] })
			expect(collect.mock.calls[1]?.[2]).toBeTypeOf("function")
		} finally {
			collect.mockRestore()
		}
	})

	it("maps generated fixture code to undefined and snippet code to its Markdown range", async () => {
		const calls: Array<{ generated: unknown; snippet: unknown }> = []
		const plugin = pluginWith("program", (ctx: RuleProgramContext) => {
			const [vf] = ctx.virtualFiles as [VirtualFile]
			calls.push({
				generated: ctx.toMarkdownRange(vf, 0, 5),
				snippet: ctx.toMarkdownRange(vf, vf.content.indexOf("const b"), vf.content.indexOf("const b") + 5),
			})
		})
		await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "doc.md",
			text: docWithFence("ts", "const b = 1"),
			config: {
				engine: "classic",
				plugins: [plugin],
				defaultFixture: "setup",
				fixtures: { setup: { type: "prepend", content: "const generated = 1" } },
			},
		})
		expect(calls).toEqual([
			{
				generated: undefined,
				snippet: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } },
			},
		])
	})

	it("run once per document with only that document's virtual files", async () => {
		const files: string[][] = []
		const plugin = pluginWith("program", (ctx: RuleProgramContext) => {
			files.push([ctx.file, ...ctx.virtualFiles.map((vf) => vf.snippet.markdownFile)])
		})
		const cwd = tempProject({
			"a.md": docWithFence("ts", "const a = 1"),
			"b.md": `${docWithFence("js", "const b = 1")}\n${docWithFence("jsx", "const c = 1")}`,
			"empty.md": "no code here\n",
		})
		await checkMarkdownFiles({
			cwd,
			files: ["a.md", "b.md", "empty.md"],
			config: { engine: "classic", plugins: [plugin] },
		})
		expect(files).toEqual([
			["a.md", "a.md"],
			["b.md", "b.md", "b.md"],
		])
	})

	it("run for documents in override partitions", async () => {
		const files: string[] = []
		const plugin = pluginWith("program", (ctx: RuleProgramContext) => {
			files.push(ctx.file)
		})
		const cwd = tempProject({
			"a.md": docWithFence("ts", "const a = 1"),
			"b.md": docWithFence("ts", "const b = 1"),
		})
		await checkMarkdownFiles({
			cwd,
			files: ["a.md", "b.md"],
			config: { engine: "classic", plugins: [plugin], overrides: [{ include: ["b.md"], noImplicitAny: false }] },
		})
		expect(files).toEqual(["a.md", "b.md"])
	})
})

describe("program rules on the native engine", () => {
	const plugin = pluginWith("program", () => {})
	const resolved = resolveConfig({ plugins: [plugin] })

	it("emit one info diagnostic naming the skipped rules, at the start of the first file", () => {
		const diagnostic = programRulesSkipped(resolved, ["a.md", "b.md"])
		expect(diagnostic).toMatchObject({
			severity: "info",
			source: "kiira",
			code: "program-rules-skipped",
			markdownFile: "a.md",
			markdownRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
		})
		expect(diagnostic?.message).toContain("t/r")
	})

	it("emit nothing when no program rule is enabled", () => {
		expect(programRulesSkipped(resolveConfig({ plugins: [plugin], rules: { "t/r": "off" } }), ["a.md"])).toBeUndefined()
		expect(programRulesSkipped(resolveConfig({}), ["a.md"])).toBeUndefined()
		expect(programRulesSkipped(resolved, [])).toBeUndefined()
	})

	it("count a program rule enabled for any file", () => {
		const config = resolveConfig({
			plugins: [plugin],
			rules: { "t/r": "off" },
			overrides: [{ include: ["b.md"], rules: { "t/r": "warn" } }],
		})
		expect(programRulesSkipped(config, ["a.md"])).toBeUndefined()
		expect(programRulesSkipped(config, ["a.md", "b.md"])).toBeDefined()
	})

	it("skip program rules in a real native run and say so once", async () => {
		// Serve TypeScript 7 as the project's `typescript` so the native engine loads.
		const cwd = tempProject()
		mkdirSync(join(cwd, "node_modules"))
		symlinkSync(realpathSync(join(here, "../../node_modules/typescript-7")), join(cwd, "node_modules/typescript"))
		let ran = false
		const spy = pluginWith("program", () => {
			ran = true
		})
		const text = `${docWithFence("ts", "const a = 1")}\n${docWithFence("js", "const b = 1")}`
		const result = await checkMarkdownText({
			cwd,
			markdownFile: "doc.md",
			text,
			config: { engine: "native", plugins: [spy] },
		})
		expect(ran).toBe(false)
		const notices = result.diagnostics.filter((d) => d.code === "program-rules-skipped")
		expect(notices).toHaveLength(1)
		expect(notices[0]?.message).toContain("t/r")
	})
})

describe("project rules", () => {
	it("run once per run, over every document, and report on any file", async () => {
		const seen: RuleProjectContext[] = []
		const plugin = pluginWith(
			"project",
			(ctx: RuleProjectContext) => {
				seen.push(ctx)
				ctx.report({ file: "package.json", message: "missing field" })
				ctx.report({
					file: "src/index.ts",
					range: { start: { line: 4, character: 1 }, end: { line: 4, character: 9 } },
					message: "stale",
					severity: "info",
				})
				ctx.report({ file: "a.md", message: "in markdown" })
			},
			"t",
			"error"
		)
		const cwd = tempProject({
			"package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
			"a.md": docWithFence("ts", "const a = 1"),
			"b.md": docWithFence("js", "const b = 1"),
		})
		const result = await checkMarkdownFiles({
			cwd,
			files: ["a.md", "b.md"],
			config: { ...noChecking, plugins: [plugin] },
		})

		expect(seen).toHaveLength(1)
		expect(seen[0]?.files).toEqual(["a.md", "b.md"])
		expect(seen[0]?.severity).toBe("error")
		expect(seen[0]?.project.packageJson).toEqual({ name: "demo", version: "1.0.0" })
		expect(seen[0]?.fs.readText("package.json")).toContain("demo")

		const project = result.diagnostics.filter((d) => d.code === "t/r")
		expect(project.map((d) => [d.markdownFile, d.severity, d.message])).toEqual([
			["package.json", "error", "missing field"],
			["src/index.ts", "info", "stale"],
			["a.md", "error", "in markdown"],
		])
		expect(project[0]?.markdownRange).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } })
		expect(project[1]?.markdownRange).toEqual({ start: { line: 4, character: 1 }, end: { line: 4, character: 9 } })
		expect(result.stats).toMatchObject({ markdownFiles: 2, errors: 2 })
	})

	it("are not run for a single in-memory document", async () => {
		let ran = false
		const plugin = pluginWith("project", () => {
			ran = true
		})
		await checkMarkdownText({
			cwd: tempProject(),
			markdownFile: "a.md",
			text: "x",
			config: { ...noChecking, plugins: [plugin] },
		})
		expect(ran).toBe(false)
	})

	it("use the base level plus the CLI level, never per-file overrides", async () => {
		let runs = 0
		const plugin = pluginWith(
			"project",
			() => {
				runs += 1
			},
			"t",
			"off"
		)
		const cwd = tempProject({ "a.md": "x" })
		const config: KiiraConfig = {
			...noChecking,
			plugins: [plugin],
			overrides: [{ include: ["a.md"], rules: { "t/r": "warn" } }],
		}
		await checkMarkdownFiles({ cwd, files: ["a.md"], config })
		expect(runs).toBe(0)
		await checkMarkdownFiles({ cwd, files: ["a.md"], config, ruleOverrides: { "t/r": "error" } })
		expect(runs).toBe(1)
	})

	it("see the workspace's named packages", async () => {
		let project: KiiraProject | undefined
		const plugin = pluginWith("project", (ctx: RuleProjectContext) => {
			project = ctx.project
		})
		const cwd = tempProject({
			"pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
			"packages/one/package.json": JSON.stringify({ name: "one" }),
			"a.md": "x",
		})
		await checkMarkdownFiles({ cwd, files: ["a.md"], config: { ...noChecking, plugins: [plugin] } })
		expect(project?.workspacePackages).toEqual([{ name: "one", dir: join(cwd, "packages/one") }])
	})
})

describe("project and fs helpers", () => {
	it("createRuleFs resolves against cwd and records every text it reads", () => {
		const cwd = tempProject({ "a.txt": "A" })
		const { fs, reads } = createRuleFs(cwd)
		expect(fs.exists("a.txt")).toBe(true)
		expect(fs.readText("a.txt")).toBe("A")
		expect(fs.readText("nope.txt")).toBeUndefined()
		expect([...reads]).toEqual([
			["a.txt", "A"],
			["nope.txt", undefined],
		])
	})

	it("createProject reads package.json defensively", async () => {
		expect((await createProject(tempProject())).packageJson).toBeUndefined()
		expect((await createProject(tempProject({ "package.json": "{ not json" }))).packageJson).toBeUndefined()
		expect((await createProject(tempProject({ "package.json": "[1]" }))).packageJson).toBeUndefined()
	})

	// Inside a git hook these point at the outer repository; clear them so git in a temp dir sees only that dir.
	beforeEach(() => {
		for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) {
			vi.stubEnv(name, undefined)
		}
	})
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	const hasGit = (() => {
		try {
			execFileSync("git", ["--version"], { stdio: "ignore" })
			return true
		} catch {
			return false
		}
	})()

	it.skipIf(!hasGit)("isTracked is true for a tracked file and false for untracked or missing ones", async () => {
		// A git hook (the pre-commit test run) exports GIT_INDEX_FILE and friends, which
		// would point these commands at the outer repository instead of the temp one.
		for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) {
			vi.stubEnv(name, undefined)
		}
		onTestFinished(() => {
			vi.unstubAllEnvs()
		})
		const cwd = tempProject({ "tracked.txt": "t", "untracked.txt": "u" })
		execFileSync("git", ["init", "-q"], { cwd })
		execFileSync("git", ["add", "tracked.txt"], { cwd })
		const { isTracked } = await createProject(cwd)
		expect(isTracked("tracked.txt")).toBe(true)
		expect(isTracked("untracked.txt")).toBe(false)
		expect(isTracked("missing.txt")).toBe(false)
	})

	it.skipIf(!hasGit)("isTracked accepts absolute and ./-prefixed paths and rejects outside paths", async () => {
		const cwd = tempProject({ "tracked.txt": "t", "nested/deep.txt": "d" })
		execFileSync("git", ["init", "-q"], { cwd })
		execFileSync("git", ["add", "."], { cwd })
		const { isTracked } = await createProject(cwd)
		expect(isTracked(join(cwd, "tracked.txt"))).toBe(true)
		expect(isTracked("./nested/deep.txt")).toBe(true)
		expect(isTracked(join(cwd, "..", "elsewhere.txt"))).toBe(false)
		expect(isTracked("")).toBe(false)
	})

	it.skipIf(!hasGit)("isTracked accepts tracked filenames and directories starting with two dots", async () => {
		const cwd = tempProject({ "..tracked.txt": "t", "..nested/deep.txt": "d" })
		execFileSync("git", ["init", "-q"], { cwd })
		execFileSync("git", ["add", "."], { cwd })
		const { isTracked } = await createProject(cwd)
		expect(isTracked("..tracked.txt")).toBe(true)
		expect(isTracked("./..tracked.txt")).toBe(true)
		expect(isTracked(join(cwd, "..tracked.txt"))).toBe(true)
		expect(isTracked("..nested/deep.txt")).toBe(true)
		expect(isTracked("..")).toBe(false)
		expect(isTracked("../outside.txt")).toBe(false)
	})

	it.skipIf(!hasGit)("isTracked answers for repository paths outside cwd", async () => {
		const repo = tempProject({ "README.md": "r", "docs/guide.md": "g" })
		execFileSync("git", ["init", "-q"], { cwd: repo })
		execFileSync("git", ["add", "."], { cwd: repo })
		const { isTracked } = await createProject(join(repo, "docs"))
		expect(isTracked("guide.md")).toBe(true)
		expect(isTracked("../README.md")).toBe(true)
		expect(isTracked(join(repo, "README.md"))).toBe(true)
		expect(isTracked("../missing.md")).toBe(false)
		expect(isTracked("../../outside.md")).toBe(false)
	})

	it.skipIf(!hasGit)("isTracked is true for a directory or . holding a tracked file", async () => {
		const repo = tempProject({ "nested/deep/a.txt": "a", "loose/b.txt": "b", "docs/c.md": "c" })
		execFileSync("git", ["init", "-q"], { cwd: repo })
		execFileSync("git", ["add", "nested", "docs"], { cwd: repo })
		const { isTracked } = await createProject(repo)
		expect(isTracked(".")).toBe(true)
		expect(isTracked("nested")).toBe(true)
		expect(isTracked("nested/")).toBe(true)
		expect(isTracked("nested/deep")).toBe(true)
		expect(isTracked(join(repo, "nested"))).toBe(true)
		expect(isTracked("loose")).toBe(false)
		expect(isTracked("nest")).toBe(false)
		expect((await createProject(join(repo, "docs"))).isTracked("..")).toBe(true)
		expect((await createProject(join(repo, "loose"))).isTracked(".")).toBe(false)
	})

	it.skipIf(!hasGit)("isTracked is false for . in a repository with nothing tracked", async () => {
		const repo = tempProject({ "a.txt": "a" })
		execFileSync("git", ["init", "-q"], { cwd: repo })
		const { isTracked } = await createProject(repo)
		expect(isTracked(".")).toBe(false)
	})

	it.skipIf(!hasGit)("isTracked matches globs like git does", async () => {
		const repo = tempProject({ "docs/sub/a.md": "a", "b.txt": "b" })
		execFileSync("git", ["init", "-q"], { cwd: repo })
		execFileSync("git", ["add", "docs"], { cwd: repo })
		const { isTracked } = await createProject(repo)
		expect(isTracked("docs/*.md")).toBe(true)
		expect(isTracked("docs/sub/?.md")).toBe(true)
		expect(isTracked("docs/sub/[ab].md")).toBe(true)
		expect(isTracked("*.txt")).toBe(false)
	})

	it("isTracked is false outside a git repository", async () => {
		const { isTracked } = await createProject(tempProject({ "a.txt": "a" }))
		expect(isTracked("a.txt")).toBe(false)
	})
})

describe("allowEmpty and preset includes", () => {
	it("keeps the normal empty report by default", async () => {
		let ran = false
		const plugin = pluginWith("project", () => {
			ran = true
		})
		const result = await checkMarkdownFiles({ cwd: tempProject(), config: { plugins: [plugin] } })
		expect(result.skipped).toBeUndefined()
		expect(result.stats.markdownFiles).toBe(0)
		expect(ran).toBe(true)
	})

	it("skips the whole run when a preset allows an empty match", async () => {
		let ran = false
		const plugin = pluginWith("project", () => {
			ran = true
		})
		const result = await checkMarkdownFiles({
			cwd: tempProject(),
			config: { plugins: [plugin], presets: [{ name: "p", allowEmpty: true }] },
		})
		expect(result).toMatchObject({ skipped: true, diagnostics: [], stats: { markdownFiles: 0 } })
		expect(ran).toBe(false)
	})

	it("does not skip when files matched", async () => {
		const cwd = tempProject({ "a.md": "x" })
		const result = await checkMarkdownFiles({ cwd, config: { presets: [{ name: "p", allowEmpty: true }] } })
		expect(result.skipped).toBeUndefined()
		expect(result.stats.markdownFiles).toBe(1)
	})

	it("calls a function include with the project and unions it with the other includes", async () => {
		const cwd = tempProject({
			"package.json": JSON.stringify({ name: "demo" }),
			"docs/a.md": "x",
			"guide/b.md": "x",
			"other/c.md": "x",
		})
		const seen: string[] = []
		const result = await checkMarkdownFiles({
			cwd,
			config: {
				...noChecking,
				include: ["docs/**/*.md"],
				presets: [
					{ name: "p", include: ["other/**/*.md"], exclude: ["other/**"] },
					{
						name: "q",
						include: (project) => {
							seen.push(String(project.packageJson?.name))
							return ["guide/**/*.md"]
						},
					},
				],
			},
		})
		expect(seen).toEqual(["demo"])
		expect(result.stats.markdownFiles).toBe(2)
		expect(result.snippets).toEqual([])
	})
})

describe("diagnostics from rules", () => {
	it("count toward stats and carry the rule id", async () => {
		const plugin = pluginWith(
			"document",
			(ctx: RuleDocumentContext) =>
				ctx.report({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "m" }),
			"t",
			"error"
		)
		const result = await checkMarkdownFiles({
			cwd: tempProject({ "a.md": "prose" }),
			files: ["a.md"],
			config: { ...noChecking, plugins: [plugin] },
		})
		const diagnostic = result.diagnostics[0] as KiiraDiagnostic
		expect(diagnostic.code).toBe("t/r")
		expect(result.stats).toMatchObject({ errors: 1, warnings: 0 })
	})
})
