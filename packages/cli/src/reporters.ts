import type { TypedownCheckResult, TypedownDiagnostic } from "@typedown/core"
import chalk from "chalk"
import type { ReporterName } from "./args"

interface ReporterContext {
	cwd: string
	/** Return the lines of a Markdown file (for code frames), or undefined if unavailable. */
	getSourceLines?: (markdownFile: string) => string[] | undefined
	/** When true, render full messages and code frames; otherwise one line per diagnostic. */
	verbose?: boolean
}

const SEVERITY_COLOR = {
	error: chalk.red,
	warning: chalk.yellow,
	info: chalk.blue,
} as const

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
	const color = SEVERITY_COLOR[diagnostic.severity]
	return [`  ${chalk.dim(`${gutter} |`)} ${source}`, `  ${chalk.dim(`${caretPad} |`)} ${color(underline)}`].join("\n")
}

/** One compact line per diagnostic: `file:line:col severity CODE message`. */
function compactLine(d: TypedownDiagnostic): string {
	const location = chalk.cyan(
		`${d.markdownFile}:${d.markdownRange.start.line + 1}:${d.markdownRange.start.character + 1}`
	)
	const severity = SEVERITY_COLOR[d.severity](d.severity)
	const code = codeLabel(d.code)
	const codePart = code ? `${chalk.dim(code)} ` : ""
	const firstLine = d.message.split("\n")[0]
	return `${location} ${severity} ${codePart}${firstLine}`
}

/** A verbose block: header, full message, and a code frame. */
function verboseBlock(d: TypedownDiagnostic, ctx: ReporterContext): string {
	const location = chalk.cyan(
		`${d.markdownFile}:${d.markdownRange.start.line + 1}:${d.markdownRange.start.character + 1}`
	)
	const severity = SEVERITY_COLOR[d.severity](d.severity)
	const code = codeLabel(d.code)
	const header = `${location} ${severity}${code ? ` ${chalk.dim(code)}` : ""}`
	const frameLines = ctx.getSourceLines?.(d.markdownFile)
	const frame = frameLines ? renderCodeFrame(frameLines, d) : ""
	return [header, d.message, frame].filter(Boolean).join("\n")
}

export function formatPretty(result: TypedownCheckResult, ctx: ReporterContext): string {
	const { stats } = result
	const sections: string[] = []

	if (ctx.verbose) {
		sections.push(...result.diagnostics.map((d) => verboseBlock(d, ctx)))
	} else {
		// Group compact lines under a per-file header.
		const byFile = new Map<string, TypedownDiagnostic[]>()
		for (const d of result.diagnostics) {
			const list = byFile.get(d.markdownFile) ?? []
			list.push(d)
			byFile.set(d.markdownFile, list)
		}
		for (const [file, diags] of byFile) {
			sections.push([chalk.underline(file), ...diags.map((d) => `  ${compactLine(d)}`)].join("\n"))
		}
	}

	// Count failed *snippets* (a single snippet can emit several errors), not
	// raw error messages, so "Passed" never goes negative.
	const failedSnippets = new Set(
		result.diagnostics
			.filter((d) => d.severity === "error")
			.map((d) => d.virtualFile ?? `${d.markdownFile}:${d.markdownRange.start.line}`)
	).size
	const passedSnippets = Math.max(0, stats.checked - failedSnippets)

	const summary: string[] = []
	if (stats.errors === 0 && stats.warnings === 0) {
		summary.push(chalk.green(`✓ Typedown found no errors in ${pluralize(stats.markdownFiles, "file")}.`))
	} else {
		const parts = [chalk.red(pluralize(stats.errors, "error"))]
		if (stats.warnings > 0) {
			parts.push(chalk.yellow(pluralize(stats.warnings, "warning")))
		}
		summary.push(
			`${chalk.red("✖")} Typedown found ${parts.join(" and ")} in ${pluralize(stats.markdownFiles, "file")}.`
		)
	}
	summary.push(
		chalk.dim(
			`Checked ${pluralize(stats.checked, "snippet")}. Passed ${passedSnippets}. Failed ${failedSnippets}. Ignored ${stats.ignored}.`
		)
	)

	const body = sections.join(ctx.verbose ? "\n\n" : "\n")
	const parts = body.length > 0 ? [body, "", summary.join("\n")] : [summary.join("\n")]
	return parts.join("\n")
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
