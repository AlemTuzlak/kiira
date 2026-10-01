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
			const reason = error instanceof Error ? error.message : String(error)
			throw new Error(`The TypeScript hook of ${label} failed on ${input.file}: ${reason}`, { cause: error })
		}
		if (!result) {
			continue
		}
		outcome ??= { compilerOptions: {}, paths: {}, replaceTsconfig: false, filters: [] }
		if (result.compilerOptions) {
			const { options, errors } = ts.convertCompilerOptionsFromJson(result.compilerOptions, input.project.cwd)
			if (errors.length > 0) {
				const messages = errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ")
				throw new Error(`Invalid compilerOptions from the TypeScript hook of ${label} for ${input.file}: ${messages}`)
			}
			outcome.compilerOptions = { ...outcome.compilerOptions, ...options }
		}
		outcome.paths = { ...outcome.paths, ...result.paths }
		outcome.replaceTsconfig ||= result.replaceTsconfig === true
		if (result.filterDiagnostic) {
			outcome.filters.push(result.filterDiagnostic)
		}
	}
	return outcome
}

/** Layer a hook's compiler options, then its `paths` on top of the options' own, onto `options`. */
export function applyTypescriptHook(
	cwd: string,
	options: ts.CompilerOptions,
	hook: TypescriptHookOutcome
): ts.CompilerOptions {
	const next: ts.CompilerOptions = { ...options, ...hook.compilerOptions }
	if (Object.keys(hook.paths).length > 0) {
		next.paths = { ...next.paths, ...hook.paths }
		// Without a baseUrl, TypeScript resolves `paths` against the process cwd, not the project's.
		if (next.baseUrl === undefined && next.pathsBasePath === undefined) {
			next.pathsBasePath = cwd
		}
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
