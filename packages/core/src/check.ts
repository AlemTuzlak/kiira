import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import ts from "typescript"
import { loadConfig, resolveConfig } from "./config"
import { discoverMarkdownFiles } from "./discover"
import { extractSnippetsFromContent } from "./extract"
import type { TypedownCheckResult, TypedownConfig, TypedownDiagnostic, TypedownLanguage, VirtualFile } from "./types"
import { createVirtualFiles, mapVirtualLine } from "./virtual"

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	jsx: ts.JsxEmit.ReactJSX,
	strict: true,
	esModuleInterop: true,
	forceConsistentCasingInFileNames: true,
	allowJs: true,
	checkJs: true,
	skipLibCheck: true,
	noEmit: true,
}

/** Resolve which tsconfig to use: explicit config, then tsconfig.docs.json, then tsconfig.json. */
export function resolveTsconfigPath(cwd: string, tsconfig?: string): string | undefined {
	if (tsconfig) {
		return isAbsolute(tsconfig) ? tsconfig : resolve(cwd, tsconfig)
	}
	const docs = join(cwd, "tsconfig.docs.json")
	if (existsSync(docs)) {
		return docs
	}
	const base = join(cwd, "tsconfig.json")
	if (existsSync(base)) {
		return base
	}
	return undefined
}

function loadCompilerOptions(tsconfigPath: string | undefined): ts.CompilerOptions {
	if (!tsconfigPath) {
		return { ...DEFAULT_COMPILER_OPTIONS }
	}
	const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
	if (read.error || !read.config) {
		return { ...DEFAULT_COMPILER_OPTIONS }
	}
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfigPath))
	// We never emit, and lib checking is the consumer's concern, not the docs'.
	return { ...parsed.options, noEmit: true, skipLibCheck: parsed.options.skipLibCheck ?? true }
}

function scriptKindFor(lang: TypedownLanguage): ts.ScriptKind {
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

function categoryToSeverity(category: ts.DiagnosticCategory): TypedownDiagnostic["severity"] {
	switch (category) {
		case ts.DiagnosticCategory.Error:
			return "error"
		case ts.DiagnosticCategory.Warning:
			return "warning"
		default:
			return "info"
	}
}

/** Build a TS compiler host that overlays in-memory virtual files on the real filesystem. */
function createOverlayHost(options: ts.CompilerOptions, virtualFiles: VirtualFile[]): ts.CompilerHost {
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

	const originalGetSourceFile = host.getSourceFile.bind(host)
	host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
		const vf = overlay.get(normalize(fileName))
		if (vf) {
			return ts.createSourceFile(fileName, vf.content, languageVersionOrOptions, true, scriptKindFor(vf.lang))
		}
		return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate)
	}

	const originalFileExists = host.fileExists.bind(host)
	host.fileExists = (fileName) => overlay.has(normalize(fileName)) || originalFileExists(fileName)

	const originalReadFile = host.readFile.bind(host)
	host.readFile = (fileName) => {
		const vf = overlay.get(normalize(fileName))
		return vf ? vf.content : originalReadFile(fileName)
	}

	return host
}

function mapTsDiagnostic(diagnostic: ts.Diagnostic, vf: VirtualFile): TypedownDiagnostic {
	const { snippet } = vf
	const base: TypedownDiagnostic = {
		severity: categoryToSeverity(diagnostic.category),
		code: typeof diagnostic.code === "number" ? diagnostic.code : undefined,
		message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
		source: "typescript",
		markdownFile: snippet.markdownFile,
		// Fallback: anchor to the opening fence when there is no usable position.
		markdownRange: { start: snippet.markdownRange.start, end: snippet.markdownRange.start },
		virtualFile: vf.fileName,
	}

	if (!diagnostic.file || typeof diagnostic.start !== "number") {
		return base
	}

	const startLC = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
	const endLC = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 0))
	base.virtualRange = {
		start: { line: startLC.line, character: startLC.character },
		end: { line: endLC.line, character: endLC.character },
	}

	const mdStart = mapVirtualLine(vf.mappings, startLC.line)
	if (mdStart === null) {
		// The diagnostic lives in generated fixture code; anchor it to the fence.
		base.generated = true
		return base
	}

	const mdEnd = mapVirtualLine(vf.mappings, endLC.line)
	base.markdownRange = {
		start: { line: mdStart, character: startLC.character },
		// When the end maps into generated lines, there is no real end column to
		// map to, so anchor a one-character range at the start rather than adding
		// the (possibly multi-line) virtual span length to the start column.
		end:
			mdEnd !== null && mdEnd >= mdStart
				? { line: mdEnd, character: endLC.character }
				: { line: mdStart, character: startLC.character + 1 },
	}
	return base
}

export interface CheckVirtualFilesInput {
	cwd: string
	virtualFiles: VirtualFile[]
	config: Partial<TypedownConfig>
}

/** Type-check the given virtual files and return diagnostics mapped to Markdown. */
export async function checkVirtualFiles({
	cwd,
	virtualFiles,
	config,
}: CheckVirtualFilesInput): Promise<TypedownDiagnostic[]> {
	if (virtualFiles.length === 0) {
		return []
	}

	const resolved = resolveConfig(config)
	const tsconfigPath = resolveTsconfigPath(cwd, resolved.tsconfig)
	const options = loadCompilerOptions(tsconfigPath)
	const host = createOverlayHost(options, virtualFiles)
	const program = ts.createProgram({
		rootNames: virtualFiles.map((v) => v.fileName),
		options,
		host,
	})

	const diagnostics: TypedownDiagnostic[] = []
	for (const vf of virtualFiles) {
		const sourceFile = program.getSourceFile(vf.fileName)
		if (!sourceFile) {
			continue
		}
		const tsDiagnostics = [
			...program.getSyntacticDiagnostics(sourceFile),
			...program.getSemanticDiagnostics(sourceFile),
		]
		for (const diagnostic of tsDiagnostics) {
			diagnostics.push(mapTsDiagnostic(diagnostic, vf))
		}
	}
	return diagnostics
}

export interface CheckMarkdownFilesInput {
	cwd: string
	files?: string[]
	config?: Partial<TypedownConfig>
}

/** End-to-end: discover, extract, virtualize, and type-check Markdown files. */
export async function checkMarkdownFiles(input: CheckMarkdownFilesInput): Promise<TypedownCheckResult> {
	const { cwd } = input
	const userConfig = input.config ?? (await loadConfig(cwd))
	const resolved = resolveConfig(userConfig)
	const files =
		input.files ?? (await discoverMarkdownFiles({ cwd, include: resolved.include, exclude: resolved.exclude }))

	const snippets: TypedownCheckResult["snippets"] = []
	const diagnostics: TypedownDiagnostic[] = []

	for (const file of files) {
		const content = await readFile(join(cwd, file), "utf8")
		const extraction = extractSnippetsFromContent({ markdownFile: file, content, config: resolved })
		snippets.push(...extraction.snippets)
		diagnostics.push(...extraction.diagnostics)
	}

	const { virtualFiles, diagnostics: fixtureDiagnostics } = await createVirtualFiles({
		cwd,
		snippets,
		config: userConfig,
	})
	diagnostics.push(...fixtureDiagnostics)
	diagnostics.push(...(await checkVirtualFiles({ cwd, virtualFiles, config: userConfig })))

	const errors = diagnostics.filter((d) => d.severity === "error").length
	const warnings = diagnostics.filter((d) => d.severity === "warning").length

	return {
		snippets,
		virtualFiles,
		diagnostics,
		stats: {
			markdownFiles: files.length,
			snippets: snippets.length,
			checked: virtualFiles.length,
			ignored: snippets.length - virtualFiles.length,
			errors,
			warnings,
		},
	}
}
