import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import picomatch from "picomatch"
import { builtinPlugin } from "./rules/builtin"
import type {
	KiiraConfig,
	KiiraLanguage,
	KiiraOverride,
	KiiraPlugin,
	KiiraPreset,
	KiiraRule,
	ResolvedKiiraConfig,
	ResolvedRuleSetting,
	RuleScope,
	RuleSetting,
	RuleSeverity,
} from "./types"

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

const RULE_SEVERITIES = new Set<RuleSeverity>(["off", "warn", "error"])
const RULE_SCOPES = new Set<RuleScope>(["document", "program", "project"])

function listKnown(ids: string[]): string {
	return ids.length > 0 ? ids.join(", ") : "(none)"
}

/** Register every rule from the built-in plugin (unprefixed) and the user plugins (`<plugin>/<rule>`). */
function buildRuleRegistry(plugins: KiiraPlugin[]): Record<string, KiiraRule> {
	const registry: Record<string, KiiraRule> = {}
	for (const plugin of [builtinPlugin, ...plugins]) {
		if (typeof plugin?.name !== "string" || plugin.name.length === 0) {
			throw new Error("Each Kiira plugin needs a non-empty `name`.")
		}
		for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
			const id = plugin === builtinPlugin ? name : `${plugin.name}/${name}`
			if (registry[id]) {
				throw new Error(`Rule "${id}" is defined twice.`)
			}
			if (!rule?.meta || typeof rule.create !== "function") {
				throw new Error(`Rule "${id}" must be created with defineRule (missing meta or create).`)
			}
			// Plain-JS plugins skip the types, so check the two fields the runner keys on.
			if (!RULE_SCOPES.has(rule.meta.scope)) {
				throw new Error(
					`Rule "${id}" has an invalid scope ${JSON.stringify(rule.meta.scope)}. Expected "document", "program", or "project".`
				)
			}
			if (!RULE_SEVERITIES.has(rule.meta.defaultSeverity)) {
				throw new Error(
					`Rule "${id}" has an invalid defaultSeverity ${JSON.stringify(rule.meta.defaultSeverity)}. Expected "off", "warn", or "error".`
				)
			}
			registry[id] = rule
		}
	}
	return registry
}

function buildPresetRegistry(plugins: KiiraPlugin[]): Record<string, KiiraPreset> {
	const registry: Record<string, KiiraPreset> = {}
	for (const plugin of [builtinPlugin, ...plugins]) {
		for (const preset of plugin.presets ?? []) {
			const id = plugin === builtinPlugin ? preset.name : `${plugin.name}/${preset.name}`
			if (registry[id]) {
				throw new Error(`Preset "${id}" is defined twice.`)
			}
			registry[id] = preset
		}
	}
	return registry
}

/**
 * Resolve preset references to objects, flattening each preset's `extends`
 * in front of it (depth-first, in order). A preset is identified by its registry
 * id, or by object identity when inline; each one is applied once, at its first
 * occurrence, so a shared base cannot overwrite a sibling. A cycle is a config error.
 */
function resolvePresets(
	refs: (string | KiiraPreset)[],
	registry: Record<string, KiiraPreset>,
	stack: (string | KiiraPreset)[] = [],
	seen = new Set<string | KiiraPreset>()
): KiiraPreset[] {
	const out: KiiraPreset[] = []
	const label = (key: string | KiiraPreset) => (typeof key === "string" ? key : key.name)
	for (const ref of refs) {
		let preset: KiiraPreset
		if (typeof ref === "string") {
			const found = registry[ref]
			if (!found) {
				throw new Error(`Unknown preset "${ref}". Known presets: ${listKnown(Object.keys(registry))}.`)
			}
			preset = found
		} else {
			if (typeof ref?.name !== "string" || ref.name.length === 0) {
				throw new Error("Each inline preset needs a non-empty `name`.")
			}
			preset = ref
		}
		if (stack.includes(ref)) {
			throw new Error(`Preset "${label(ref)}" extends itself (via ${[...stack, ref].map(label).join(" -> ")}).`)
		}
		if (seen.has(ref)) {
			continue
		}
		seen.add(ref)
		if (preset.extends && preset.extends.length > 0) {
			out.push(...resolvePresets(preset.extends, registry, [...stack, ref], seen))
		}
		out.push(preset)
	}
	return out
}

/** Reject `options` the rule's `validate` refuses. A rule that needs options sees `undefined` when none were given. */
function checkOptions(id: string, options: unknown, registry: Record<string, KiiraRule>, where: string): void {
	const problem = registry[id]?.meta.options?.validate?.(options)
	if (problem) {
		throw new Error(`Invalid options for rule "${id}" in ${where}: ${problem}`)
	}
}

/** Validate one `rules` entry against the registry. A level without options carries `options: undefined`. */
function normalizeRuleSetting(
	id: string,
	setting: RuleSetting,
	registry: Record<string, KiiraRule>,
	where: string
): ResolvedRuleSetting {
	const rule = registry[id]
	if (!rule) {
		throw new Error(`Unknown rule "${id}" in ${where}. Known rules: ${listKnown(Object.keys(registry))}.`)
	}
	const [severity, options] = Array.isArray(setting) ? setting : [setting, undefined]
	if (!RULE_SEVERITIES.has(severity)) {
		throw new Error(
			`Invalid level ${JSON.stringify(severity)} for rule "${id}" in ${where}. Expected "off", "warn", or "error".`
		)
	}
	if (Array.isArray(setting) && setting.length !== 2) {
		throw new Error(`Rule "${id}" in ${where} must be a level or a [level, options] pair.`)
	}
	if (Array.isArray(setting)) {
		checkOptions(id, options, registry, where)
	}
	return { severity, options }
}

/** Layer a `rules` map onto `base` (copy-on-write). A level without options keeps the options set below it. */
function applyRules(
	base: Record<string, ResolvedRuleSetting>,
	rules: Record<string, RuleSetting> | undefined,
	registry: Record<string, KiiraRule>,
	where: string
): Record<string, ResolvedRuleSetting> {
	if (!rules) {
		return base
	}
	const next = { ...base }
	for (const [id, setting] of Object.entries(rules)) {
		const normalized = normalizeRuleSetting(id, setting, registry, where)
		if (Array.isArray(setting)) {
			next[id] = normalized
		} else {
			// A bare level keeps the options below it, so those are what an enabled rule must accept.
			if (normalized.severity !== "off") {
				checkOptions(id, base[id]?.options, registry, where)
			}
			next[id] = { severity: normalized.severity, options: base[id]?.options }
		}
	}
	return next
}

function isResolved(config: Partial<KiiraConfig> | ResolvedKiiraConfig): config is ResolvedKiiraConfig {
	return "ruleRegistry" in config && typeof config.ruleRegistry === "object"
}

/** Validate the CLI `--rule` levels against the registry. */
function validateRuleOverrides(
	ruleOverrides: Record<string, RuleSeverity>,
	registry: Record<string, KiiraRule>
): Record<string, RuleSeverity> {
	for (const [id, severity] of Object.entries(ruleOverrides)) {
		normalizeRuleSetting(id, severity, registry, "--rule")
	}
	return ruleOverrides
}

/**
 * Apply defaults to a (possibly partial) config so the pipeline never re-checks
 * for them, and resolve plugins, presets, and rule settings. Merge order for
 * rules: built-in defaults → presets (in order, `extends` first) → `rules` and
 * the legacy `checkUnusedSymbols`/`checkRelativeImports` toggles → matching
 * `overrides` (see {@link rulesForFile}) → `ruleOverrides`, the CLI `--rule` flags.
 *
 * Unknown rule ids, unknown presets, and invalid option shapes throw. Passing an
 * already-resolved config returns it unchanged, apart from `ruleOverrides` when given.
 */
export function resolveConfig(
	config: Partial<KiiraConfig> | ResolvedKiiraConfig = {},
	ruleOverrides?: Record<string, RuleSeverity>
): ResolvedKiiraConfig {
	if (isResolved(config)) {
		return ruleOverrides
			? { ...config, ruleOverrides: validateRuleOverrides(ruleOverrides, config.ruleRegistry) }
			: config
	}
	const languages = config.languages ?? DEFAULT_LANGUAGES
	const plugins = config.plugins ?? []
	const ruleRegistry = buildRuleRegistry(plugins)
	const presetRegistry = buildPresetRegistry(plugins)
	const presets = resolvePresets(config.presets ?? [], presetRegistry)
	const cliRules = validateRuleOverrides(ruleOverrides ?? {}, ruleRegistry)

	let rules: Record<string, ResolvedRuleSetting> = {}
	for (const [id, rule] of Object.entries(ruleRegistry)) {
		rules[id] = { severity: rule.meta.defaultSeverity, options: rule.meta.options?.default }
	}
	for (const preset of presets) {
		rules = applyRules(rules, preset.rules, ruleRegistry, `preset "${preset.name}"`)
	}
	// The legacy boolean toggles are aliases of the two built-in toggle rules; an
	// explicit `rules` entry for the same id wins.
	const legacy: Record<string, RuleSetting> = {}
	if (config.checkUnusedSymbols !== undefined && !config.rules?.["unused-symbols"]) {
		legacy["unused-symbols"] = config.checkUnusedSymbols ? "error" : "off"
	}
	if (config.checkRelativeImports !== undefined && !config.rules?.["relative-imports"]) {
		legacy["relative-imports"] = config.checkRelativeImports ? "error" : "off"
	}
	rules = applyRules(rules, { ...legacy, ...(config.rules ?? {}) }, ruleRegistry, "`rules`")

	const overrides: KiiraOverride[] = (config.overrides ?? []).map((override) => {
		const where = `override ${JSON.stringify(override.include)}`
		const overridePresets = resolvePresets(override.presets ?? [], presetRegistry)
		let layered = rules
		for (const preset of overridePresets) {
			layered = applyRules(layered, preset.rules, ruleRegistry, `preset "${preset.name}" in ${where}`)
		}
		applyRules(layered, override.rules, ruleRegistry, where)
		return override.presets ? { ...override, presets: overridePresets } : override
	})

	const presetIncludes = presets.flatMap((p) => (Array.isArray(p.include) ? p.include : []))
	const hasPresetInclude = presets.some((p) => p.include !== undefined)
	const include = [...(config.include ?? []), ...presetIncludes]
	const codeFenceLanguages = config.markdown?.codeFenceLanguages ??
		[...presets].reverse().find((p) => p.codeFenceLanguages)?.codeFenceLanguages ?? [
			// Default to each configured language plus its known aliases, so
			// ```typescript / ```javascript fences work out of the box.
			...new Set(languages.flatMap((l) => FENCE_ALIASES[l] ?? [l])),
		]
	// The two compiler-option toggles are base-level, so they see the CLI level too.
	const isOn = (id: string): boolean => (cliRules[id] ?? rules[id]?.severity) !== "off"

	return {
		include: config.include === undefined && !hasPresetInclude ? ["**/*.{md,mdx}"] : include,
		exclude: [...(config.exclude ?? []), ...presets.flatMap((p) => p.exclude ?? [])],
		allowEmpty: presets.some((p) => p.allowEmpty === true),
		tsconfig: config.tsconfig,
		engine: config.engine ?? "auto",
		overrides,
		packageMode: config.packageMode ?? "workspace",
		workspacePackageResolution: config.workspacePackageResolution ?? "exhaustive",
		defaultValidate: config.defaultValidate ?? "type",
		defaultFixture: config.defaultFixture,
		defaultGroup: config.defaultGroup ?? "none",
		checkUnusedSymbols: isOn("unused-symbols"),
		checkRelativeImports: isOn("relative-imports"),
		externalPackages: config.externalPackages ?? {},
		fixtures: config.fixtures ?? {},
		languages,
		markdown: { codeFenceLanguages },
		plugins,
		presets,
		ruleRegistry,
		ruleSettings: rules,
		ruleOverrides: cliRules,
	}
}

// --- per-config memoization ---
//
// Compiling an override's `include` glob costs tens of microseconds; the pipeline
// asks "does this override match this file?" several times per file (extraction,
// rule levels per scope, toggle filtering, partitioning, grouping), so the compiled
// matcher is kept on the override object, and the per-file rule settings on the
// resolved config. Both are WeakMaps keyed by object identity: a new config or
// override is a new entry, so nothing is ever stale.

const overrideMatchers = new WeakMap<KiiraOverride, (file: string) => boolean>()

/** The compiled `include` matcher for an override, built once per override object. */
export function overrideMatcher(override: KiiraOverride): (file: string) => boolean {
	let matcher = overrideMatchers.get(override)
	if (!matcher) {
		matcher = picomatch(override.include)
		overrideMatchers.set(override, matcher)
	}
	return matcher
}

/** Overrides whose `include` glob matches `markdownFile`, in config order. */
function matchingOverrides(resolved: ResolvedKiiraConfig, markdownFile: string): KiiraOverride[] {
	return resolved.overrides.filter((override) => overrideMatcher(override)(markdownFile))
}

const ruleSettingsByFile = new WeakMap<
	ResolvedKiiraConfig,
	Map<string | undefined, Record<string, ResolvedRuleSetting>>
>()

/**
 * The effective rule settings: the resolved base, then (for `markdownFile`) each
 * matching override's presets and `rules` in order, then the CLI `--rule` levels,
 * which win over everything. Without a file only the base and CLI layers apply
 * (project-scope rules have no file).
 */
export function rulesForFile(
	resolved: ResolvedKiiraConfig,
	markdownFile?: string
): Record<string, ResolvedRuleSetting> {
	let byFile = ruleSettingsByFile.get(resolved)
	if (!byFile) {
		byFile = new Map()
		ruleSettingsByFile.set(resolved, byFile)
	}
	let rules = byFile.get(markdownFile)
	if (!rules) {
		rules = freezeRuleSettings(computeRulesForFile(resolved, markdownFile))
		byFile.set(markdownFile, rules)
	}
	return rules
}

// The cached settings are shared by every later call for the same file, and rules
// receive `options` from them, so a rule that mutates its options would leak the
// change into other runs. Freeze them instead.
function freezeRuleSettings(rules: Record<string, ResolvedRuleSetting>): Record<string, ResolvedRuleSetting> {
	for (const setting of Object.values(rules)) {
		deepFreeze(setting.options)
		Object.freeze(setting)
	}
	return Object.freeze(rules)
}

/** Freeze plain objects and arrays recursively; class instances (RegExp, Map, ...) are left alone. */
function deepFreeze(value: unknown): void {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return
	}
	const proto = Object.getPrototypeOf(value)
	if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
		return
	}
	Object.freeze(value)
	for (const child of Object.values(value)) {
		deepFreeze(child)
	}
}

function computeRulesForFile(
	resolved: ResolvedKiiraConfig,
	markdownFile: string | undefined
): Record<string, ResolvedRuleSetting> {
	let rules = resolved.ruleSettings
	for (const override of markdownFile === undefined ? [] : matchingOverrides(resolved, markdownFile)) {
		const where = `override ${JSON.stringify(override.include)}`
		for (const preset of (override.presets ?? []) as KiiraPreset[]) {
			rules = applyRules(rules, preset.rules, resolved.ruleRegistry, `preset "${preset.name}" in ${where}`)
		}
		rules = applyRules(rules, override.rules, resolved.ruleRegistry, where)
	}
	const cli = Object.entries(resolved.ruleOverrides)
	if (cli.length > 0) {
		rules = { ...rules }
		for (const [id, severity] of cli) {
			if (severity !== "off") {
				checkOptions(id, rules[id]?.options, resolved.ruleRegistry, "--rule")
			}
			rules[id] = { severity, options: rules[id]?.options }
		}
	}
	return rules
}

/** The fence identifiers recognized in `markdownFile`: the last matching override's, else the global set. */
export function codeFenceLanguagesForFile(resolved: ResolvedKiiraConfig, markdownFile: string): string[] {
	let languages = resolved.markdown.codeFenceLanguages
	for (const override of matchingOverrides(resolved, markdownFile)) {
		for (const preset of (override.presets ?? []) as KiiraPreset[]) {
			languages = preset.codeFenceLanguages ?? languages
		}
		languages = override.codeFenceLanguages ?? languages
	}
	return languages
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

/** How a non-JSON config is imported; overridable so tests can simulate a missing `jiti`. */
interface ConfigImporters {
	loadJiti?: () => Promise<{
		createJiti: (url: string) => { import: <T>(id: string, options: { default: true }) => Promise<T> }
	}>
	importNative?: (url: string) => Promise<unknown>
}

const TS_CONFIG_EXTENSION = /\.[cm]?ts$/

/**
 * Load a Kiira config from an explicit file path. Supports
 * `.ts`/`.mts`/`.mjs`/`.js`/`.cjs` (via jiti when installed, else a native
 * `import()`) and `.json`.
 */
export async function loadConfigFile(filepath: string, importers: ConfigImporters = {}): Promise<KiiraConfig> {
	if (filepath.endsWith(".json")) {
		const raw = await readFile(filepath, "utf8")
		return JSON.parse(raw) as KiiraConfig
	}

	const { loadJiti = () => import("jiti"), importNative = (url) => import(url) } = importers

	let jiti: Awaited<ReturnType<typeof loadJiti>> | undefined
	try {
		jiti = await loadJiti()
	} catch (error) {
		// `jiti` is an optional peer; fall back to a native import below only when it is missing.
		const code = (error as { code?: unknown } | null)?.code
		if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
			throw error
		}
	}

	if (jiti) {
		// Resolve bare imports (e.g. `kiira-core`) relative to the config's directory.
		const loader = jiti.createJiti(pathToFileURL(join(dirname(filepath), "__kiira_config__.js")).href)
		return loader.import<KiiraConfig>(filepath, { default: true })
	}

	try {
		const mod = (await importNative(pathToFileURL(filepath).href)) as { default?: KiiraConfig }
		return mod.default ?? (mod as KiiraConfig)
	} catch (error) {
		if (TS_CONFIG_EXTENSION.test(filepath)) {
			throw new Error(
				'Loading a TypeScript Kiira config needs the "jiti" package or a Node version that strips types natively.',
				{ cause: error }
			)
		}
		throw error
	}
}

/**
 * Load the Kiira config from `cwd` by auto-discovering a config file.
 * Returns a minimal default config when none is found.
 */
export async function loadConfig(cwd: string): Promise<KiiraConfig> {
	const filepath = findConfigFile(cwd)
	if (!filepath) {
		return { include: ["**/*.{md,mdx}"] }
	}
	return loadConfigFile(filepath)
}
