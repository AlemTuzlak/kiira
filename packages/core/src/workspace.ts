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

/**
 * Build TypeScript `paths` that make a workspace's packages resolvable when
 * type-checking docs from the repo root — which a pnpm isolated `node_modules`
 * otherwise prevents. Each package name maps to its source (preferred) or its
 * directory (which honors the published `types`/`exports`), and every package's
 * `node_modules` is added as a `*` fallback so third-party deps resolve too.
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
		const dir = toPosix(pkg.dir)
		const hasSrcIndex = existsSync(join(pkg.dir, "src", "index.ts"))
		paths[pkg.name] = hasSrcIndex ? [`${dir}/src/index.ts`, dir] : [dir]
		paths[`${pkg.name}/*`] = [`${dir}/src/*`, `${dir}/*`]
		if (existsSync(join(pkg.dir, "node_modules"))) {
			nodeModulesFallbacks.push(`${dir}/node_modules/*`)
		}
	}

	if (nodeModulesFallbacks.length > 0) {
		paths["*"] = nodeModulesFallbacks
	}

	return { baseUrl: cwd, paths }
}
