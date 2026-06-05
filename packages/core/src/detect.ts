import ts from "typescript"
import type { TypedownLanguage } from "./types"

// Only `ts` is remapped: JSX in a `ts` fence is a hard syntax error, whereas
// `js` fences parse and type-check JSX fine, so they need no correction.
const JSX_VARIANT: Partial<Record<TypedownLanguage, TypedownLanguage>> = {
	ts: "tsx",
}

const SCRIPT_KIND: Record<TypedownLanguage, ts.ScriptKind> = {
	ts: ts.ScriptKind.TS,
	tsx: ts.ScriptKind.TSX,
	js: ts.ScriptKind.JS,
	jsx: ts.ScriptKind.JSX,
}

function parse(code: string, lang: TypedownLanguage): ts.SourceFile {
	return ts.createSourceFile("snippet", code, ts.ScriptTarget.Latest, false, SCRIPT_KIND[lang])
}

function parseErrorCount(sourceFile: ts.SourceFile): number {
	const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
	return diagnostics ? diagnostics.length : 0
}

function containsJsx(sourceFile: ts.SourceFile): boolean {
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
	suggested: TypedownLanguage
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
export function detectLanguageTag(code: string, declaredLang: TypedownLanguage): LanguageTagSuggestion | undefined {
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
