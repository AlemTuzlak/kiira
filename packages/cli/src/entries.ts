import { statSync } from "node:fs"
import { isAbsolute, join } from "node:path"

// Characters that make a path a glob pattern (used verbatim, not expanded).
const GLOB_MAGIC = /[*?{}[\]()!]/

function toPosix(path: string): string {
	return path.split("\\").join("/")
}

function isDirectory(cwd: string, path: string): boolean {
	try {
		return statSync(isAbsolute(path) ? path : join(cwd, path)).isDirectory()
	} catch {
		return false
	}
}

/**
 * Turn `--entry` / positional arguments into include globs. A glob is used as-is;
 * a directory becomes `<dir>/**\/*.md`; a file path is used as-is.
 */
export function toIncludeGlobs(cwd: string, entries: string[]): string[] {
	return entries.map((entry) => {
		const value = toPosix(entry)
		if (GLOB_MAGIC.test(value)) {
			return value
		}
		if (isDirectory(cwd, entry)) {
			return `${value.replace(/\/+$/, "")}/**/*.md`
		}
		return value
	})
}

/**
 * Turn `--ignore` arguments into exclude globs. A glob is used as-is; a file path
 * (with an extension) is used as-is; anything else is treated as a directory
 * subtree (`<dir>/**`), so `--ignore docs/api` excludes the whole directory.
 */
export function toIgnoreGlobs(cwd: string, ignores: string[]): string[] {
	return ignores.map((entry) => {
		const value = toPosix(entry)
		if (GLOB_MAGIC.test(value)) {
			return value
		}
		if (!isDirectory(cwd, entry) && /\.[a-z0-9]+$/i.test(value)) {
			return value
		}
		return `${value.replace(/\/+$/, "")}/**`
	})
}
