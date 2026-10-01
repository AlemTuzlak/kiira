import type { Identifier } from "typescript"
import { defineRule } from "../plugin"
import { getTypescript } from "../typescript"

interface DeprecatedImportOptions {
	packages?: string[]
}

function validateOptions(options: unknown): string | undefined {
	if (options === undefined) {
		return undefined
	}
	if (typeof options !== "object" || options === null) {
		return "options must be an object"
	}
	const { packages } = options as { packages?: unknown }
	const valid = packages === undefined || (Array.isArray(packages) && packages.every((p) => typeof p === "string"))
	return valid ? undefined : "`packages` must be an array of strings"
}

export const deprecatedImportRule = defineRule<"program", DeprecatedImportOptions>({
	meta: {
		scope: "program",
		defaultSeverity: "off",
		docs: { description: "Reports an imported binding whose declaration is tagged `@deprecated`." },
		options: { validate: validateOptions },
	},
	create(ctx) {
		const ts = getTypescript()
		const packages = ctx.options?.packages
		for (const virtualFile of ctx.virtualFiles) {
			const sourceFile = ctx.program.getSourceFile(virtualFile.fileName)
			if (!sourceFile) {
				continue
			}
			for (const statement of sourceFile.statements) {
				if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
					continue
				}
				const specifier = statement.moduleSpecifier.text
				if (packages && !packages.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
					continue
				}
				const clause = statement.importClause
				const bindings: Identifier[] = []
				if (clause?.name) {
					bindings.push(clause.name)
				}
				if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
					bindings.push(...clause.namedBindings.elements.map((element) => element.name))
				}
				for (const identifier of bindings) {
					let symbol = ctx.checker.getSymbolAtLocation(identifier)
					if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
						symbol = ctx.checker.getAliasedSymbol(symbol)
					}
					const tag = symbol?.getJsDocTags(ctx.checker).find((t) => t.name === "deprecated")
					const range = tag && ctx.toMarkdownRange(virtualFile, identifier.getStart(sourceFile), identifier.getEnd())
					if (tag && range) {
						const reason = ts.displayPartsToString(tag.text).trim()
						ctx.report({ range, message: `'${identifier.text}' is deprecated${reason ? `: ${reason}` : ""}` })
					}
				}
			}
		}
	},
})
