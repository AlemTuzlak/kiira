import type { TypedownCheckResult, TypedownDiagnostic } from "@typedown/core"
import type { ReporterName } from "./args"

interface ReporterContext {
	cwd: string
	/** Return the lines of a Markdown file (for code frames), or undefined if unavailable. */
	getSourceLines?: (markdownFile: string) => string[] | undefined
}

/** Render a TS code (e.g. 2305) as `TS2305`; pass other codes through. */
function codeLabel(code: TypedownDiagnostic["code"]): string {
	if (typeof code === "number") {
		return `TS${code}`
	}
	return code ?? ""
}

function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`
}

// --- JSON -----------------------------------------------------------------

/** Machine-readable report. Positions are 1-based for both line and character. */
export function formatJson(result: TypedownCheckResult): string {
	const diagnostics = result.diagnostics.map((d) => ({
		severity: d.severity,
		source: d.source,
		code: d.code,
		message: d.message,
		markdownFile: d.markdownFile,
		markdownRange: {
			start: { line: d.markdownRange.start.line + 1, character: d.markdownRange.start.character + 1 },
			end: { line: d.markdownRange.end.line + 1, character: d.markdownRange.end.character + 1 },
		},
		generated: d.generated ?? false,
	}))
	return JSON.stringify({ stats: result.stats, diagnostics }, null, 2)
}

// --- GitHub ---------------------------------------------------------------

function githubSeverity(severity: TypedownDiagnostic["severity"]): "error" | "warning" | "notice" {
	if (severity === "error") {
		return "error"
	}
	if (severity === "warning") {
		return "warning"
	}
	return "notice"
}

function escapeGithubData(value: string): string {
	return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
}

/** GitHub Actions workflow command annotations (1-based line/col). */
export function formatGithub(result: TypedownCheckResult): string {
	return result.diagnostics
		.map((d) => {
			const line = d.markdownRange.start.line + 1
			const col = d.markdownRange.start.character + 1
			const title = codeLabel(d.code)
			const titlePart = title ? `,title=${title}` : ""
			return `::${githubSeverity(d.severity)} file=${d.markdownFile},line=${line},col=${col}${titlePart}::${escapeGithubData(d.message)}`
		})
		.join("\n")
}

// --- Pretty ---------------------------------------------------------------

function renderCodeFrame(lines: string[], diagnostic: TypedownDiagnostic): string {
	const lineIndex = diagnostic.markdownRange.start.line
	const source = lines[lineIndex]
	if (source === undefined) {
		return ""
	}
	const displayLineNo = lineIndex + 1
	const gutter = String(displayLineNo)
	const startCol = diagnostic.markdownRange.start.character
	const sameLine = diagnostic.markdownRange.end.line === lineIndex
	const endCol = sameLine ? Math.max(diagnostic.markdownRange.end.character, startCol + 1) : source.length
	const caretPad = " ".repeat(gutter.length)
	const underline = `${" ".repeat(startCol)}${"^".repeat(Math.max(1, endCol - startCol))}`
	return [`  ${gutter} | ${source}`, `  ${caretPad} | ${underline}`].join("\n")
}

export function formatPretty(result: TypedownCheckResult, ctx: ReporterContext): string {
	const { stats } = result
	const blocks: string[] = []

	for (const d of result.diagnostics) {
		const location = `${d.markdownFile}:${d.markdownRange.start.line + 1}:${d.markdownRange.start.character + 1}`
		const code = codeLabel(d.code)
		const header = code ? `${location} - ${code} ${d.severity}` : `${location} - ${d.severity}`
		const lines = ctx.getSourceLines?.(d.markdownFile)
		const frame = lines ? renderCodeFrame(lines, d) : ""
		blocks.push([header, d.message, frame].filter(Boolean).join("\n"))
	}

	const summary: string[] = []
	if (stats.errors === 0 && stats.warnings === 0) {
		summary.push(`Typedown found no errors in ${pluralize(stats.markdownFiles, "file")}.`)
	} else {
		const parts = [pluralize(stats.errors, "error")]
		if (stats.warnings > 0) {
			parts.push(pluralize(stats.warnings, "warning"))
		}
		summary.push(`Typedown found ${parts.join(" and ")} in ${pluralize(stats.markdownFiles, "file")}.`)
	}
	summary.push(
		`Checked ${pluralize(stats.checked, "snippet")}. Passed ${stats.checked - stats.errors}. Failed ${stats.errors}. Ignored ${stats.ignored}.`
	)

	return [...blocks, blocks.length > 0 ? "" : "", summary.join("\n")].filter((s) => s !== undefined).join("\n")
}

// --- Dispatch -------------------------------------------------------------

export function formatReport(reporter: ReporterName, result: TypedownCheckResult, ctx: ReporterContext): string {
	switch (reporter) {
		case "json":
			return formatJson(result)
		case "github":
			return formatGithub(result)
		default:
			return formatPretty(result, ctx)
	}
}
