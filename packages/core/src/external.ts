import { existsSync } from "node:fs"
import { join } from "node:path"

// Exported in a later task once a consumer (the install command table + the
// package index) references it; kept local now so knip sees no unused export.
type PackageManager = "npm" | "pnpm" | "yarn" | "bun"

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
