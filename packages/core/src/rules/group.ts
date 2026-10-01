import { analyzeSnippet } from "../analyze"
import { checkVirtualFiles } from "../check"
import { defineRule } from "../plugin"
import type { ExtractedSnippet, KiiraDiagnostic, ResolvedKiiraConfig, RuleReport } from "../types"
import { createVirtualFiles, effectiveGroup, isCheckable } from "../virtual"

/** TS codes meaning "cannot find name X" — the signature of a continuation snippet. */
const CANNOT_FIND_NAME = new Set([2304, 2552])

function groupSlug(markdownFile: string): string {
	const base = (markdownFile.split(/[\\/]/).pop() ?? markdownFile).replace(/\.[^.]+$/, "")
	return (
		base
			.replace(/[^a-zA-Z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase() || "group"
	)
}

// Identity of an error for baseline membership: code + full position + message,
// so two distinct errors that merely share a line and TS code (e.g. two unresolved
// names on one line) are not conflated when deciding if grouping introduced a new one.
const errorKey = (d: KiiraDiagnostic): string =>
	`${d.code}@${d.markdownRange.start.line}:${d.markdownRange.start.character}:${d.message}`

// Line count per snippet, computed once: `isWithinSnippet` runs for every
// (diagnostic, snippet) pair and splitting the code each time was the hot spot.
const lineCounts = new WeakMap<ExtractedSnippet, number>()

function lineCount(snippet: ExtractedSnippet): number {
	let count = lineCounts.get(snippet)
	if (count === undefined) {
		count = 1
		for (let i = 0; i < snippet.code.length; i += 1) {
			if (snippet.code.charCodeAt(i) === 10 /* \n */) {
				count += 1
			}
		}
		lineCounts.set(snippet, count)
	}
	return count
}

/** Whether a diagnostic's line falls within a snippet's code span. */
function isWithinSnippet(diagnostic: KiiraDiagnostic, snippet: ExtractedSnippet): boolean {
	const start = snippet.codeStart.line
	const end = start + lineCount(snippet) - 1
	const line = diagnostic.markdownRange.start.line
	return line >= start && line <= end
}

/** Names a snippet reports as "cannot find" when checked standalone, parsed from its errors. */
function unresolvedNames(snippet: ExtractedSnippet, docErrors: readonly KiiraDiagnostic[]): Set<string> {
	const names = new Set<string>()
	for (const d of docErrors) {
		if (!isWithinSnippet(d, snippet)) {
			continue
		}
		if (typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code)) {
			const name = /Cannot find name '([^']+)'/.exec(d.message)?.[1]
			if (name) {
				names.add(name)
			}
		}
	}
	return names
}

/**
 * Plan minimal snippet groups. For each snippet, link it to the nearest earlier
 * snippet that declares a name the snippet *actually fails to resolve standalone*
 * (its "cannot find name" errors) — so already-valid snippets are never dragged in
 * as consumers, only used as providers. A redeclare guard refuses to merge two
 * components that declare a common top-level name, so two independent `const x = …`
 * examples never collapse into one redeclaring group even when they share a
 * reference. Returns only multi-member clusters, each as sorted indices.
 */
function planMinimalGroups(snippets: ExtractedSnippet[], docErrors: readonly KiiraDiagnostic[]): number[][] {
	const symbols = snippets.map((s) => analyzeSnippet(s.code, s.lang))
	const missing = snippets.map((s) => unresolvedNames(s, docErrors))

	const parent = snippets.map((_, i) => i)
	// Per-root union of the component's declared top-level names, for the guard.
	const declaresOf = symbols.map((sym) => new Set(sym.declares))
	const find = (x: number): number => {
		let root = x
		while (parent[root] !== root) {
			root = parent[root]
		}
		parent[x] = root
		return root
	}
	const tryUnion = (a: number, b: number): void => {
		const ra = find(a)
		const rb = find(b)
		if (ra === rb) {
			return
		}
		// Redeclare guard: merging two snippets that both declare the same name
		// would only produce a TS2451, so keep independent examples apart.
		for (const name of declaresOf[ra]) {
			if (declaresOf[rb].has(name)) {
				return
			}
		}
		parent[ra] = rb
		for (const name of declaresOf[ra]) {
			declaresOf[rb].add(name)
		}
	}

	for (let i = 0; i < snippets.length; i += 1) {
		for (const name of missing[i]) {
			// Link only to the *nearest* earlier declarer — the most likely intended
			// provider. We stop at it even if the redeclare guard then refuses the
			// merge: a snippet whose nearest provider conflicts is an independent
			// example (it redeclares a shared name), not a continuation, so reaching
			// further back to a distant definer would only over-group.
			for (let j = i - 1; j >= 0; j -= 1) {
				if (symbols[j].declares.has(name)) {
					tryUnion(i, j)
					break
				}
			}
		}
	}

	const byRoot = new Map<number, number[]>()
	for (let i = 0; i < snippets.length; i += 1) {
		const root = find(i)
		const members = byRoot.get(root) ?? []
		members.push(i)
		byRoot.set(root, members)
	}
	return [...byRoot.values()].filter((g) => g.length >= 2).map((g) => g.sort((a, b) => a - b))
}

interface GroupSuggestionsInput {
	cwd: string
	/** The Markdown file the snippets and diagnostics belong to. */
	file: string
	snippets: readonly ExtractedSnippet[]
	/** The file's type-check diagnostics. */
	diagnostics: readonly KiiraDiagnostic[]
	config: ResolvedKiiraConfig
}

/**
 * For a fully-ungrouped document with "cannot find name" errors, plan minimal
 * dependency clusters and suggest a `group=` tag for each — but only after a
 * type-check probe confirms the cluster removes errors and introduces none. This
 * groups genuine continuations while leaving independent examples alone.
 */
export async function groupSuggestions(input: GroupSuggestionsInput): Promise<RuleReport[]> {
	const { cwd, file, diagnostics, config } = input
	const suggestions: RuleReport[] = []

	const checkable = input.snippets
		.filter((s) => isCheckable(s, config))
		.sort((a, b) => a.markdownRange.start.line - b.markdownRange.start.line)
	// Only attempt on docs that aren't already grouped — by an explicit `group=`
	// or by an effective `defaultGroup: "file"`. (When file-grouping is on, every
	// fence is grouped, so there is nothing to suggest.)
	if (checkable.length < 2 || checkable.some((s) => effectiveGroup(s, config) !== undefined)) {
		return suggestions
	}
	const docErrors = diagnostics.filter((d) => d.severity === "error")
	if (!docErrors.some((d) => typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code))) {
		return suggestions
	}

	// Probe every candidate cluster first; keep only those that verify, so the
	// `-N` slug suffix reflects the number of *surviving* groups (a doc with one
	// real group gets a clean `group=<doc>`, not `group=<doc>-1`).
	const survivors: ExtractedSnippet[][] = []
	for (const plan of planMinimalGroups(checkable, docErrors)) {
		const members = plan.map((i) => checkable[i])
		const memberErrors = docErrors.filter((d) => members.some((m) => isWithinSnippet(d, m)))
		const baseline = new Set(memberErrors.map(errorKey))
		const baselineCannotFind = memberErrors.filter(
			(d) => typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code)
		).length

		// Verify the cluster: type-check it together and require it to strictly
		// reduce the "cannot find name" errors while introducing no new error of
		// any kind (a new TS2451 redeclare would mean we merged too much).
		const probe = members.map((s) => ({ ...s, meta: { ...s.meta, group: "__kiira_probe__" } }))
		const { virtualFiles } = await createVirtualFiles({ cwd, snippets: probe, config })
		const grouped = (await checkVirtualFiles({ cwd, virtualFiles, config })).filter((d) => d.severity === "error")
		const groupedCannotFind = grouped.filter((d) => typeof d.code === "number" && CANNOT_FIND_NAME.has(d.code)).length
		if (grouped.some((d) => !baseline.has(errorKey(d))) || groupedCannotFind >= baselineCannotFind) {
			continue
		}
		survivors.push(members)
	}

	survivors.forEach((members, index) => {
		const slug = survivors.length > 1 ? `${groupSlug(file)}-${index + 1}` : groupSlug(file)
		for (const member of members) {
			const start = member.markdownRange.start
			suggestions.push({
				range: { start, end: start },
				message: `This snippet continues an earlier one. Tag them \`group=${slug}\` to type-check them together (run \`kiira check --fix\` to apply).`,
				fix: { kind: "fence-meta", line: start.line, append: `group=${slug}` },
			})
		}
	})

	return suggestions
}

export const groupRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "warn",
		docs: {
			description:
				"Suggests a `group=` tag for fences that continue an earlier one, after a probe confirms grouping removes errors.",
		},
	},
	async create(ctx) {
		const reports = await groupSuggestions({
			cwd: ctx.project.cwd,
			file: ctx.file,
			snippets: ctx.snippets,
			diagnostics: ctx.diagnostics,
			config: ctx.config,
		})
		for (const report of reports) {
			ctx.report(report)
		}
	},
})
