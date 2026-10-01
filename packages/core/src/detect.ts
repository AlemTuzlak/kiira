import type ts from "typescript"
import type { KiiraLanguage } from "./types"
import { getTypescript } from "./typescript"

// Only `ts` is remapped: JSX in a `ts` fence is a hard syntax error, whereas
// `js` fences parse and type-check JSX fine, so they need no correction.
const JSX_VARIANT: Partial<Record<KiiraLanguage, KiiraLanguage>> = {
	ts: "tsx",
}

function scriptKind(lang: KiiraLanguage): ts.ScriptKind {
	const ts = getTypescript()
	switch (lang) {
		case "ts":
			return ts.ScriptKind.TS
		case "tsx":
			return ts.ScriptKind.TSX
		case "js":
			return ts.ScriptKind.JS
		case "jsx":
			return ts.ScriptKind.JSX
	}
}

function parse(code: string, lang: KiiraLanguage): ts.SourceFile {
	const ts = getTypescript()
	return ts.createSourceFile("snippet", code, ts.ScriptTarget.Latest, false, scriptKind(lang))
}

function parseErrorCount(sourceFile: ts.SourceFile): number {
	const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
	return diagnostics ? diagnostics.length : 0
}

function containsJsx(sourceFile: ts.SourceFile): boolean {
	const ts = getTypescript()
	let found = false
	const visit = (node: ts.Node): void => {
		if (found) {
			return
		}
		if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
			found = true
			return
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(sourceFile, visit)
	return found
}

export interface LanguageTagSuggestion {
	suggested: KiiraLanguage
}

/**
 * Detect when a `ts`/`js` fence actually contains JSX and should be tagged
 * `tsx`/`jsx`. Returns the suggested language, or `undefined` when the tag is fine.
 *
 * Signal: the snippet parses cleanly under the JSX variant *and* contains JSX
 * nodes. This is reliable because the TS-only angle-bracket constructs that could
 * look like JSX — type assertions (`<T>x`) and generic arrows (`<T>() => …`) —
 * fail to parse under `tsx`, so they never satisfy the "clean as JSX" condition.
 */
export function detectLanguageTag(code: string, declaredLang: KiiraLanguage): LanguageTagSuggestion | undefined {
	const variant = JSX_VARIANT[declaredLang]
	if (!variant) {
		return undefined // tsx/jsx already accept JSX
	}
	const variantSource = parse(code, variant)
	if (parseErrorCount(variantSource) !== 0 || !containsJsx(variantSource)) {
		return undefined
	}
	return { suggested: variant }
}
