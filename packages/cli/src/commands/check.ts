import { readFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { type TypedownConfig, checkMarkdownFiles, loadConfig, loadConfigFile } from "@typedown/core"
import type { ReporterName } from "../args"
import { applyFenceLanguageFixes } from "../fix"
import { formatReport } from "../reporters"

interface RunCheckOptions {
	cwd: string
	files: string[]
	config?: string
	reporter: ReporterName
	fix?: boolean
	log: (message: string) => void
	error: (message: string) => void
}

function createSourceLineReader(cwd: string): (markdownFile: string) => string[] | undefined {
	const cache = new Map<string, string[] | undefined>()
	return (markdownFile) => {
		if (cache.has(markdownFile)) {
			return cache.get(markdownFile)
		}
		let lines: string[] | undefined
		try {
			lines = readFileSync(join(cwd, markdownFile), "utf8").split(/\r?\n/)
		} catch {
			lines = undefined
		}
		cache.set(markdownFile, lines)
		return lines
	}
}

/**
 * Run `typedown check`. Returns the process exit code: 0 when clean, 1 when there
 * are validation errors. Configuration/runtime failures throw (the caller maps
 * those to exit code 2).
 */
export async function runCheck(options: RunCheckOptions): Promise<number> {
	const { cwd } = options

	const loaded: TypedownConfig = options.config
		? await loadConfigFile(isAbsolute(options.config) ? options.config : resolve(cwd, options.config))
		: await loadConfig(cwd)

	// Positional file args act as include globs, overriding the config's include.
	const config: TypedownConfig = options.files.length > 0 ? { ...loaded, include: options.files } : loaded

	let result = await checkMarkdownFiles({ cwd, config })

	// `--fix`: rewrite mistagged fences in the source, then re-check so the report
	// reflects the corrected files.
	if (options.fix) {
		const summary = await applyFenceLanguageFixes(cwd, result.diagnostics)
		if (summary.fixesApplied > 0) {
			options.log(
				`Fixed ${summary.fixesApplied} fence language tag${summary.fixesApplied === 1 ? "" : "s"} in ${summary.filesChanged} file${summary.filesChanged === 1 ? "" : "s"}.\n`
			)
			result = await checkMarkdownFiles({ cwd, config })
		}
	}

	const output = formatReport(options.reporter, result, {
		cwd,
		getSourceLines: createSourceLineReader(cwd),
	})
	if (output.length > 0) {
		options.log(output)
	}

	return result.stats.errors > 0 ? 1 : 0
}
