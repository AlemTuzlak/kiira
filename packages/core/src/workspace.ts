import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, sep } from "node:path"
import { glob } from "tinyglobby"

export interface WorkspacePackage {
	name: string
	/** Absolute path to the package directory. */
	dir: string
}

export interface WorkspaceResolution {
	baseUrl: string
	paths: Record<string, string[]>
}

function toPosix(path: string): string {
	return path.split(sep).join("/").split("\\").join("/")
}

/** Extract the `packages:` globs from a pnpm-workspace.yaml without a YAML dependency. */
export function parsePnpmWorkspacePackages(yaml: string): string[] {
	const globs: string[] = []
	let inPackages = false
	for (const line of yaml.split(/\r?\n/)) {
		if (/^packages:\s*(#.*)?$/.test(line)) {
			inPackages = true
			continue
		}
		if (!inPackages) {
			continue
		}
		const item = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/)
		if (item?.[1]) {
			globs.push(item[1].trim())
			continue
		}
		// Comments (even at column 0) do not end the block.
		if (line.trim().startsWith("#")) {
			continue
		}
		// A non-indented, non-empty line ends the `packages:` block.
		if (line.trim() !== "" && !/^\s/.test(line)) {
			break
		}
	}
	return globs
}

async function readWorkspaceGlobs(cwd: string): Promise<string[]> {
	const pnpmFile = join(cwd, "pnpm-workspace.yaml")
	if (existsSync(pnpmFile)) {
		return parsePnpmWorkspacePackages(await readFile(pnpmFile, "utf8"))
	}
	const pkgFile = join(cwd, "package.json")
	if (existsSync(pkgFile)) {
		try {
			const pkg = JSON.parse(await readFile(pkgFile, "utf8")) as {
				workspaces?: string[] | { packages?: string[] }
			}
			if (Array.isArray(pkg.workspaces)) {
				return pkg.workspaces
			}
			if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
				return pkg.workspaces.packages
			}
		} catch {
			// ignore malformed package.json
		}
	}
	return []
}

/** Discover the named packages in a pnpm/npm/yarn workspace rooted at `cwd`. */
export async function discoverWorkspacePackages(cwd: string): Promise<WorkspacePackage[]> {
	const globs = await readWorkspaceGlobs(cwd)
	if (globs.length === 0) {
		return []
	}
	const packageJsonGlobs = globs.map((g) => `${g.replace(/\/+$/, "")}/package.json`)
	const matches = await glob(packageJsonGlobs, {
		cwd,
		ignore: ["**/node_modules/**"],
		onlyFiles: true,
		dot: false,
	})

	const packages: WorkspacePackage[] = []
	for (const rel of matches) {
		try {
			const pkg = JSON.parse(await readFile(join(cwd, rel), "utf8")) as { name?: string }
			if (pkg.name) {
				packages.push({ name: pkg.name, dir: join(cwd, dirname(rel)) })
			}
		} catch {
			// ignore malformed package.json
		}
	}
	return packages
}

type ExportsValue = string | { [condition: string]: ExportsValue } | null

/** Pick the most relevant target from an exports value, preferring type declarations. */
function pickExportTarget(value: ExportsValue): string | undefined {
	if (typeof value === "string") {
		return value
	}
	if (value && typeof value === "object") {
		return (
			pickExportTarget(value.types ?? null) ??
			pickExportTarget(value.import ?? null) ??
			pickExportTarget(value.module ?? null) ??
			pickExportTarget(value.default ?? null) ??
			pickExportTarget(value.require ?? null)
		)
	}
	return undefined
}

/** Flatten a package's `exports`/`types`/`main` into `[subpathKey, relativeTarget]` pairs. */
function readPackageEntries(manifest: Record<string, unknown>): Array<[string, string]> {
	const exp = manifest.exports as ExportsValue | undefined
	const entries: Array<[string, string]> = []

	if (typeof exp === "string") {
		entries.push([".", exp])
	} else if (exp && typeof exp === "object") {
		const keys = Object.keys(exp)
		// Either a subpath map ({ ".": ..., "./x": ... }) or bare conditions for ".".
		if (keys.some((k) => k.startsWith("."))) {
			for (const key of keys) {
				const target = pickExportTarget((exp as Record<string, ExportsValue>)[key] ?? null)
				if (target) {
					entries.push([key, target])
				}
			}
		} else {
			const target = pickExportTarget(exp)
			if (target) {
				entries.push([".", target])
			}
		}
	}

	if (entries.length === 0) {
		const fallback = (manifest.types ?? manifest.module ?? manifest.main) as string | undefined
		if (fallback) {
			entries.push([".", fallback])
		}
	}
	return entries
}

/** Rewrite a built target (dist) to its likely source file; returns it only if it exists. */
function toSourceIfPresent(absTarget: string): string | undefined {
	const src = absTarget
		.replace(/[\\/]dist[\\/](?:esm|cjs|es|lib)[\\/]/, "/src/")
		.replace(/[\\/]dist[\\/]/, "/src/")
		.replace(/\.d\.mts$/, ".mts")
		.replace(/\.d\.cts$/, ".cts")
		.replace(/\.d\.ts$/, ".ts")
		.replace(/\.mjs$/, ".mts")
		.replace(/\.cjs$/, ".cts")
		.replace(/\.js$/, ".ts")
	return src !== absTarget && existsSync(src) ? src : undefined
}

/**
 * Build TypeScript `paths` that make a workspace's packages resolvable when
 * type-checking docs from the repo root — which a pnpm isolated `node_modules`
 * otherwise prevents.
 *
 * Each entry is derived from the package's real `exports` map (the same surface a
 * consumer sees), then resolved to the corresponding **source** file when present.
 * Deriving from `exports` — rather than guessing `src/<subpath>` — is what keeps a
 * package's root and its subpaths on the *same* side of the src/dist line, avoiding
 * "two copies of the same type" errors when an export key is renamed (e.g.
 * `./adapters` -> `dist/esm/activities`). Every package's `node_modules` is added
 * as a `*` fallback so third-party deps resolve too.
 *
 * Returns `undefined` when `cwd` is not a workspace.
 */
export async function buildWorkspaceResolution(cwd: string): Promise<WorkspaceResolution | undefined> {
	const packages = await discoverWorkspacePackages(cwd)
	if (packages.length === 0) {
		return undefined
	}

	const paths: Record<string, string[]> = {}
	const nodeModulesFallbacks: string[] = []

	// Absolute path values so resolution is correct regardless of any `baseUrl`
	// the project's tsconfig may set (paths values are otherwise baseUrl-relative).
	if (existsSync(join(cwd, "node_modules"))) {
		nodeModulesFallbacks.push(`${toPosix(join(cwd, "node_modules"))}/*`)
	}

	for (const pkg of packages) {
		const manifest = JSON.parse(await readFile(join(pkg.dir, "package.json"), "utf8")) as Record<string, unknown>
		for (const [key, target] of readPackageEntries(manifest)) {
			const specifier = key === "." ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, "")}`
			const absTarget = join(pkg.dir, target)
			if (target.includes("*")) {
				// Wildcard export: offer the source-tree mapping first, then the built one.
				const srcWildcard = toPosix(absTarget).replace(/\/dist\/(?:esm|cjs|es|lib)?\/?/, "/src/")
				paths[specifier] = [srcWildcard, toPosix(absTarget)]
			} else {
				paths[specifier] = [toPosix(toSourceIfPresent(absTarget) ?? absTarget)]
			}
		}
		// Catch any non-enumerated subpath (rare) without leaking into another package.
		if (!paths[`${pkg.name}/*`]) {
			const srcDir = join(pkg.dir, "src")
			paths[`${pkg.name}/*`] = existsSync(srcDir)
				? [`${toPosix(srcDir)}/*`, `${toPosix(pkg.dir)}/*`]
				: [`${toPosix(pkg.dir)}/*`]
		}
		if (existsSync(join(pkg.dir, "node_modules"))) {
			nodeModulesFallbacks.push(`${toPosix(join(pkg.dir, "node_modules"))}/*`)
		}
	}

	if (nodeModulesFallbacks.length > 0) {
		paths["*"] = nodeModulesFallbacks
	}

	return { baseUrl: cwd, paths }
}
