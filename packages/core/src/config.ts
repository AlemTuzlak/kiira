import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createJiti } from "jiti"
import type { ResolvedTypedownConfig, TypedownConfig, TypedownLanguage } from "./types"

export const DEFAULT_LANGUAGES: TypedownLanguage[] = ["ts", "tsx", "js", "jsx"]

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
		fixtures: config.fixtures ?? {},
		languages,
		markdown: {
			codeFenceLanguages: config.markdown?.codeFenceLanguages ?? [...languages],
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
 * Load the Typedown config from `cwd`. Supports `.ts`/`.mts`/`.mjs`/`.js`/`.cjs`
 * (via jiti) and `.json`. Returns a minimal default config when none is found.
 */
export async function loadConfig(cwd: string): Promise<TypedownConfig> {
	const filepath = findConfigFile(cwd)
	if (!filepath) {
		return { include: ["**/*.md"] }
	}

	if (filepath.endsWith(".json")) {
		const raw = await readFile(filepath, "utf8")
		return JSON.parse(raw) as TypedownConfig
	}

	// Resolve bare imports (e.g. `@typedown/core`) from the user's project root.
	const jiti = createJiti(pathToFileURL(join(cwd, "__typedown_config__.js")).href)
	const loaded = await jiti.import<TypedownConfig>(filepath, { default: true })
	return loaded
}
