import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type ts from "typescript"

/** A TypeScript the extension can hand to kiira-core, and where it came from. */
export interface FoundTypescript {
	module: typeof ts
	/** Absolute path of the loaded `typescript.js`; its directory holds the `lib.*.d.ts` files. */
	path: string
	version: string
	source: "workspace" | "vscode"
}

export interface FindTypescriptInput {
	/** Workspace folder paths, in order; the first with a usable TypeScript wins. */
	workspaceFolders: readonly string[]
	/** `vscode.env.appRoot`: VS Code ships TypeScript for its own language features under here. */
	appRoot: string
	/** Overridable so tests never load a real second TypeScript. */
	load?: (path: string) => typeof ts
}

const classicMajor = (version: string): boolean => {
	const major = Number.parseInt(version.split(".")[0] ?? "", 10)
	// TypeScript 7 is the native port: `require("typescript")` has no classic compiler API.
	return major === 5 || major === 6
}

/**
 * The workspace's TypeScript: `node_modules/typescript` in `folder` or any parent
 * (a monorepo hoists it to the root). A manual walk rather than `require.resolve`,
 * which would also consult Node's global folders and NODE_PATH.
 */
function workspaceTypescript(folder: string): { path: string; version: string } | undefined {
	let dir = folder
	for (;;) {
		const manifestPath = join(dir, "node_modules", "typescript", "package.json")
		if (existsSync(manifestPath)) {
			try {
				const { version } = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string }
				const entry = join(dirname(manifestPath), "lib", "typescript.js")
				return version && classicMajor(version) && existsSync(entry) ? { path: entry, version } : undefined
			} catch {
				return undefined
			}
		}
		const parent = dirname(dir)
		if (parent === dir) {
			return undefined
		}
		dir = parent
	}
}

function vscodeTypescript(appRoot: string): { path: string; version: string } | undefined {
	const dir = join(appRoot, "extensions", "node_modules", "typescript")
	const entry = join(dir, "lib", "typescript.js")
	if (!existsSync(entry)) {
		return undefined
	}
	try {
		const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string }
		return { path: entry, version: version ?? "unknown" }
	} catch {
		return { path: entry, version: "unknown" }
	}
}

const defaultLoad = (path: string): typeof ts => createRequire(__filename)(path) as typeof ts

/**
 * Pick the TypeScript the extension checks with, instead of bundling one: the
 * first workspace folder's own TypeScript 5/6 (so diagnostics match the project),
 * else the copy VS Code ships for its built-in TypeScript features. `undefined`
 * when neither exists, which only happens with the built-in extension disabled
 * and no project TypeScript.
 */
export function findTypescript(input: FindTypescriptInput): FoundTypescript | undefined {
	const load = input.load ?? defaultLoad
	for (const folder of input.workspaceFolders) {
		const found = workspaceTypescript(folder)
		if (found) {
			return { module: load(found.path), ...found, source: "workspace" }
		}
	}
	const builtin = vscodeTypescript(input.appRoot)
	if (builtin) {
		return { module: load(builtin.path), ...builtin, source: "vscode" }
	}
	return undefined
}
