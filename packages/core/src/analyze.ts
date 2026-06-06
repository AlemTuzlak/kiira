import ts from "typescript"
import type { KiiraLanguage } from "./types"

const SCRIPT_KIND: Record<KiiraLanguage, ts.ScriptKind> = {
	ts: ts.ScriptKind.TS,
	tsx: ts.ScriptKind.TSX,
	js: ts.ScriptKind.JS,
	jsx: ts.ScriptKind.JSX,
}

interface SnippetSymbols {
	/** Names declared at the snippet's top level (visible to a later grouped snippet). */
	declares: Set<string>
	/** Free identifiers the snippet references but does not bind in any enclosing scope. */
	references: Set<string>
}

function collectBindingNames(name: ts.BindingName, out: Set<string>): void {
	if (ts.isIdentifier(name)) {
		out.add(name.text)
		return
	}
	for (const element of name.elements) {
		if (ts.isBindingElement(element)) {
			collectBindingNames(element.name, out)
		}
	}
}

function declarationName(node: ts.Node): string | undefined {
	if (
		(ts.isFunctionDeclaration(node) ||
			ts.isClassDeclaration(node) ||
			ts.isEnumDeclaration(node) ||
			ts.isModuleDeclaration(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isTypeAliasDeclaration(node)) &&
		node.name &&
		ts.isIdentifier(node.name)
	) {
		return node.name.text
	}
	return undefined
}

function collectImportBindings(node: ts.Node, out: Set<string>): void {
	if (ts.isImportClause(node) && node.name) {
		out.add(node.name.text)
	} else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) {
		out.add(node.name.text)
	}
}

function collectTopLevelDeclares(statement: ts.Statement, out: Set<string>): void {
	if (ts.isVariableStatement(statement)) {
		for (const decl of statement.declarationList.declarations) {
			collectBindingNames(decl.name, out)
		}
		return
	}
	const name = declarationName(statement)
	if (name) {
		out.add(name)
		return
	}
	if (ts.isImportDeclaration(statement) && statement.importClause) {
		const clause = statement.importClause
		if (clause.name) {
			out.add(clause.name.text)
		}
		if (clause.namedBindings) {
			if (ts.isNamespaceImport(clause.namedBindings)) {
				out.add(clause.namedBindings.name.text)
			} else {
				for (const spec of clause.namedBindings.elements) {
					out.add(spec.name.text)
				}
			}
		}
	}
}

/** Body of a function-like node, if it has one (call/construct signatures don't). */
function functionBody(node: ts.SignatureDeclaration): ts.ConciseBody | undefined {
	return (node as ts.FunctionLikeDeclaration).body
}

/** Names bound directly in a scope (params + declarations), not descending into nested scopes. */
function collectScopeBindings(scopeNode: ts.Node, out: Set<string>): void {
	const walk = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node)) {
			collectBindingNames(node.name, out)
		} else {
			const name = declarationName(node)
			if (name) {
				out.add(name)
			}
			collectImportBindings(node, out)
		}
		// A nested function's own bindings belong to its scope, not this one (its
		// declaration name was already captured above for hoisting).
		if (node !== scopeNode && ts.isFunctionLike(node)) {
			return
		}
		ts.forEachChild(node, walk)
	}

	if (ts.isFunctionLike(scopeNode)) {
		for (const param of scopeNode.parameters) {
			collectBindingNames(param.name, out)
		}
		const body = functionBody(scopeNode)
		if (body) {
			ts.forEachChild(body, walk)
		}
	} else {
		ts.forEachChild(scopeNode, walk)
	}
}

/**
 * Statically determine which top-level names a snippet declares and which free
 * identifiers it references, with lexical scoping so inner bindings don't shadow
 * genuine outer references. Parse-only; used to plan minimal snippet groups.
 */
export function analyzeSnippet(code: string, lang: KiiraLanguage): SnippetSymbols {
	const sourceFile = ts.createSourceFile("snippet", code, ts.ScriptTarget.Latest, true, SCRIPT_KIND[lang])
	const declares = new Set<string>()
	for (const statement of sourceFile.statements) {
		collectTopLevelDeclares(statement, declares)
	}

	const references = new Set<string>()
	const resolveScope = (scopeNode: ts.Node, enclosing: Set<string>[]): void => {
		const local = new Set<string>()
		collectScopeBindings(scopeNode, local)
		const scopes = [...enclosing, local]

		const visit = (node: ts.Node): void => {
			// `obj.prop` — the property name is not a free reference.
			if (ts.isPropertyAccessExpression(node)) {
				visit(node.expression)
				return
			}
			// `{ key: binding }` / `import { name as binding }` — the left side is a key,
			// not a free identifier; the binding itself is already in `local`.
			if (ts.isBindingElement(node)) {
				if (node.initializer) {
					visit(node.initializer)
				}
				if (!ts.isIdentifier(node.name)) {
					visit(node.name)
				}
				return
			}
			if (ts.isImportSpecifier(node)) {
				return
			}
			// Descend into a nested scope with this scope's bindings visible.
			if (node !== scopeNode && ts.isFunctionLike(node)) {
				resolveScope(node, scopes)
				return
			}
			if (ts.isIdentifier(node)) {
				if (!scopes.some((scope) => scope.has(node.text))) {
					references.add(node.text)
				}
				return
			}
			ts.forEachChild(node, visit)
		}

		if (ts.isFunctionLike(scopeNode)) {
			for (const param of scopeNode.parameters) {
				if (param.type) {
					visit(param.type)
				}
				if (param.initializer) {
					visit(param.initializer)
				}
			}
			const body = functionBody(scopeNode)
			if (body) {
				visit(body)
			}
		} else {
			ts.forEachChild(scopeNode, visit)
		}
	}
	resolveScope(sourceFile, [])

	return { declares, references }
}
