import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { createJiti } from "jiti"
import type { KiiraConfig, KiiraLanguage, ResolvedKiiraConfig } from "./types"

export const DEFAULT_LANGUAGES: KiiraLanguage[] = ["ts", "tsx", "js", "jsx"]

/**
 * Fence language identifiers recognized for each KiiraLanguage. The first
 * entry is the canonical id. Used both to seed `codeFenceLanguages` defaults and
 * (inverted) to normalize a fence's language during extraction.
 */
export const FENCE_ALIASES: Record<KiiraLanguage, string[]> = {
	ts: ["ts", "typescript"],
	tsx: ["tsx", "typescriptreact"],
	js: ["js", "javascript", "mjs", "cjs"],
	jsx: ["jsx", "javascriptreact"],
}

/** Config files Kiira looks for, in priority order. */
export const CONFIG_FILENAMES = [
	"kiira.config.ts",
	"kiira.config.mts",
	"kiira.config.mjs",
	"kiira.config.js",
	"kiira.config.cjs",
	"kiira.config.json",
]

/** Identity helper that gives editors full type-checking and autocomplete. */
export function defineConfig(config: KiiraConfig): KiiraConfig {
	return config
}

/** Apply defaults to a (possibly partial) config so the pipeline never re-checks for them. */
export function resolveConfig(config: Partial<KiiraConfig> = {}): ResolvedKiiraConfig {
	const languages = config.languages ?? DEFAULT_LANGUAGES
	return {
		include: config.include ?? ["**/*.md"],
		exclude: config.exclude ?? [],
		tsconfig: config.tsconfig,
		overrides: config.overrides ?? [],
		packageMode: config.packageMode ?? "workspace",
		defaultValidate: config.defaultValidate ?? "type",
		defaultFixture: config.defaultFixture,
		checkUnusedSymbols: config.checkUnusedSymbols ?? false,
		checkRelativeImports: config.checkRelativeImports ?? false,
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

/** Find the first existing Kiira config file in `cwd`, or `null`. */
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
 * Load a Kiira config from an explicit file path. Supports
 * `.ts`/`.mts`/`.mjs`/`.js`/`.cjs` (via jiti) and `.json`.
 */
export async function loadConfigFile(filepath: string): Promise<KiiraConfig> {
	if (filepath.endsWith(".json")) {
		const raw = await readFile(filepath, "utf8")
		return JSON.parse(raw) as KiiraConfig
	}

	// Resolve bare imports (e.g. `kiira-core`) relative to the config's directory.
	const jiti = createJiti(pathToFileURL(join(dirname(filepath), "__kiira_config__.js")).href)
	return jiti.import<KiiraConfig>(filepath, { default: true })
}

/**
 * Load the Kiira config from `cwd` by auto-discovering a config file.
 * Returns a minimal default config when none is found.
 */
export async function loadConfig(cwd: string): Promise<KiiraConfig> {
	const filepath = findConfigFile(cwd)
	if (!filepath) {
		return { include: ["**/*.md"] }
	}
	return loadConfigFile(filepath)
}
