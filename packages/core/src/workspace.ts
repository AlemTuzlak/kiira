import { existsSync, readdirSync, statSync } from "node:fs"
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
	/** `@types` directories across the workspace, so e.g. @types/react resolves for a package's docs. */
	typeRoots: string[]
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

// --- cross-call reuse ---
//
// Discovering a workspace globs for every `package.json`, reads each one, and lists
// every package's `node_modules/@types`. One check run does this at least twice
// (`createProject` and `buildBaseOptions`), the `group` rule once more per probe,
// and the editor once per keystroke. The result only changes when the workspace
// does, so it is cached per `cwd` behind a fingerprint of the paths that decide it:
// the workspace manifest, every directory the globs walk (a new entry changes its
// parent's mtime), and each package's directory, `package.json`, `src`,
// `node_modules`, and `node_modules/@types`.
// Validating the fingerprint is a few stats per package instead of a glob and N reads.

interface WorkspaceSnapshot {
	/** The paths whose mtimes decide the snapshot, sorted. */
	watched: string[]
	fingerprint: string
	packages: readonly WorkspacePackage[]
	/** Built on first request; `null` when not yet built. */
	resolution: WorkspaceResolution | undefined | null
}

interface WorkspaceScan {
	/** cwd-relative `package.json` paths the workspace globs match. */
	manifests: string[]
	/** See {@link WorkspaceSnapshot.watched}. */
	watched: string[]
}

const snapshots = new Map<string, WorkspaceSnapshot>()

/** Forget every cached workspace. Tests and long-lived hosts that want a clean slate call this. */
export function resetWorkspaceCache(): void {
	snapshots.clear()
}

const GLOB_MAGIC = /[*?{}[\]()!]/

/** How many leading segments of a workspace glob are static (`packages/*` -> 1). */
function staticDepth(segments: string[]): number {
	const depth = segments.findIndex((segment) => GLOB_MAGIC.test(segment))
	return depth === -1 ? segments.length : depth
}

// Each level a workspace glob walks below its static root:
// `apps/*/pkgs/*` -> `apps/*`, `apps/*/pkgs`, `apps/*/pkgs/*`.
function globLevels(glob: string): string[] {
	const segments = glob.split("/")
	const levels: string[] = []
	for (let depth = staticDepth(segments) + 1; depth <= segments.length; depth++) {
		levels.push(segments.slice(0, depth).join("/"))
	}
	return levels
}

function mtimeOf(path: string): string {
	const stat = statSync(path, { throwIfNoEntry: false })
	return stat ? String(stat.mtimeMs) : "-"
}

function fingerprintOf(watched: string[]): string {
	return watched.map(mtimeOf).join("\n")
}

function sameList(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((item, i) => item === b[i])
}

/** Glob the workspace for its `package.json` files and every directory the globs walk. */
async function scanWorkspace(cwd: string): Promise<WorkspaceScan> {
	const globs = (await readWorkspaceGlobs(cwd)).map((g) => g.replace(/\/+$/, ""))
	const watched = new Set([
		join(cwd, "pnpm-workspace.yaml"),
		join(cwd, "package.json"),
		join(cwd, "node_modules"),
		join(cwd, "node_modules", "@types"),
	])
	if (globs.length === 0) {
		return { manifests: [], watched: [...watched].sort() }
	}
	for (const g of globs) {
		const segments = g.split("/")
		watched.add(join(cwd, segments.slice(0, staticDepth(segments)).join("/")))
	}
	// Match the directories at every walked level too, so a directory that does not
	// hold a package yet (or holds packages deeper down) is watched for new entries.
	const options = { cwd, ignore: ["**/node_modules/**"], dot: false }
	const [dirs, manifests] = await Promise.all([
		glob(globs.filter((g) => !g.startsWith("!")).flatMap(globLevels), { ...options, onlyDirectories: true }),
		glob(
			globs.map((g) => `${g}/package.json`),
			{ ...options, onlyFiles: true }
		),
	])
	for (const dir of dirs) {
		watched.add(join(cwd, dir.replace(/\/$/, "")))
	}
	for (const manifest of manifests) {
		const dir = join(cwd, dirname(manifest))
		for (const path of ["", "package.json", "src", "node_modules", join("node_modules", "@types")]) {
			watched.add(join(dir, path))
		}
	}
	return { manifests, watched: [...watched].sort() }
}

/** The cached snapshot for `cwd`, rebuilt when any watched path's mtime changed. */
async function workspaceSnapshot(cwd: string): Promise<WorkspaceSnapshot> {
	const cached = snapshots.get(cwd)
	if (cached && fingerprintOf(cached.watched) === cached.fingerprint) {
		return cached
	}
	// Stat before reading: a change made during the scan then shows up as a changed
	// mtime on the next call, instead of a new mtime stored next to old content. The
	// paths to stat come from a scan, so scan again until it watches what was statted.
	let watched = cached?.watched ?? []
	for (let attempt = 1; ; attempt++) {
		const fingerprint = fingerprintOf(watched)
		const scan = await scanWorkspace(cwd)
		const settled = sameList(scan.watched, watched)
		if (settled || attempt === 3) {
			const snapshot: WorkspaceSnapshot = {
				watched: scan.watched,
				// Still moving after three scans: use the result once, but rebuild next time.
				fingerprint: settled ? fingerprint : "",
				packages: await readWorkspacePackages(cwd, scan.manifests),
				resolution: null,
			}
			snapshots.set(cwd, snapshot)
			return snapshot
		}
		watched = scan.watched
	}
}

/**
 * Discover the named packages in a pnpm/npm/yarn workspace rooted at `cwd`. Cached
 * (see {@link workspaceSnapshot}); each call returns a fresh copy the caller may change.
 */
export async function discoverWorkspacePackages(cwd: string): Promise<WorkspacePackage[]> {
	return (await workspaceSnapshot(cwd)).packages.map((pkg) => ({ ...pkg }))
}

async function readWorkspacePackages(cwd: string, manifests: string[]): Promise<readonly WorkspacePackage[]> {
	const packages: WorkspacePackage[] = []
	for (const rel of manifests) {
		try {
			const pkg = JSON.parse(await readFile(join(cwd, rel), "utf8")) as { name?: string }
			if (pkg.name) {
				packages.push(Object.freeze({ name: pkg.name, dir: join(cwd, dirname(rel)) }))
			}
		} catch {
			// ignore malformed package.json
		}
	}
	return Object.freeze(packages)
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
 * Returns `undefined` when `cwd` is not a workspace. Cached with the workspace
 * snapshot (see {@link discoverWorkspacePackages}) and frozen, so callers cannot mutate it.
 */
export async function buildWorkspaceResolution(cwd: string): Promise<WorkspaceResolution | undefined> {
	const snapshot = await workspaceSnapshot(cwd)
	if (snapshot.resolution === null) {
		snapshot.resolution = await resolveWorkspace(cwd, snapshot.packages)
	}
	return snapshot.resolution
}

async function resolveWorkspace(
	cwd: string,
	packages: readonly WorkspacePackage[]
): Promise<WorkspaceResolution | undefined> {
	if (packages.length === 0) {
		return undefined
	}

	const paths: Record<string, string[]> = {}
	const nodeModulesFallbacks: string[] = []
	const typeRoots: string[] = []

	const addTypeRoot = (dir: string): void => {
		const typesDir = join(dir, "node_modules", "@types")
		if (existsSync(typesDir)) {
			typeRoots.push(toPosix(typesDir))
			addTypesPackagePaths(typesDir)
		}
	}

	// Map a runtime-only package (e.g. `react`) to its `@types/<pkg>` declarations,
	// so TS finds types instead of erroring on the untyped `.js` (TS7016). The
	// runtime is irrelevant — docs are only type-checked, never executed.
	const addTypesPackagePaths = (typesDir: string): void => {
		let entries: string[]
		try {
			entries = readdirSync(typesDir, { withFileTypes: true })
				// `@types/*` entries are pnpm symlinks, so accept symlinks as well as dirs.
				.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith("."))
				.map((e) => e.name)
		} catch {
			return
		}
		for (const entry of entries) {
			// `@types/node` provides globals (via typeRoots), not an importable `node` module.
			if (entry === "node") {
				continue
			}
			// Scoped types use `scope__name` (e.g. `babel__core` -> `@babel/core`).
			const moduleName = entry.includes("__") ? `@${entry.replace("__", "/")}` : entry
			if (paths[moduleName]) {
				continue // a workspace package or earlier @types dir already claims it
			}
			const dir = `${toPosix(typesDir)}/${entry}`
			paths[moduleName] = [dir]
			paths[`${moduleName}/*`] = [`${dir}/*`]
		}
	}

	// Absolute path values so resolution is correct regardless of any `baseUrl`
	// the project's tsconfig may set (paths values are otherwise baseUrl-relative).
	if (existsSync(join(cwd, "node_modules"))) {
		nodeModulesFallbacks.push(`${toPosix(join(cwd, "node_modules"))}/*`)
	}
	addTypeRoot(cwd)

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
		addTypeRoot(pkg.dir)
	}

	if (nodeModulesFallbacks.length > 0) {
		paths["*"] = nodeModulesFallbacks
	}

	// Frozen: the cached result is shared by every caller.
	const resolution: WorkspaceResolution = { baseUrl: cwd, paths, typeRoots: [...new Set(typeRoots)] }
	for (const value of [...Object.values(paths), paths, resolution.typeRoots, resolution]) {
		Object.freeze(value)
	}
	return resolution
}
