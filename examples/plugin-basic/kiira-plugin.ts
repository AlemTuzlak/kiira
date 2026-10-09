import { relative } from "node:path"
import { type KiiraPreset, definePlugin, defineRule } from "kiira-core/plugin"

/** `Getting Started!` becomes `getting-started`. */
export function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

// Kiira does not parse YAML, so the rule reads `frontmatter.raw` as plain text.
const TITLE = /^title:[ \t]*(.*?)[ \t]*$/m
const SLUG = /^slug:/m

/** Document rule: a `title:` is required, and a missing `slug:` is added by `--fix`. */
const frontmatter = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "error",
		docs: { description: "Requires frontmatter with a title, and adds a slug derived from it." },
	},
	create(ctx) {
		const block = ctx.frontmatter
		if (!block) {
			const start = { line: 0, character: 0 }
			ctx.report({ range: { start, end: start }, message: "Add frontmatter with a `title:` line." })
			return
		}
		const title = TITLE.exec(block.raw)?.[1]?.replace(/^(["'])(.*)\1$/, "$2")
		if (!title) {
			ctx.report({ range: block.range, message: "Frontmatter needs a `title:` line." })
			return
		}
		if (SLUG.test(block.raw)) {
			return
		}
		// A zero-width range inserts: put the new line just before the closing `---`.
		const at = { line: block.range.end.line, character: 0 }
		ctx.report({
			range: block.range,
			message: "Frontmatter needs a `slug:` line.",
			fix: {
				kind: "edits",
				edits: [{ file: ctx.file, range: { start: at, end: at }, newText: `slug: ${slugify(title)}\n` }],
			},
		})
	},
})

/** Program rule: exported values typed `any` hide type errors from readers who copy the snippet. */
const noAnyExports = defineRule({
	meta: {
		scope: "program",
		defaultSeverity: "warn",
		docs: { description: "Flags exported values whose type is `any`." },
	},
	create(ctx) {
		for (const virtualFile of ctx.virtualFiles) {
			const sourceFile = ctx.program.getSourceFile(virtualFile.fileName)
			const moduleSymbol = sourceFile && ctx.checker.getSymbolAtLocation(sourceFile)
			if (!sourceFile || !moduleSymbol) {
				continue
			}
			for (const symbol of ctx.checker.getExportsOfModule(moduleSymbol)) {
				const declaration = symbol.valueDeclaration
				if (!declaration) {
					continue
				}
				const type = ctx.checker.getTypeOfSymbolAtLocation(symbol, declaration)
				if (ctx.checker.typeToString(type) !== "any") {
					continue
				}
				// `undefined` means the declaration sits in generated code, such as a fixture.
				const range = ctx.toMarkdownRange(virtualFile, declaration.getStart(sourceFile), declaration.getEnd())
				if (range) {
					ctx.report({ range, message: `\`${symbol.name}\` is exported as \`any\`. Give it a type.` })
				}
			}
		}
	},
})

/** Project rule: runs once, and can report on any file, not only Markdown. */
const docsIndex = defineRule({
	meta: {
		scope: "project",
		defaultSeverity: "error",
		docs: { description: "Requires an index page for the docs." },
		options: {
			default: { file: "docs/index.md" },
			validate: (options) =>
				typeof (options as { file?: unknown } | undefined)?.file === "string" ? undefined : "`file` must be a string",
		},
	},
	create(ctx) {
		if (!ctx.fs.exists(ctx.options.file)) {
			ctx.report({ file: "package.json", message: `Add ${ctx.options.file}: the docs need an index page.` })
		}
	},
})

/** Docs live in `docs/` at the root, or in each workspace package's `docs/`. */
export const docsPreset: KiiraPreset = {
	name: "docs",
	include: (project) =>
		project.workspacePackages.length > 0
			? project.workspacePackages.map((pkg) => `${relative(project.cwd, pkg.dir).replaceAll("\\", "/")}/docs/**/*.md`)
			: ["docs/**/*.md"],
	// A project without docs yet is not an error.
	allowEmpty: true,
	codeFenceLanguages: ["ts", "tsx", "typescript", "js", "jsx", "javascript"],
	rules: {
		"team/frontmatter": "error",
		"team/docs-index": ["error", { file: "docs/index.md" }],
	},
}

export const teamPlugin = definePlugin({
	name: "team",
	rules: { frontmatter, "no-any-exports": noAnyExports, "docs-index": docsIndex },
	presets: [docsPreset],
	// TypeScript hook (experimental): the docs assume a global `appConfig`, so its
	// "cannot find name" error is dropped, unless the page opts out in its frontmatter.
	typescript(_file, ctx) {
		if (ctx.frontmatter && /^strict:[ \t]*true/m.test(ctx.frontmatter.raw)) {
			return undefined
		}
		return {
			filterDiagnostic: (diagnostic) => !(diagnostic.code === 2304 && diagnostic.message.includes("'appConfig'")),
		}
	},
})
