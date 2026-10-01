import { createRequire } from "node:module"
import { join } from "node:path"
import type TS from "typescript"

/** The classic TypeScript compiler API (TypeScript 5 or 6). */
export type TypeScriptModule = typeof TS

/** Where TypeScript is looked up. Overridable so tests never touch real installs. */
export interface TypescriptResolvers {
	/** A `require` that resolves like a file at `fromFile` would. */
	requireFrom: (fromFile: string) => (id: string) => unknown
	/** A `require` that resolves like kiira-core itself would. */
	self: () => (id: string) => unknown
}

const defaultResolvers: TypescriptResolvers = {
	requireFrom: (fromFile) => createRequire(fromFile),
	self: () => createRequire(import.meta.url),
}

export const MISSING_TYPESCRIPT_MESSAGE = 'Kiira needs TypeScript 5 or newer. Install "typescript" in your project.'

let injected: TypeScriptModule | undefined
let selected: TypeScriptModule | undefined

/** Let a host that bundles TypeScript (the VS Code extension) hand kiira its copy. Wins over every lookup. */
export function setTypescriptModule(module: TypeScriptModule | undefined): void {
	injected = module
	selected = undefined
}

function load(require: (id: string) => unknown): TypeScriptModule | undefined {
	try {
		return require("typescript") as TypeScriptModule
	} catch {
		return undefined
	}
}

function projectModule(cwd: string, resolvers: TypescriptResolvers): TypeScriptModule | undefined {
	try {
		const require = resolvers.requireFrom(join(cwd, "__kiira_ts__.js"))
		const version = (require("typescript/package.json") as { version?: string }).version
		const major = Number.parseInt((version ?? "").split(".")[0] ?? "", 10)
		// TypeScript 7 is the native port: `require("typescript")` has no classic API.
		return major === 5 || major === 6 ? load(require) : undefined
	} catch {
		return undefined
	}
}

/**
 * Pick the TypeScript to use for the project at `cwd` and remember it for
 * {@link getTypescript}. Order: host-injected, the project's own TypeScript 5/6,
 * then the one kiira-core resolves itself.
 */
export function selectTypescript(cwd: string, resolvers: TypescriptResolvers = defaultResolvers): TypeScriptModule {
	if (injected) {
		return injected
	}
	selected = projectModule(cwd, resolvers) ?? load(resolvers.self())
	if (!selected) {
		throw new Error(MISSING_TYPESCRIPT_MESSAGE)
	}
	return selected
}

/** The last TypeScript chosen by {@link selectTypescript}, or the one kiira-core resolves itself. */
export function getTypescript(resolvers: TypescriptResolvers = defaultResolvers): TypeScriptModule {
	if (injected) {
		return injected
	}
	selected ??= load(resolvers.self())
	if (!selected) {
		throw new Error(MISSING_TYPESCRIPT_MESSAGE)
	}
	return selected
}
