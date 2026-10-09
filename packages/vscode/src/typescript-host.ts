import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import type ts from "typescript"

/** An installed TypeScript kiira-core can use. */
export interface InstalledTypescript {
	/** Absolute path of `typescript.js`; its directory holds the `lib.*.d.ts` files. */
	path: string
	version: string
}

export interface TypescriptSetup {
	/** Workspace folders with their own TypeScript. kiira-core loads these itself, per folder. */
	workspace: Array<InstalledTypescript & { folder: string }>
	/** VS Code's TypeScript, loaded only when a folder has none of its own. */
	fallback: (InstalledTypescript & { module: typeof ts }) | undefined
}

export interface FindTypescriptInput {
	/** Workspace folder paths. */
	workspaceFolders: readonly string[]
	/** `vscode.env.appRoot`: VS Code ships TypeScript for its own language features under here. */
	appRoot: string
	/** Overridable so tests never load a real second TypeScript. */
	load?: (path: string) => typeof ts
}

/** kiira-core needs TypeScript 5.4+; TypeScript 7 is the native port with no classic compiler API. */
export function isSupportedTypescript(version: string): boolean {
	const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10))
	return (major === 5 && (minor ?? 0) >= 4) || major === 6
}

/** The supported TypeScript installed in `packageDir`, if any. */
function installedTypescript(packageDir: string): InstalledTypescript | undefined {
	const entry = join(packageDir, "lib", "typescript.js")
	try {
		const { version } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { version?: string }
		return version && isSupportedTypescript(version) && existsSync(entry) ? { path: entry, version } : undefined
	} catch {
		return undefined
	}
}

/**
 * The workspace folder's own TypeScript. Only the folder itself is searched: a
 * walk up past it could run a `node_modules/typescript` planted outside the
 * workspace (for example `C:\node_modules`).
 */
function workspaceTypescript(folder: string): InstalledTypescript | undefined {
	return installedTypescript(join(folder, "node_modules", "typescript"))
}

function vscodeTypescript(appRoot: string): InstalledTypescript | undefined {
	return installedTypescript(join(appRoot, "extensions", "node_modules", "typescript"))
}

const defaultLoad = (path: string): typeof ts => createRequire(__filename)(path) as typeof ts

/**
 * Find the TypeScript the extension checks with, instead of bundling one: each
 * workspace folder's own TypeScript (so diagnostics match the project), and the
 * copy VS Code ships for its built-in TypeScript features as the fallback for
 * folders without one. Both pass the same version check.
 */
export function findTypescript(input: FindTypescriptInput): TypescriptSetup {
	const load = input.load ?? defaultLoad
	const workspace = input.workspaceFolders.flatMap((folder) => {
		const found = workspaceTypescript(folder)
		return found ? [{ ...found, folder }] : []
	})
	const builtin = workspace.length < input.workspaceFolders.length ? vscodeTypescript(input.appRoot) : undefined
	return { workspace, fallback: builtin ? { ...builtin, module: load(builtin.path) } : undefined }
}
