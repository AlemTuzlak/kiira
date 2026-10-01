import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import type ts from "typescript"
import type { KiiraEngine, SourcePosition, VirtualFile } from "./types"
import { getTypescript } from "./typescript"

/**
 * A diagnostic in virtual-file coordinates, normalized across the classic and
 * native engines. `check.ts` maps this to a {@link KiiraDiagnostic} (Markdown
 * coordinates) — the mapping logic is shared, only the collection differs.
 */
export interface RawDiagnostic {
	/** The virtual file this diagnostic belongs to. */
	virtualFile: string
	/** Zero-based start position within the virtual file, if the diagnostic has one. */
	start?: SourcePosition
	/** Zero-based end position within the virtual file, if the diagnostic has one. */
	end?: SourcePosition
	code?: number
	message: string
	severity: "error" | "warning" | "info"
}

/** A pluggable TypeScript type-checking backend. */
export interface CheckerEngine {
	name: "classic" | "native"
	/**
	 * Type-check the virtual files under `options` and return their diagnostics.
	 * An engine that builds an in-process `ts.Program` hands it to `onProgram`.
	 */
	collect(
		virtualFiles: VirtualFile[],
		options: ts.CompilerOptions,
		onProgram?: (program: ts.Program) => void
	): RawDiagnostic[] | Promise<RawDiagnostic[]>
}

// ts.DiagnosticCategory is a numeric enum with the same values in TS5 and TS7
// (Warning=0, Error=1, Suggestion=2, Message=3), so both engines map by number.
export function severityFromCategory(category: number): RawDiagnostic["severity"] {
	const ts = getTypescript()
	switch (category) {
		case ts.DiagnosticCategory.Error:
			return "error"
		case ts.DiagnosticCategory.Warning:
			return "warning"
		default:
			return "info"
	}
}

// --- classic engine (kiira's bundled TypeScript, in-process) ---

function scriptKindFor(lang: VirtualFile["lang"]): ts.ScriptKind {
	const ts = getTypescript()
	switch (lang) {
		case "tsx":
			return ts.ScriptKind.TSX
		case "jsx":
			return ts.ScriptKind.JSX
		case "js":
			return ts.ScriptKind.JS
		default:
			return ts.ScriptKind.TS
	}
}

// Directory holding TypeScript's `lib.*.d.ts` files. When TypeScript is bundled
// into a host (the VS Code extension), `ts.sys.getExecutingFilePath()` no longer
// points next to the real lib files, so the default-lib location is wrong and every
// global (`JSON`, `Date`, DOM types) is reported as undefined. A host that bundles
// TypeScript ships the lib files and calls `setTypescriptLibDir` to point here.
let typescriptLibDir: string | undefined

/** Override where TypeScript loads its default `lib.*.d.ts` from (for bundled hosts). */
export function setTypescriptLibDir(dir: string | undefined): void {
	typescriptLibDir = dir
	resetClassicEngineCache()
}

// --- cross-check reuse ---
//
// Building a program from scratch parses every lib and `node_modules` declaration
// file it reaches; that is most of a check's cost and none of it changes between
// checks. Real (on-disk) source files are cached here and served to every later
// program; the virtual files are tiny and always parsed fresh. Each hit is
// validated against the file's current mtime, so an edited declaration file or a
// changed install is picked up on the next check without any explicit invalidation.
// The previous program is also handed back to `createProgram` as `oldProgram`, which
// lets TypeScript keep module resolutions and bound files it already has.

interface CachedSourceFile {
	sourceFile: ts.SourceFile
	/** The file's modification time when it was parsed, in ms; `undefined` when unknown. */
	mtime: number | undefined
}

const sourceFileCache = new Map<string, CachedSourceFile>()
let oldProgram: ts.Program | undefined
/** The TypeScript module the cached files were parsed with; a different one (a project's own) invalidates them. */
let cacheOwner: unknown

/** Make sure the cache belongs to the TypeScript module in use. */
function ensureCacheOwner(ts: unknown): void {
	if (cacheOwner !== ts) {
		resetClassicEngineCache()
		cacheOwner = ts
	}
}

/**
 * Drop every cached source file and the previous program. Call when the TypeScript
 * module or lib directory changes (a cached `SourceFile` belongs to the TypeScript
 * that parsed it) or to release memory in a long-lived host.
 */
export function resetClassicEngineCache(): void {
	sourceFileCache.clear()
	oldProgram = undefined
}

/** Number of real source files currently held by the classic engine's cache. */
export function classicEngineCacheSize(): number {
	return sourceFileCache.size
}

/** The parts of `getSourceFile`'s second argument that change how a file parses. */
function parseKey(languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions): string {
	if (typeof languageVersionOrOptions === "number") {
		return String(languageVersionOrOptions)
	}
	const { languageVersion, impliedNodeFormat, jsDocParsingMode } = languageVersionOrOptions
	return `${languageVersion}|${impliedNodeFormat ?? ""}|${jsDocParsingMode ?? ""}`
}

function modifiedTime(fileName: string): number | undefined {
	return getTypescript().sys.getModifiedTime?.(fileName)?.getTime()
}

/** Apply the configured lib-directory override to a compiler/language-service host. */
export function applyLibDirOverride(host: {
	getDefaultLibLocation?: () => string
	getDefaultLibFileName: (options: ts.CompilerOptions) => string
}): void {
	if (!typescriptLibDir) {
		return
	}
	const ts = getTypescript()
	const dir = typescriptLibDir
	host.getDefaultLibLocation = () => dir
	host.getDefaultLibFileName = (options) => join(dir, ts.getDefaultLibFileName(options))
}

/** Build a TS compiler host that overlays in-memory virtual files on the real filesystem. */
function createOverlayHost(options: ts.CompilerOptions, virtualFiles: VirtualFile[]): ts.CompilerHost {
	const ts = getTypescript()
	const host = ts.createCompilerHost(options, true)
	const caseSensitive = host.useCaseSensitiveFileNames()
	const normalize = (file: string): string => {
		const slashed = file.replace(/\\/g, "/")
		return caseSensitive ? slashed : slashed.toLowerCase()
	}

	const overlay = new Map<string, VirtualFile>()
	for (const vf of virtualFiles) {
		overlay.set(normalize(vf.fileName), vf)
	}

	// `moduleDetection` drives `setExternalModuleIndicator`, which the host bakes into
	// the parse, so files parsed under a different setting are not interchangeable.
	const optionsKey = `${options.moduleDetection ?? ""}`
	const originalGetSourceFile = host.getSourceFile.bind(host)
	host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
		const vf = overlay.get(normalize(fileName))
		if (vf) {
			return ts.createSourceFile(fileName, vf.content, languageVersionOrOptions, true, scriptKindFor(vf.lang))
		}
		const key = `${normalize(fileName)}|${parseKey(languageVersionOrOptions)}|${optionsKey}`
		const mtime = modifiedTime(fileName)
		const cached = sourceFileCache.get(key)
		if (cached && cached.mtime !== undefined && cached.mtime === mtime) {
			return cached.sourceFile
		}
		const sourceFile = originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate)
		if (sourceFile && mtime !== undefined) {
			sourceFileCache.set(key, { sourceFile, mtime })
		} else {
			sourceFileCache.delete(key)
		}
		return sourceFile
	}

	const originalFileExists = host.fileExists.bind(host)
	host.fileExists = (fileName) => overlay.has(normalize(fileName)) || originalFileExists(fileName)

	const originalReadFile = host.readFile.bind(host)
	host.readFile = (fileName) => {
		const vf = overlay.get(normalize(fileName))
		return vf ? vf.content : originalReadFile(fileName)
	}

	applyLibDirOverride(host)
	return host
}

export const classicEngine: CheckerEngine = {
	name: "classic",
	collect(virtualFiles, options, onProgram) {
		const ts = getTypescript()
		ensureCacheOwner(ts)
		const host = createOverlayHost(options, virtualFiles)
		const program = ts.createProgram({ rootNames: virtualFiles.map((v) => v.fileName), options, host, oldProgram })
		oldProgram = program
		onProgram?.(program)

		const diagnostics: RawDiagnostic[] = []
		for (const vf of virtualFiles) {
			const sourceFile = program.getSourceFile(vf.fileName)
			if (!sourceFile) {
				continue
			}
			for (const diagnostic of [
				...program.getSyntacticDiagnostics(sourceFile),
				...program.getSemanticDiagnostics(sourceFile),
			]) {
				diagnostics.push(fromTsDiagnostic(diagnostic, vf))
			}
		}
		return diagnostics
	},
}

function fromTsDiagnostic(diagnostic: ts.Diagnostic, vf: VirtualFile): RawDiagnostic {
	const ts = getTypescript()
	const base: RawDiagnostic = {
		virtualFile: vf.fileName,
		code: typeof diagnostic.code === "number" ? diagnostic.code : undefined,
		message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
		severity: severityFromCategory(diagnostic.category),
	}
	if (!diagnostic.file || typeof diagnostic.start !== "number") {
		return base
	}
	const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
	const end = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 0))
	base.start = { line: start.line, character: start.character }
	base.end = { line: end.line, character: end.character }
	return base
}

// --- engine resolution ---

/** Read the major version of the `typescript` resolvable from `cwd`, or `undefined`. */
export function projectTypescriptMajor(cwd: string): number | undefined {
	try {
		// createRequire needs a file path to resolve *from*; the file need not exist.
		const require = createRequire(join(cwd, "__kiira_engine_resolver__.js"))
		const pkgPath = require.resolve("typescript/package.json")
		const version = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version
		const major = version ? Number.parseInt(version.split(".")[0] ?? "", 10) : Number.NaN
		return Number.isNaN(major) ? undefined : major
	} catch {
		return undefined
	}
}

/**
 * Pick the checker engine for a run. `"native"` throws if the project has no
 * TypeScript 7; `"auto"` silently falls back to `"classic"` when it can't load
 * the native engine, so a missing/older TypeScript never breaks a check.
 */
export async function resolveEngine(cwd: string, engine: KiiraEngine): Promise<CheckerEngine> {
	if (engine === "classic") {
		return classicEngine
	}
	if (engine === "native") {
		const { createNativeEngine } = await import("./native-engine")
		return createNativeEngine(cwd)
	}
	// auto
	if ((projectTypescriptMajor(cwd) ?? 0) < 7) {
		return classicEngine
	}
	try {
		const { createNativeEngine } = await import("./native-engine")
		return await createNativeEngine(cwd)
	} catch {
		return classicEngine
	}
}
