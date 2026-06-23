import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun"

/** Detect the package manager to use for the isolated install, from `cwd`'s lockfile. */
export function detectPackageManager(cwd: string): PackageManager {
	if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) {
		return "bun"
	}
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
		return "pnpm"
	}
	if (existsSync(join(cwd, "yarn.lock"))) {
		return "yarn"
	}
	return "npm"
}

function toPosix(path: string): string {
	return path.split(sep).join("/").split("\\").join("/")
}

/** Name of the hidden cache directory inside `node_modules`. */
export const EXTERNAL_CACHE_DIRNAME = ".kiira"

/** Absolute path to the isolated external-packages cache for `cwd`. */
export function externalCacheDir(cwd: string): string {
	return join(cwd, "node_modules", EXTERNAL_CACHE_DIRNAME)
}

/** Merge top-level and per-override `externalPackages` into one set (override wins on conflict). */
export function collectExternalPackages(config: {
	externalPackages?: Record<string, string>
	overrides?: Array<{ externalPackages?: Record<string, string> }>
}): Record<string, string> {
	const merged: Record<string, string> = { ...(config.externalPackages ?? {}) }
	for (const override of config.overrides ?? []) {
		Object.assign(merged, override.externalPackages ?? {})
	}
	return merged
}

export interface ExternalResolution {
	/** `paths["*"]` fallback glob pointing at the cache's installed packages. */
	nodeModulesGlob: string
	/** `@types` directory inside the cache, when present. */
	typeRoots: string[]
}

/**
 * Pure resolution helper: describe how to wire the *already-installed* external
 * cache into TypeScript options. Returns `undefined` when nothing is declared or
 * the cache has not been populated yet (so callers add nothing).
 */
export function externalResolution(cwd: string, packages: Record<string, string>): ExternalResolution | undefined {
	if (Object.keys(packages).length === 0) {
		return undefined
	}
	const nodeModules = join(externalCacheDir(cwd), "node_modules")
	if (!existsSync(nodeModules)) {
		return undefined
	}
	const typesDir = join(nodeModules, "@types")
	return {
		nodeModulesGlob: `${toPosix(nodeModules)}/*`,
		typeRoots: existsSync(typesDir) ? [toPosix(typesDir)] : [],
	}
}

/** Runs an install command in a directory; returns success + combined output. Injectable for tests. */
export type InstallRunner = (cmd: string, args: string[], cwd: string) => { ok: boolean; output: string }

export interface EnsureExternalOptions {
	runInstall?: InstallRunner
	warn?: (message: string) => void
	log?: (message: string) => void
}

// Install command per package manager. npm is also the universal fallback.
// ponytail: bare install args, no per-PM isolation matrix; --ignore-workspace
// is the one flag needed to stop pnpm inheriting the parent monorepo.
const INSTALL_COMMANDS: Record<PackageManager, { cmd: string; args: string[] }> = {
	npm: { cmd: "npm", args: ["install", "--no-audit", "--no-fund"] },
	pnpm: { cmd: "pnpm", args: ["install", "--ignore-workspace"] },
	yarn: { cmd: "yarn", args: ["install"] },
	bun: { cmd: "bun", args: ["install"] },
}

// ponytail: shell:true because npm/pnpm/yarn are .cmd shims on Windows that
// spawnSync can't exec directly otherwise. Pass the full command as one string
// (not cmd+args[]) — that's the correct shell:true form and avoids Node's
// DEP0190 warning. Injection is a non-issue: the config that supplies these
// values is itself executable code (loaded via jiti).
const defaultRunInstall: InstallRunner = (cmd, args, cwd) => {
	const result = spawnSync([cmd, ...args].join(" "), { cwd, encoding: "utf8", shell: true })
	return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

function depsUnchanged(pkgJsonPath: string, packages: Record<string, string>): boolean {
	if (!existsSync(pkgJsonPath)) {
		return false
	}
	try {
		const existing = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { dependencies?: Record<string, string> }
		const prev = existing.dependencies ?? {}
		const prevKeys = Object.keys(prev)
		const nextKeys = Object.keys(packages)
		return prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === packages[k])
	} catch {
		return false
	}
}

/**
 * Ensure the declared external packages are installed in the isolated cache
 * (`node_modules/.kiira`). Idempotent: skips the install when the cache's
 * `package.json` already declares exactly these deps and its `node_modules`
 * exists. On install failure it warns (via `options.warn`) and returns without
 * throwing — the missing types then surface as the usual TS2307.
 *
 * Side-effecting (spawns a package manager): call from the CLI, not the editor.
 */
export async function ensureExternalPackages(
	cwd: string,
	packages: Record<string, string>,
	options: EnsureExternalOptions = {}
): Promise<void> {
	if (Object.keys(packages).length === 0) {
		return
	}

	const runInstall = options.runInstall ?? defaultRunInstall
	const warn = options.warn ?? (() => {})
	const log = options.log ?? (() => {})

	const cacheDir = externalCacheDir(cwd)
	const pkgJsonPath = join(cacheDir, "package.json")
	const nodeModules = join(cacheDir, "node_modules")

	if (depsUnchanged(pkgJsonPath, packages) && existsSync(nodeModules)) {
		return
	}

	mkdirSync(cacheDir, { recursive: true })
	writeFileSync(
		pkgJsonPath,
		`${JSON.stringify({ name: ".kiira", private: true, version: "0.0.0", dependencies: packages }, null, 2)}\n`
	)

	const attempt = (cmd: string, args: string[]) => ({
		result: runInstall(cmd, args, cacheDir),
		label: `${cmd} ${args.join(" ")}`,
	})

	const pm = detectPackageManager(cwd)
	log(`Installing ${Object.keys(packages).length} external package(s) with ${pm}…`)
	const primary = INSTALL_COMMANDS[pm]
	let { result, label } = attempt(primary.cmd, primary.args)

	if (!result.ok && pm !== "npm") {
		log(`${pm} install failed; retrying with npm…`)
		;({ result, label } = attempt(INSTALL_COMMANDS.npm.cmd, INSTALL_COMMANDS.npm.args))
	}

	if (!result.ok) {
		warn(
			`Kiira failed to install external packages into ${cacheDir} (\`${label}\` failed). Imports of these packages will not resolve.\n${result.output}`.trim()
		)
	}
}
