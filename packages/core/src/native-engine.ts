import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type ts from "typescript"
import type { CheckerEngine, RawDiagnostic } from "./engine"
import { severityFromCategory } from "./engine"
import type { SourcePosition, VirtualFile } from "./types"
import { getTypescript } from "./typescript"

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
	dispose(): void
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
	updateSnapshot(params: {
		openProjects?: string[]
		fileChanges?: {
			changed?: string[]
			created?: string[]
			deleted?: string[]
		}
	}): NativeSnapshot
	close(): void
}

export interface NativeApiConstructor {
	new (options: { cwd: string; fs: NativeFileSystem }): NativeApi
}

interface NativeEngineSession extends CheckerEngine {
	close(): Promise<void>
}

const caseInsensitive = process.platform === "win32" || process.platform === "darwin"
const normalize = (file: string): string => {
	const slashed = file.replace(/\\/g, "/")
	return caseInsensitive ? slashed.toLowerCase() : slashed
}

// tsconfig `jsx` accepts kebab-case strings, but `ts.JsxEmit` enum names don't
// match them (e.g. ReactJSX -> "react-jsx"), so map explicitly.
const jsxToTsconfig = (): Record<number, string> => {
	const { JsxEmit } = getTypescript()
	return {
		[JsxEmit.Preserve]: "preserve",
		[JsxEmit.React]: "react",
		[JsxEmit.ReactNative]: "react-native",
		[JsxEmit.ReactJSX]: "react-jsx",
		[JsxEmit.ReactJSXDev]: "react-jsxdev",
	}
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
const moduleResolutionForms = (): Record<number, string> => {
	const { ModuleResolutionKind } = getTypescript()
	return {
		[ModuleResolutionKind.Classic]: "classic",
		[ModuleResolutionKind.Node10]: "node10",
		[ModuleResolutionKind.Node16]: "node16",
		[ModuleResolutionKind.NodeNext]: "nodenext",
		[ModuleResolutionKind.Bundler]: "bundler",
	}
}

/**
 * Serialize kiira's in-memory `ts.CompilerOptions` (numeric enums) back to the
 * string forms a tsconfig JSON expects, so the native compiler checks with the
 * exact same options the classic engine would.
 */
export function compilerOptionsToTsconfigJson(options: ts.CompilerOptions): Record<string, unknown> {
	const ts = getTypescript()
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
					moduleResolutionForms()
				)
				break
			case "moduleDetection":
				out[key] = enumToTsconfig(ts.ModuleDetectionKind as unknown as Record<string, unknown>, value as number)
				break
			case "jsx":
				out[key] = jsxToTsconfig()[value as number]
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

/** Offsets at which each line of `content` starts; computed once per file, then shared by every diagnostic. */
export function lineStartsOf(content: string): number[] {
	const starts = [0]
	for (let i = 0; i < content.length; i += 1) {
		if (content.charCodeAt(i) === 10 /* \n */) {
			starts.push(i + 1)
		}
	}
	return starts
}

/** Zero-based line/character for a UTF-16 offset (matches classic coords); binary search over `lineStarts`. */
export function offsetToPosition(lineStarts: number[], contentLength: number, offset: number): SourcePosition {
	const clamped = Math.max(0, Math.min(offset, contentLength))
	let low = 0
	let high = lineStarts.length - 1
	while (low < high) {
		const mid = (low + high + 1) >> 1
		if ((lineStarts[mid] ?? 0) <= clamped) {
			low = mid
		} else {
			high = mid - 1
		}
	}
	return { line: low, character: clamped - (lineStarts[low] ?? 0) }
}

function fromNativeDiagnostic(diagnostic: NativeDiagnostic, vf: VirtualFile, lineStarts: number[]): RawDiagnostic {
	return {
		virtualFile: vf.fileName,
		start: offsetToPosition(lineStarts, vf.content.length, diagnostic.pos),
		end: offsetToPosition(lineStarts, vf.content.length, diagnostic.end),
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
function createOverlayFileSystem(
	overlay: Map<string, string>,
	dirs?: Set<string>,
	deleted?: Set<string>
): NativeFileSystem {
	const directories = dirs ?? new Set<string>()
	const removed = deleted ?? new Set<string>()
	if (!dirs) {
		for (const file of overlay.keys()) {
			let dir = file.slice(0, file.lastIndexOf("/"))
			while (dir.length > 0 && !directories.has(dir)) {
				directories.add(dir)
				dir = dir.slice(0, dir.lastIndexOf("/"))
			}
		}
	}
	return {
		readFile: (fileName) => {
			const key = normalize(fileName)
			if (removed.has(key)) {
				return null
			}
			const value = overlay.get(key)
			return value !== undefined ? value : undefined
		},
		fileExists: (fileName) => {
			const key = normalize(fileName)
			return removed.has(key) ? false : overlay.has(key) ? true : undefined
		},
		directoryExists: (dir) => (directories.has(normalize(dir)) ? true : undefined),
		getAccessibleEntries: () => undefined,
		realpath: () => undefined,
	}
}

const nativeEngines = new Map<string, Promise<NativeEngineSession>>()

/** Create one native checker session that can safely serve repeated snapshots. */
export function createNativeEngineSession(
	API: NativeApiConstructor,
	cwd: string,
	onFailure?: () => void
): NativeEngineSession {
	const root = resolve(cwd)
	const tsconfigPath = join(root, "__kiira_native.tsconfig.json").replace(/\\/g, "/")
	const overlay = new Map<string, string>()
	const dirs = new Set<string>()
	const deleted = new Set<string>()
	const fs = createOverlayFileSystem(overlay, dirs, deleted)
	const api = new API({ cwd: root, fs })
	let projectOpened = false
	let closed = false
	let queue: Promise<void> = Promise.resolve()

	const closeApi = (): void => {
		if (closed) {
			return
		}
		closed = true
		try {
			api.close()
		} finally {
			onFailure?.()
		}
	}

	const collectSnapshot = (virtualFiles: VirtualFile[], options: ts.CompilerOptions): RawDiagnostic[] => {
		if (closed) {
			throw new Error(`Native TypeScript API for ${root} is closed`)
		}

		const previous = new Map(overlay)
		overlay.clear()
		dirs.clear()
		deleted.clear()
		const current = new Map<string, string>()
		const addFile = (fileName: string, content: string): void => {
			const path = resolve(fileName).replace(/\\/g, "/")
			current.set(normalize(path), content)
		}
		const filePaths = virtualFiles.map((vf) => resolve(vf.fileName).replace(/\\/g, "/"))
		addFile(tsconfigPath, JSON.stringify({ compilerOptions: compilerOptionsToTsconfigJson(options), files: filePaths }))
		for (const vf of virtualFiles) {
			addFile(vf.fileName, vf.content)
		}

		const changed: string[] = []
		const created: string[] = []
		const deletedFiles: string[] = []
		for (const [path, content] of current) {
			const prior = previous.get(path)
			const fileName = path
			if (prior === undefined) {
				created.push(fileName)
			} else if (prior !== content) {
				changed.push(fileName)
			}
			overlay.set(path, content)
		}
		for (const path of previous.keys()) {
			if (!current.has(path)) {
				deleted.add(path)
				deletedFiles.push(path)
			}
		}

		for (const file of overlay.keys()) {
			let dir = file.slice(0, file.lastIndexOf("/"))
			while (dir.length > 0 && !dirs.has(dir)) {
				dirs.add(dir)
				dir = dir.slice(0, dir.lastIndexOf("/"))
			}
		}

		const params: Parameters<NativeApi["updateSnapshot"]>[0] = {
			fileChanges: { changed, created, deleted: deletedFiles },
		}
		if (!projectOpened) {
			params.openProjects = [tsconfigPath]
		}

		let snapshot: NativeSnapshot | undefined
		const disposeSnapshot = (): void => {
			const current = snapshot
			snapshot = undefined
			current?.dispose()
		}
		try {
			snapshot = api.updateSnapshot(params)
			projectOpened = true
			const project = snapshot.getProjects()[0]
			if (!project) {
				throw new Error(`Native TypeScript API did not load the project at ${tsconfigPath}`)
			}
			const diagnostics: RawDiagnostic[] = []
			for (const vf of virtualFiles) {
				const file = resolve(vf.fileName).replace(/\\/g, "/")
				const raws = [...project.program.getSyntacticDiagnostics(file), ...project.program.getSemanticDiagnostics(file)]
				if (raws.length === 0) {
					continue
				}
				const lineStarts = lineStartsOf(vf.content)
				for (const diagnostic of raws) {
					diagnostics.push(fromNativeDiagnostic(diagnostic, vf, lineStarts))
				}
			}
			disposeSnapshot()
			return diagnostics
		} catch (error) {
			let cleanupError: unknown
			try {
				disposeSnapshot()
			} catch (disposeError) {
				cleanupError = disposeError
			}
			try {
				closeApi()
			} catch (closeError) {
				cleanupError = cleanupError
					? new AggregateError([cleanupError, closeError], `Native TypeScript API cleanup failed for ${root}`)
					: closeError
			}
			if (cleanupError) {
				throw new AggregateError([error, cleanupError], `Native TypeScript API failed for ${root}`)
			}
			throw error
		}
	}

	return {
		name: "native",
		collect(virtualFiles, options) {
			const operation = queue.then(() => collectSnapshot(virtualFiles, options))
			queue = operation.then(
				() => undefined,
				() => undefined
			)
			return operation
		},
		async close() {
			await queue
			closeApi()
		},
	}
}

/**
 * Create a checker engine backed by the consuming project's TypeScript 7 native
 * compiler. Throws if `typescript/unstable/sync` cannot be resolved from `cwd`.
 */
export async function createNativeEngine(cwd: string): Promise<CheckerEngine> {
	const root = resolve(cwd)
	const key = normalize(root)
	const existing = nativeEngines.get(key)
	if (existing) {
		return existing
	}

	let enginePromise: Promise<NativeEngineSession>
	enginePromise = (async () => {
		const require = createRequire(join(root, "__kiira_native_resolver__.js"))
		const syncEntry = require.resolve("typescript/unstable/sync")
		const mod = (await import(pathToFileURL(syncEntry).href)) as { API: NativeApiConstructor }
		return createNativeEngineSession(mod.API, root, () => {
			if (nativeEngines.get(key) === enginePromise) {
				nativeEngines.delete(key)
			}
		})
	})()
	nativeEngines.set(key, enginePromise)
	try {
		return await enginePromise
	} catch (error) {
		if (nativeEngines.get(key) === enginePromise) {
			nativeEngines.delete(key)
		}
		throw error
	}
}

/** Close the native compiler session for one cwd, or every session when omitted. */
export async function closeNativeEngine(cwd?: string): Promise<void> {
	if (cwd !== undefined) {
		const key = normalize(resolve(cwd))
		const enginePromise = nativeEngines.get(key)
		if (!enginePromise) {
			return
		}
		nativeEngines.delete(key)
		await (await enginePromise).close()
		return
	}
	const engines = [...nativeEngines.values()]
	nativeEngines.clear()
	await Promise.all(engines.map(async (engine) => (await engine).close()))
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
	let snapshot: NativeSnapshot | undefined
	const disposeSnapshot = (): void => {
		const current = snapshot
		snapshot = undefined
		current?.dispose()
	}
	try {
		snapshot = api.updateSnapshot({ openProjects: [tsconfigPath] })
		const project = snapshot.getProjects()[0]
		if (!project) {
			throw new Error(`Native TypeScript API did not load the project at ${tsconfigPath}`)
		}
		const diagnostics: RawDiagnostic[] = []
		for (const vf of virtualFiles) {
			const file = vf.fileName.replace(/\\/g, "/")
			const raws = [...project.program.getSyntacticDiagnostics(file), ...project.program.getSemanticDiagnostics(file)]
			if (raws.length === 0) {
				continue
			}
			const lineStarts = lineStartsOf(vf.content)
			for (const diagnostic of raws) {
				diagnostics.push(fromNativeDiagnostic(diagnostic, vf, lineStarts))
			}
		}
		disposeSnapshot()
		return diagnostics
	} finally {
		disposeSnapshot()
		api.close()
	}
}
