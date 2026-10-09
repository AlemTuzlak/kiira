import { readFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import {
	type KiiraConfig,
	type RuleSeverity,
	checkMarkdownFiles,
	collectExternalPackages,
	discoverMarkdownFiles,
	ensureExternalPackages,
	findConfigFile,
	loadConfig,
	loadConfigFile,
	resolveConfig,
} from "kiira-core"
import type { ReporterName } from "../args"
import { unifiedDiff } from "../diff"
import { toIgnoreGlobs, toIncludeGlobs } from "../entries"
import { applyConfigOverrides, applyFixes } from "../fix"
import { formatReport } from "../reporters"
import { startSpinner } from "../spinner"

interface RunCheckOptions {
	cwd: string
	files: string[]
	entry?: string[]
	ignore?: string[]
	config?: string
	/** Rule levels from `--rule`; they win over every config layer. */
	rules?: Record<string, RuleSeverity>
	reporter: ReporterName
	fix?: boolean
	/** With `fix`: print a diff instead of writing, and keep the exit code of the original check. */
	dryRun?: boolean
	verbose?: boolean
	raw?: boolean
	static?: boolean
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

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`

/**
 * Run `kiira check`. Returns the process exit code: 0 when clean, 1 when there
 * are validation errors. Configuration/runtime failures throw (the caller maps
 * those to exit code 2).
 */
export async function runCheck(options: RunCheckOptions): Promise<number> {
	const { cwd } = options

	const loaded: KiiraConfig = options.config
		? await loadConfigFile(isAbsolute(options.config) ? options.config : resolve(cwd, options.config))
		: await loadConfig(cwd)

	// Positional args and `--entry` are the directories/files/globs to check; they
	// replace the config's `include` and any preset includes. `--ignore` adds to
	// the config's `exclude`.
	const entries = [...options.files, ...(options.entry ?? [])]
	const exclude = [...(loaded.exclude ?? []), ...toIgnoreGlobs(cwd, options.ignore ?? [])]
	const config: KiiraConfig = { ...loaded, exclude }
	const files =
		entries.length > 0
			? await discoverMarkdownFiles({
					cwd,
					include: toIncludeGlobs(cwd, entries),
					exclude: resolveConfig(config, options.rules).exclude,
				})
			: undefined

	// Install any declared doc-only packages into the isolated cache so their
	// imports resolve during the check. Idempotent: a no-op when already current.
	const externalPackages = collectExternalPackages(config)
	if (Object.keys(externalPackages).length > 0) {
		await ensureExternalPackages(cwd, externalPackages, {
			warn: options.error,
			log: options.verbose ? options.log : undefined,
		})
	}

	// Run the (slow) checking under a spinner, deferring all output until it stops
	// so the spinner line and the report never interleave.
	const spinner = startSpinner("Checking Markdown…", { enabled: !options.static })
	const pending: Array<{ message: string; channel: "log" | "error" }> = []
	const queue = (message: string, channel: "log" | "error" = "log"): void => {
		pending.push({ message, channel })
	}
	let result: Awaited<ReturnType<typeof checkMarkdownFiles>>
	try {
		result = await checkMarkdownFiles({ cwd, config, files, ruleOverrides: options.rules })

		// `--fix`: rewrite mistagged fences, apply rule edits, add config overrides,
		// then re-check so the report reflects the corrected sources.
		if (options.fix) {
			const configPath = options.config
				? isAbsolute(options.config)
					? options.config
					: resolve(cwd, options.config)
				: findConfigFile(cwd)
			const dryRun = options.dryRun === true

			const fences = await applyFixes(cwd, result.diagnostics, result.sources, { dryRun })
			const overrides = await applyConfigOverrides(configPath, result.diagnostics, { dryRun })

			for (const { file, reason } of fences.refusals) {
				queue(`Skipped ${file}: ${reason}.`, "error")
			}

			if (dryRun) {
				// The diff goes to stderr under the JSON reporter so stdout stays one JSON document.
				const channel = options.reporter === "json" ? "error" : "log"
				for (const { file, before, after } of fences.changes) {
					queue(unifiedDiff(file, before, after).replace(/\n$/, ""), channel)
				}
				for (const override of overrides.applied) {
					queue(`Would add config override: ${JSON.stringify(override)}`, channel)
				}
				queue(
					`Dry run: would change ${plural(fences.filesChanged, "file")} (${plural(fences.editsApplied, "edit")}) and add ${plural(overrides.applied.length, "config override")}. Nothing was written.`,
					channel
				)
			} else if (fences.editsApplied > 0 || overrides.applied.length > 0) {
				const parts: string[] = []
				if (fences.fenceEditsApplied > 0) {
					parts.push(plural(fences.fenceEditsApplied, "fence"))
				}
				if (fences.editsApplied > fences.fenceEditsApplied) {
					parts.push(plural(fences.editsApplied - fences.fenceEditsApplied, "edit"))
				}
				if (overrides.applied.length > 0) {
					parts.push(plural(overrides.applied.length, "config override"))
				}
				queue(`Fixed ${parts.join(" and ")}.\n`)
				config.overrides = [...(config.overrides ?? []), ...overrides.applied]
				result = await checkMarkdownFiles({ cwd, config, files, ruleOverrides: options.rules })
			}

			if (overrides.manual.length > 0) {
				queue("Add these overrides to your Kiira config (config is not JSON, so apply manually):")
				for (const fix of overrides.manual) {
					const opts = Object.entries(fix.compilerOptions)
						.map(([k, v]) => `"${k}": "${v}"`)
						.join(", ")
					queue(`  { "include": ["${fix.include}"], ${opts} }`)
				}
			}
		}
	} finally {
		spinner.stop()
	}

	for (const { message, channel } of pending) {
		options[channel](message)
	}

	if (result.skipped && options.reporter === "pretty") {
		options.log("No files matched; nothing to check.")
		return 0
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
