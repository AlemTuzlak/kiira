import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import type { CheckerEngine, RawDiagnostic } from "./engine"
import { severityFromCategory } from "./engine"
import type { SourcePosition, VirtualFile } from "./types"

// --- minimal shape of TypeScript 7's `unstable/sync` API (loaded from the
// consuming project, so its real types aren't available to kiira's own build). ---

/** A diagnostic as returned by the native compiler (offsets, pre-flattened text). */
interface NativeDiagnostic {
	readonly fileName?: string
	readonly pos: number
	readonly end: number
	readonly code: number
	readonly category: number
	readonly text: string
}

interface NativeProgram {
	getSyntacticDiagnostics(file?: string): readonly NativeDiagnostic[]
	getSemanticDiagnostics(file?: string): readonly NativeDiagnostic[]
}

interface NativeProject {
	readonly configFileName: string
	readonly program: NativeProgram
}

interface NativeSnapshot {
	getProjects(): readonly NativeProject[]
}

/** The `unstable/fs` `FileSystem` callback contract kiira serves to the server. */
interface NativeFileSystem {
	readFile?: (fileName: string) => string | null | undefined
	fileExists?: (fileName: string) => boolean | undefined
	directoryExists?: (directoryName: string) => boolean | undefined
	getAccessibleEntries?: (directoryName: string) => { files: string[]; directories: string[] } | undefined
	realpath?: (path: string) => string | undefined
}

interface NativeApi {
	updateSnapshot(params: { openProjects: string[] }): NativeSnapshot
	close(): void
}

export interface NativeApiConstructor {
	new (options: { cwd: string; fs: NativeFileSystem }): NativeApi
}

const caseInsensitive = process.platform === "win32" || process.platform === "darwin"
const normalize = (file: string): string => {
	const slashed = file.replace(/\\/g, "/")
	return caseInsensitive ? slashed.toLowerCase() : slashed
}

// tsconfig `jsx` accepts kebab-case strings, but `ts.JsxEmit` enum names don't
// match them (e.g. ReactJSX -> "react-jsx"), so map explicitly.
const JSX_TO_TSCONFIG: Record<number, string> = {
	[ts.JsxEmit.Preserve]: "preserve",
	[ts.JsxEmit.React]: "react",
	[ts.JsxEmit.ReactNative]: "react-native",
	[ts.JsxEmit.ReactJSX]: "react-jsx",
	[ts.JsxEmit.ReactJSXDev]: "react-jsxdev",
}

// Internal fields `parseJsonConfigFileContent` stamps onto the options object;
// they are not valid tsconfig `compilerOptions` keys.
const INTERNAL_OPTION_KEYS = new Set(["configFilePath", "pathsBasePath", "project", "build", "locale"])

// `lib` in a parsed `ts.CompilerOptions` is the file-name form (`lib.dom.d.ts`);
// tsconfig `lib` wants the short form (`dom`).
const libToShort = (lib: string): string => lib.replace(/^lib\./, "").replace(/\.d\.ts$/, "")

/**
 * Reverse a TypeScript numeric enum value to its tsconfig string form. Uses the
 * *first* declared name for the value, not `Enum[value]` — the built-in reverse
 * map keeps the last alias, so `ScriptTarget[99]` is `"Latest"` (not `"ESNext"`,
 * which is illegal in a tsconfig). `overrides` provides forms the lowercased enum
 * name doesn't produce (e.g. `NodeJs`/`Node10` both === 2 → `"node10"`).
 */
function enumToTsconfig(
	enumObject: Record<string, unknown>,
	value: number,
	overrides: Record<number, string> = {}
): string | undefined {
	if (value in overrides) {
		return overrides[value]
	}
	const name = Object.keys(enumObject).find((key) => !/^\d+$/.test(key) && enumObject[key] === value)
	return name?.toLowerCase()
}

// Enum-valued compiler options kiira (or an override) may set, mapped to the
// tsconfig string forms. Anything not listed here must not be a numeric enum, or
// it would be emitted as a raw number the config parser rejects.
const MODULE_RESOLUTION_FORMS: Record<number, string> = {
	[ts.ModuleResolutionKind.Classic]: "classic",
	[ts.ModuleResolutionKind.Node10]: "node10",
	[ts.ModuleResolutionKind.Node16]: "node16",
	[ts.ModuleResolutionKind.NodeNext]: "nodenext",
	[ts.ModuleResolutionKind.Bundler]: "bundler",
}

/**
 * Serialize kiira's in-memory `ts.CompilerOptions` (numeric enums) back to the
 * string forms a tsconfig JSON expects, so the native compiler checks with the
 * exact same options the classic engine would.
 */
export function compilerOptionsToTsconfigJson(options: ts.CompilerOptions): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(options)) {
		if (value === undefined || value === null || INTERNAL_OPTION_KEYS.has(key) || typeof value === "function") {
			continue
		}
		switch (key) {
			case "target":
				out[key] = enumToTsconfig(ts.ScriptTarget as unknown as Record<string, unknown>, value as number)
				break
			case "module":
				out[key] = enumToTsconfig(ts.ModuleKind as unknown as Record<string, unknown>, value as number)
				break
			case "moduleResolution":
				out[key] = enumToTsconfig(
					ts.ModuleResolutionKind as unknown as Record<string, unknown>,
					value as number,
					MODULE_RESOLUTION_FORMS
				)
				break
			case "moduleDetection":
				out[key] = enumToTsconfig(ts.ModuleDetectionKind as unknown as Record<string, unknown>, value as number)
				break
			case "jsx":
				out[key] = JSX_TO_TSCONFIG[value as number]
				break
			case "lib":
				out[key] = (value as string[]).map(libToShort)
				break
			default:
				// A numeric enum not handled above would serialize as a raw number the
				// parser rejects and drops. The only such option kiira lets through is
				// `newLine`, which is emit-only — harmless here since `noEmit` is forced.
				out[key] = value
		}
	}
	// kiira never emits, and lib-checking is the consumer's concern, not the docs'.
	out.noEmit = true
	out.skipLibCheck = options.skipLibCheck ?? true
	return out
}

/** Zero-based line/character for a UTF-16 offset into `content` (matches classic coords). */
function offsetToPosition(content: string, offset: number): SourcePosition {
	const clamped = Math.max(0, Math.min(offset, content.length))
	let line = 0
	let lineStart = 0
	for (let i = 0; i < clamped; i += 1) {
		if (content.charCodeAt(i) === 10 /* \n */) {
			line += 1
			lineStart = i + 1
		}
	}
	return { line, character: clamped - lineStart }
}

function fromNativeDiagnostic(diagnostic: NativeDiagnostic, vf: VirtualFile): RawDiagnostic {
	return {
		virtualFile: vf.fileName,
		start: offsetToPosition(vf.content, diagnostic.pos),
		end: offsetToPosition(vf.content, diagnostic.end),
		code: diagnostic.code,
		message: diagnostic.text,
		severity: severityFromCategory(diagnostic.category),
	}
}

/**
 * Build the `unstable/fs` overlay: serve the synthesized tsconfig and the virtual
 * files from memory, and fall through to the real filesystem (return `undefined`)
 * for everything else, so real `node_modules` still resolve.
 */
function createOverlayFileSystem(overlay: Map<string, string>): NativeFileSystem {
	const dirs = new Set<string>()
	for (const file of overlay.keys()) {
		let dir = file.slice(0, file.lastIndexOf("/"))
		while (dir.length > 0 && !dirs.has(dir)) {
			dirs.add(dir)
			dir = dir.slice(0, dir.lastIndexOf("/"))
		}
	}
	return {
		readFile: (fileName) => {
			const value = overlay.get(normalize(fileName))
			return value !== undefined ? value : undefined
		},
		fileExists: (fileName) => (overlay.has(normalize(fileName)) ? true : undefined),
		directoryExists: (dir) => (dirs.has(normalize(dir)) ? true : undefined),
		getAccessibleEntries: () => undefined,
		realpath: () => undefined,
	}
}

/**
 * Create a checker engine backed by the consuming project's TypeScript 7 native
 * compiler. Throws if `typescript/unstable/sync` cannot be resolved from `cwd`.
 */
export async function createNativeEngine(cwd: string): Promise<CheckerEngine> {
	const require = createRequire(join(cwd, "__kiira_native_resolver__.js"))
	const syncEntry = require.resolve("typescript/unstable/sync")
	const mod = (await import(pathToFileURL(syncEntry).href)) as { API: NativeApiConstructor }
	const API = mod.API

	return {
		name: "native",
		collect(virtualFiles, options) {
			return collectNativeDiagnostics(API, cwd, virtualFiles, options)
		},
	}
}

/**
 * Type-check `virtualFiles` with an already-loaded native `API` constructor.
 * Exposed (rather than only reachable via {@link createNativeEngine}) so tests can
 * drive it with a TypeScript 7 resolved independently of the project at `cwd`.
 */
export function collectNativeDiagnostics(
	API: NativeApiConstructor,
	cwd: string,
	virtualFiles: VirtualFile[],
	options: ts.CompilerOptions
): RawDiagnostic[] {
	const tsconfigPath = join(cwd, "__kiira_native.tsconfig.json").replace(/\\/g, "/")
	const filePaths = virtualFiles.map((v) => v.fileName.replace(/\\/g, "/"))

	const overlay = new Map<string, string>()
	overlay.set(
		normalize(tsconfigPath),
		JSON.stringify({ compilerOptions: compilerOptionsToTsconfigJson(options), files: filePaths })
	)
	for (const vf of virtualFiles) {
		overlay.set(normalize(vf.fileName), vf.content)
	}

	const api = new API({ cwd, fs: createOverlayFileSystem(overlay) })
	try {
		const project = api.updateSnapshot({ openProjects: [tsconfigPath] }).getProjects()[0]
		if (!project) {
			return []
		}
		const diagnostics: RawDiagnostic[] = []
		for (const vf of virtualFiles) {
			const file = vf.fileName.replace(/\\/g, "/")
			for (const diagnostic of [
				...project.program.getSyntacticDiagnostics(file),
				...project.program.getSemanticDiagnostics(file),
			]) {
				diagnostics.push(fromNativeDiagnostic(diagnostic, vf))
			}
		}
		return diagnostics
	} finally {
		api.close()
	}
}
