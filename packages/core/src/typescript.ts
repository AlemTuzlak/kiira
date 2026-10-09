import { createRequire } from "node:module"
import { join } from "node:path"
import type TS from "typescript"

/** The classic TypeScript compiler API (TypeScript 5.4+ or 6). */
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

export const MISSING_TYPESCRIPT_MESSAGE = 'Kiira needs TypeScript 5.4+ or 6. Install "typescript" in your project.'

let injected: TypeScriptModule | undefined
let selected: TypeScriptModule | undefined

/** Let a host that bundles TypeScript (the VS Code extension) hand kiira its copy. Wins over every lookup. */
export function setTypescriptModule(module: TypeScriptModule | undefined): void {
	injected = module
	selected = undefined
}

/** TypeScript 5.4+ and 6 ship the classic API. TypeScript 7 is the native port: `require("typescript")` has no classic API. */
function isSupported(version: string | undefined): boolean {
	const [major, minor] = (version ?? "").split(".").map((part) => Number.parseInt(part, 10))
	return major === 6 || (major === 5 && (minor ?? 0) >= 4)
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
		return isSupported(version) ? load(require) : undefined
	} catch {
		return undefined
	}
}

/** The TypeScript kiira-core resolves itself. Throws when it is missing or has no classic API. */
function selfModule(resolvers: TypescriptResolvers): TypeScriptModule {
	const ts = load(resolvers.self())
	if (!ts) {
		throw new Error(MISSING_TYPESCRIPT_MESSAGE)
	}
	if (!isSupported(ts.version)) {
		throw new Error(
			`Kiira found TypeScript ${ts.version}, but needs TypeScript 5.4+ or 6 for its compiler API. Install "typescript@^5.4.0 || ^6.0.0" next to kiira-core, or pass one to setTypescriptModule.`
		)
	}
	return ts
}

/**
 * Pick the TypeScript to use for the project at `cwd` and remember it for
 * {@link getTypescript}. Order: host-injected, the project's own TypeScript 5.4+/6,
 * then the one kiira-core resolves itself.
 */
export function selectTypescript(cwd: string, resolvers: TypescriptResolvers = defaultResolvers): TypeScriptModule {
	if (injected) {
		return injected
	}
	selected = projectModule(cwd, resolvers) ?? selfModule(resolvers)
	return selected
}

/** The last TypeScript chosen by {@link selectTypescript}, or the one kiira-core resolves itself. */
export function getTypescript(resolvers: TypescriptResolvers = defaultResolvers): TypeScriptModule {
	if (injected) {
		return injected
	}
	selected ??= selfModule(resolvers)
	return selected
}
