import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { createJiti } from "jiti"
import type { ResolvedTypedownConfig, TypedownConfig, TypedownLanguage } from "./types"

export const DEFAULT_LANGUAGES: TypedownLanguage[] = ["ts", "tsx", "js", "jsx"]

/**
 * Fence language identifiers recognized for each TypedownLanguage. The first
 * entry is the canonical id. Used both to seed `codeFenceLanguages` defaults and
 * (inverted) to normalize a fence's language during extraction.
 */
export const FENCE_ALIASES: Record<TypedownLanguage, string[]> = {
	ts: ["ts", "typescript"],
	tsx: ["tsx", "typescriptreact"],
	js: ["js", "javascript", "mjs", "cjs"],
	jsx: ["jsx", "javascriptreact"],
}

/** Config files Typedown looks for, in priority order. */
export const CONFIG_FILENAMES = [
	"typedown.config.ts",
	"typedown.config.mts",
	"typedown.config.mjs",
	"typedown.config.js",
	"typedown.config.cjs",
	"typedown.config.json",
]

/** Identity helper that gives editors full type-checking and autocomplete. */
export function defineConfig(config: TypedownConfig): TypedownConfig {
	return config
}

/** Apply defaults to a (possibly partial) config so the pipeline never re-checks for them. */
export function resolveConfig(config: Partial<TypedownConfig> = {}): ResolvedTypedownConfig {
	const languages = config.languages ?? DEFAULT_LANGUAGES
	return {
		include: config.include ?? ["**/*.md"],
		exclude: config.exclude ?? [],
		tsconfig: config.tsconfig,
		packageMode: config.packageMode ?? "workspace",
		defaultValidate: config.defaultValidate ?? "type",
		defaultFixture: config.defaultFixture,
		checkUnusedSymbols: config.checkUnusedSymbols ?? false,
		fixtures: config.fixtures ?? {},
		languages,
		markdown: {
			// Default to each configured language plus its known aliases, so
			// ```typescript / ```javascript fences work out of the box.
			codeFenceLanguages: config.markdown?.codeFenceLanguages ?? [
				...new Set(languages.flatMap((l) => FENCE_ALIASES[l] ?? [l])),
			],
		},
	}
}

/** Find the first existing Typedown config file in `cwd`, or `null`. */
export function findConfigFile(cwd: string): string | null {
	for (const name of CONFIG_FILENAMES) {
		const candidate = join(cwd, name)
		if (existsSync(candidate)) {
			return candidate
		}
	}
	return null
}

/**
 * Load a Typedown config from an explicit file path. Supports
 * `.ts`/`.mts`/`.mjs`/`.js`/`.cjs` (via jiti) and `.json`.
 */
export async function loadConfigFile(filepath: string): Promise<TypedownConfig> {
	if (filepath.endsWith(".json")) {
		const raw = await readFile(filepath, "utf8")
		return JSON.parse(raw) as TypedownConfig
	}

	// Resolve bare imports (e.g. `@typedown/core`) relative to the config's directory.
	const jiti = createJiti(pathToFileURL(join(dirname(filepath), "__typedown_config__.js")).href)
	return jiti.import<TypedownConfig>(filepath, { default: true })
}

/**
 * Load the Typedown config from `cwd` by auto-discovering a config file.
 * Returns a minimal default config when none is found.
 */
export async function loadConfig(cwd: string): Promise<TypedownConfig> {
	const filepath = findConfigFile(cwd)
	if (!filepath) {
		return { include: ["**/*.md"] }
	}
	return loadConfigFile(filepath)
}
