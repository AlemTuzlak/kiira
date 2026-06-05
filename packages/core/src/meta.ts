import type { TypedownFenceMeta } from "./types"

export interface FenceMetaIssue {
	message: string
}

export interface ParsedFenceMeta {
	meta: TypedownFenceMeta
	/** Unknown metadata, preserved verbatim but not acted upon. */
	unknown: Record<string, string | boolean>
	issues: FenceMetaIssue[]
}

const VALIDATE_VALUES = new Set(["type", "runtime", "none"])
const PACKAGE_VALUES = new Set(["workspace", "packed"])

// Matches whitespace-delimited tokens while keeping quoted segments intact, so
// `name="basic chat"` is a single token rather than two.
const TOKEN_RE = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g

function stripQuotes(value: string): string {
	if (value.length >= 2) {
		const first = value[0]
		const last = value[value.length - 1]
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return value.slice(1, -1)
		}
	}
	return value
}

/**
 * Parse a Markdown fence info string (the part after the language) into
 * structured Typedown metadata. Unknown keys are preserved and never fatal;
 * invalid known values produce issues instead of throwing.
 */
export function parseFenceMeta(raw: string | null | undefined): ParsedFenceMeta {
	const meta: TypedownFenceMeta = {}
	const unknown: Record<string, string | boolean> = {}
	const issues: FenceMetaIssue[] = []

	if (!raw) {
		return { meta, unknown, issues }
	}

	const tokens = raw.match(TOKEN_RE) ?? []
	for (const token of tokens) {
		const eq = token.indexOf("=")
		const key = eq === -1 ? token : token.slice(0, eq)
		const value = eq === -1 ? null : stripQuotes(token.slice(eq + 1))

		switch (key) {
			case "ignore":
				meta.ignore = value === null ? true : value !== "false"
				break
			case "validate":
				if (value !== null && VALIDATE_VALUES.has(value)) {
					meta.validate = value as TypedownFenceMeta["validate"]
				} else {
					issues.push({
						message: `Invalid \`validate\` value ${JSON.stringify(value)}. Expected "type", "runtime", or "none".`,
					})
				}
				break
			case "package":
				if (value !== null && PACKAGE_VALUES.has(value)) {
					meta.package = value as TypedownFenceMeta["package"]
				} else {
					issues.push({
						message: `Invalid \`package\` value ${JSON.stringify(value)}. Expected "workspace" or "packed".`,
					})
				}
				break
			case "fixture":
				if (value !== null) {
					meta.fixture = value
				}
				break
			case "name":
				if (value !== null) {
					meta.name = value
				}
				break
			case "group":
				if (value !== null) {
					meta.group = value
				}
				break
			default:
				unknown[key] = value === null ? true : value
				break
		}
	}

	return { meta, unknown, issues }
}
