import picomatch from "picomatch"
import { defineRule } from "../plugin"
import type { ExtractedSnippet, KiiraDiagnostic, ResolvedKiiraConfig, RuleReport } from "../types"

// JSX frameworks whose snippets need a non-default `jsxImportSource`, matched by
// a keyword appearing in the file path. (`react` is the TS default, so omitted.)
const FRAMEWORK_JSX: Array<[keyword: string, jsxImportSource: string]> = [
	["preact", "preact"],
	["solid", "solid-js"],
	["vue", "vue"],
]

/** TS code for "JSX element has no JSX.IntrinsicElements" — the wrong-JSX-runtime signature. */
const JSX_NO_INTRINSICS = 7026

interface JsxFrameworkSuggestionInput {
	file: string
	snippets: readonly ExtractedSnippet[]
	/** The file's type-check diagnostics. */
	diagnostics: readonly KiiraDiagnostic[]
	config: ResolvedKiiraConfig
}

/**
 * For a file emitting TS7026 (JSX checked without the right runtime types), infer
 * the framework from the file path and suggest a `jsxImportSource` override at the
 * broadest matching glob, with a fix that writes it into the config.
 *
 * The config-override fix is de-duplicated (by include + options) when `--fix`
 * applies it, so a glob shared by several files is written once.
 */
export function jsxFrameworkSuggestions({
	file,
	snippets,
	diagnostics,
	config,
}: JsxFrameworkSuggestionInput): RuleReport[] {
	const jsxError = diagnostics.find((d) => d.code === JSX_NO_INTRINSICS)
	if (!jsxError || config.overrides.some((o) => "jsxImportSource" in o && picomatch(o.include)(file))) {
		return []
	}
	const framework = FRAMEWORK_JSX.find(([keyword]) => file.toLowerCase().includes(keyword))
	if (!framework) {
		return []
	}
	const [keyword, jsxImportSource] = framework
	const include = `**/*${keyword}*`
	const anchor = snippets[0]?.markdownRange.start ?? jsxError.markdownRange.start
	return [
		{
			range: { start: anchor, end: anchor },
			message: `JSX here looks like ${keyword}. Add a \`jsxImportSource: "${jsxImportSource}"\` override for \`${include}\` (run \`kiira check --fix\` to apply).`,
			fix: { kind: "config-override", include, compilerOptions: { jsxImportSource } },
		},
	]
}

export const jsxFrameworkRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "warn",
		docs: {
			description:
				"Suggests a `jsxImportSource` override when JSX fails to type-check and the file path names a framework.",
		},
	},
	create(ctx) {
		for (const report of jsxFrameworkSuggestions(ctx)) {
			ctx.report(report)
		}
	},
})
