import { readFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { type TypedownConfig, checkMarkdownFiles, findConfigFile, loadConfig, loadConfigFile } from "@typedown/core"
import type { ReporterName } from "../args"
import { toIgnoreGlobs, toIncludeGlobs } from "../entries"
import { applyConfigOverrides, applyFixes } from "../fix"
import { formatReport } from "../reporters"

interface RunCheckOptions {
	cwd: string
	files: string[]
	entry?: string[]
	ignore?: string[]
	config?: string
	reporter: ReporterName
	fix?: boolean
	verbose?: boolean
	raw?: boolean
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

	// Positional args and `--entry` are the directories/files/globs to check; they
	// override the config's `include`. `--ignore` adds to the config's `exclude`.
	const entries = [...options.files, ...(options.entry ?? [])]
	const include = entries.length > 0 ? toIncludeGlobs(cwd, entries) : loaded.include
	const exclude = [...(loaded.exclude ?? []), ...toIgnoreGlobs(cwd, options.ignore ?? [])]
	const config: TypedownConfig = { ...loaded, include, exclude }

	let result = await checkMarkdownFiles({ cwd, config })

	// `--fix`: rewrite mistagged fences in the source, then re-check so the report
	// reflects the corrected files.
	if (options.fix) {
		const configPath = options.config
			? isAbsolute(options.config)
				? options.config
				: resolve(cwd, options.config)
			: findConfigFile(cwd)

		const fences = await applyFixes(cwd, result.diagnostics)
		const overrides = await applyConfigOverrides(configPath, result.diagnostics)

		if (fences.fixesApplied > 0 || overrides.applied.length > 0) {
			const parts: string[] = []
			if (fences.fixesApplied > 0) {
				parts.push(`${fences.fixesApplied} fence${fences.fixesApplied === 1 ? "" : "s"}`)
			}
			if (overrides.applied.length > 0) {
				parts.push(`${overrides.applied.length} config override${overrides.applied.length === 1 ? "" : "s"}`)
			}
			options.log(`Fixed ${parts.join(" and ")}.\n`)
			// Reflect applied overrides in the in-memory config for the re-check.
			config.overrides = [...(config.overrides ?? []), ...overrides.applied]
			result = await checkMarkdownFiles({ cwd, config })
		}

		if (overrides.manual.length > 0) {
			options.log("Add these overrides to your Typedown config (config is not JSON, so apply manually):")
			for (const fix of overrides.manual) {
				const opts = Object.entries(fix.compilerOptions)
					.map(([k, v]) => `"${k}": "${v}"`)
					.join(", ")
				options.log(`  { "include": ["${fix.include}"], ${opts} }`)
			}
		}
	}

	const output = formatReport(options.reporter, result, {
		cwd,
		getSourceLines: createSourceLineReader(cwd),
		verbose: options.verbose,
		raw: options.raw,
	})
	if (output.length > 0) {
		options.log(output)
	}

	return result.stats.errors > 0 ? 1 : 0
}
