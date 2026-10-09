import { resolve } from "node:path"
import type ts from "typescript"
import type {
	ExtractedSnippet,
	KiiraFs,
	KiiraProject,
	ResolvedKiiraConfig,
	TypescriptHookContext,
	TypescriptHookResult,
} from "./types"
import { getTypescript } from "./typescript"

type DiagnosticFilter = NonNullable<TypescriptHookResult["filterDiagnostic"]>

/** The merged result of every TypeScript hook for one document. */
export interface TypescriptHookOutcome {
	/** Converted compiler options, shallow-merged in hook order. */
	compilerOptions: ts.CompilerOptions
	paths: Record<string, string[]>
	replaceTsconfig: boolean
	filters: DiagnosticFilter[]
}

interface NamedHook {
	label: string
	run: (file: string, ctx: TypescriptHookContext) => TypescriptHookResult | undefined
}

/** The error a failing hook or filter throws, naming who failed on which file. */
function hookFailure(what: string, file: string, error: unknown): Error {
	const reason = error instanceof Error ? error.message : String(error)
	return new Error(`${what} failed on ${file}: ${reason}`, { cause: error })
}

/** `extra` on top of `base` per key, except `*`, whose targets are added after `base`'s fallbacks. */
function mergePaths(base: Record<string, string[]>, extra: Record<string, string[]>): Record<string, string[]> {
	const merged = { ...base, ...extra }
	if (base["*"] && extra["*"]) {
		merged["*"] = [...base["*"], ...extra["*"]]
	}
	return merged
}

/** Presets' hooks in preset order, then plugins' hooks in plugin order. */
function hooksOf(resolved: ResolvedKiiraConfig): NamedHook[] {
	const hooks: NamedHook[] = []
	for (const preset of resolved.presets) {
		if (preset.typescript) {
			hooks.push({ label: `preset "${preset.name}"`, run: preset.typescript })
		}
	}
	for (const plugin of resolved.plugins) {
		if (plugin.typescript) {
			hooks.push({ label: `plugin "${plugin.name}"`, run: plugin.typescript })
		}
	}
	return hooks
}

export function hasTypescriptHooks(resolved: ResolvedKiiraConfig): boolean {
	return hooksOf(resolved).length > 0
}

/** Run every hook for one document and merge their results; `undefined` when none returned anything. */
export function runTypescriptHooks(
	resolved: ResolvedKiiraConfig,
	input: { file: string; text: string; snippets: ExtractedSnippet[]; project: KiiraProject; fs: KiiraFs }
): TypescriptHookOutcome | undefined {
	const ts = getTypescript()
	let outcome: TypescriptHookOutcome | undefined
	for (const { label, run } of hooksOf(resolved)) {
		let result: TypescriptHookResult | undefined
		try {
			result = run(input.file, input)
		} catch (error) {
			throw hookFailure(`The TypeScript hook of ${label}`, input.file, error)
		}
		if (!result) {
			continue
		}
		outcome ??= { compilerOptions: {}, paths: {}, replaceTsconfig: false, filters: [] }
		if (result.compilerOptions) {
			// A shallow merge would replace the workspace and external-package mappings.
			for (const key of ["paths", "baseUrl"]) {
				if (key in result.compilerOptions) {
					throw new Error(
						`The TypeScript hook of ${label} sets compilerOptions.${key} for ${input.file}; return the mappings in the hook's \`paths\` field instead.`
					)
				}
			}
			const { options, errors } = ts.convertCompilerOptionsFromJson(result.compilerOptions, input.project.cwd)
			if (errors.length > 0) {
				const messages = errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ")
				throw new Error(`Invalid compilerOptions from the TypeScript hook of ${label} for ${input.file}: ${messages}`)
			}
			outcome.compilerOptions = { ...outcome.compilerOptions, ...options }
		}
		outcome.paths = mergePaths(outcome.paths, result.paths ?? {})
		outcome.replaceTsconfig ||= result.replaceTsconfig === true
		const filter = result.filterDiagnostic
		if (filter) {
			outcome.filters.push((diagnostic, info) => {
				try {
					return filter(diagnostic, info)
				} catch (error) {
					throw hookFailure(`The filterDiagnostic of ${label}`, info.file, error)
				}
			})
		}
	}
	return outcome
}

/**
 * Layer a hook's compiler options, then its `paths` on top of the options' own, onto
 * `options`. The hook's path values resolve from `cwd` to absolute paths, so a project
 * `baseUrl` never moves them.
 */
export function applyTypescriptHook(
	cwd: string,
	options: ts.CompilerOptions,
	hook: TypescriptHookOutcome
): ts.CompilerOptions {
	const next: ts.CompilerOptions = { ...options, ...hook.compilerOptions }
	if (Object.keys(hook.paths).length > 0) {
		const absolute = Object.fromEntries(
			Object.entries(hook.paths).map(([key, targets]) => [
				key,
				targets.map((target) => resolve(cwd, target).replace(/\\/g, "/")),
			])
		)
		next.paths = mergePaths(next.paths ?? {}, absolute)
	}
	return next
}

/** JSON with sorted keys, skipping functions, so equal options give equal keys. */
export function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
		}
		return typeof v === "function" ? undefined : v
	})
}
