import ts from "typescript"
import { buildBaseOptions, optionsForFile } from "./check"
import { resolveConfig } from "./config"
import type { SourcePosition, SourceRange, TypedownConfig, VirtualFile } from "./types"

/** A single text edit, in zero-based Markdown coordinates. */
export interface CodeFixEdit {
	markdownFile: string
	range: SourceRange
	newText: string
}

/** A code fix offered by the TypeScript language service, mapped back to Markdown. */
export interface CodeFixAction {
	/** Human-readable description, e.g. `Import 'Foo' from "@scope/pkg"`. */
	description: string
	/** TypeScript's stable fix identifier, e.g. `import`, `fixSpelling`. */
	fixName: string
	edits: CodeFixEdit[]
}

export interface GetCodeFixesInput {
	cwd: string
	virtualFiles: VirtualFile[]
	config: Partial<TypedownConfig>
	/** Markdown file (relative, posix) the fix is requested for. */
	markdownFile: string
	/** Zero-based Markdown range the user's cursor/selection covers. */
	range: SourceRange
	/** TypeScript error codes present at that range (drives which fixes apply). */
	errorCodes: number[]
}

function normalizer(): (file: string) => string {
	const caseSensitive = ts.sys.useCaseSensitiveFileNames
	return (file: string) => {
		const slashed = file.replace(/\\/g, "/")
		return caseSensitive ? slashed : slashed.toLowerCase()
	}
}

/** Build a language service that overlays the virtual files on the real filesystem. */
function createLanguageService(
	cwd: string,
	options: ts.CompilerOptions,
	virtualFiles: VirtualFile[]
): ts.LanguageService {
	const normalize = normalizer()
	const overlay = new Map<string, VirtualFile>()
	for (const vf of virtualFiles) {
		overlay.set(normalize(vf.fileName), vf)
	}

	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => options,
		getScriptFileNames: () => virtualFiles.map((v) => v.fileName),
		getScriptVersion: () => "1",
		getScriptSnapshot: (fileName) => {
			const vf = overlay.get(normalize(fileName))
			if (vf) {
				return ts.ScriptSnapshot.fromString(vf.content)
			}
			const text = ts.sys.readFile(fileName)
			return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
		},
		getCurrentDirectory: () => cwd,
		getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
		fileExists: (fileName) => overlay.has(normalize(fileName)) || ts.sys.fileExists(fileName),
		readFile: (fileName) => {
			const vf = overlay.get(normalize(fileName))
			return vf ? vf.content : ts.sys.readFile(fileName)
		},
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
		realpath: ts.sys.realpath,
	}

	return ts.createLanguageService(host, ts.createDocumentRegistry())
}

interface TargetSpan {
	vf: VirtualFile
	/** Zero-based virtual line/char of the range start and end. */
	startLine: number
	startChar: number
	endLine: number
	endChar: number
}

/** Locate the virtual file and virtual-line span for a Markdown range. */
function targetForRange(virtualFiles: VirtualFile[], markdownFile: string, range: SourceRange): TargetSpan | undefined {
	const toVirtual = (line: number): { vf: VirtualFile; virtualLine: number; delta: number } | undefined => {
		for (const vf of virtualFiles) {
			if (vf.snippet.markdownFile !== markdownFile) {
				continue
			}
			const mapping = vf.mappings.find((m) => m.markdownLine === line)
			if (mapping) {
				return { vf, virtualLine: mapping.virtualLine, delta: mapping.characterDelta }
			}
		}
		return undefined
	}

	const start = toVirtual(range.start.line)
	if (!start) {
		return undefined
	}
	const end = toVirtual(range.end.line)
	// If the end maps into a different virtual file (or is unmapped), clamp to start.
	const sameFile = end && end.vf === start.vf
	return {
		vf: start.vf,
		startLine: start.virtualLine,
		startChar: Math.max(0, range.start.character - start.delta),
		endLine: sameFile ? end.virtualLine : start.virtualLine,
		endChar: sameFile ? Math.max(0, range.end.character - end.delta) : Math.max(0, range.start.character - start.delta),
	}
}

/** Map a virtual-file offset back to a Markdown position, or null if it lands on generated code. */
function virtualOffsetToMarkdown(vf: VirtualFile, sourceFile: ts.SourceFile, offset: number): SourcePosition | null {
	const lc = sourceFile.getLineAndCharacterOfPosition(offset)
	const mapping = vf.mappings.find((m) => m.virtualLine === lc.line)
	if (!mapping || mapping.markdownLine === null) {
		return null
	}
	return { line: mapping.markdownLine, character: lc.character + mapping.characterDelta }
}

/**
 * Translate one file's text changes (in virtual coordinates) into Markdown edits.
 * Returns null if any non-insertion edit touches generated (unmapped) code — such a
 * fix cannot be safely applied to the Markdown source, so the whole action is dropped.
 */
function changesToEdits(
	change: ts.FileTextChanges,
	virtualFiles: VirtualFile[],
	program: ts.Program
): CodeFixEdit[] | null {
	const normalize = normalizer()
	const vf = virtualFiles.find((v) => normalize(v.fileName) === normalize(change.fileName))
	const sourceFile = vf ? program.getSourceFile(vf.fileName) : undefined
	if (!vf || !sourceFile) {
		return null
	}

	const edits: CodeFixEdit[] = []
	for (const textChange of change.textChanges) {
		const startOffset = textChange.span.start
		const endOffset = startOffset + textChange.span.length

		if (textChange.span.length === 0) {
			// An insertion (typically a new import). If it lands on real code, place it
			// there; if it lands on generated lines (e.g. the very top of the file, above
			// the snippet), redirect it to the top of the snippet's own code instead.
			const at = virtualOffsetToMarkdown(vf, sourceFile, startOffset)
			const position = at ?? { line: vf.snippet.codeStart.line, character: 0 }
			edits.push({
				markdownFile: vf.snippet.markdownFile,
				range: { start: position, end: position },
				newText: textChange.newText,
			})
			continue
		}

		const start = virtualOffsetToMarkdown(vf, sourceFile, startOffset)
		// `endOffset` is exclusive; when the replaced span ends right at a line break it
		// can map to the following (generated) line. Recover by mapping the last included
		// character and stepping one past it, so a tight edit on the final code line isn't
		// silently dropped. A span that genuinely reaches into generated code stays null.
		let end = virtualOffsetToMarkdown(vf, sourceFile, endOffset)
		if (!end && endOffset > startOffset) {
			const lastIncluded = virtualOffsetToMarkdown(vf, sourceFile, endOffset - 1)
			if (lastIncluded) {
				end = { line: lastIncluded.line, character: lastIncluded.character + 1 }
			}
		}
		if (!start || !end) {
			return null
		}
		edits.push({ markdownFile: vf.snippet.markdownFile, range: { start, end }, newText: textChange.newText })
	}
	return edits
}

/**
 * Ask the TypeScript language service for code fixes at a Markdown position and
 * return them with their edits mapped back to Markdown coordinates. This surfaces
 * TypeScript's own quick fixes (auto-import, spelling, add `await`, …) inside fences.
 *
 * Auto-import note: the service can only offer a symbol whose module is reachable in
 * the program — imported by some snippet in the document, or an ambient/`node_modules`
 * type. A symbol from a package that no snippet imports may not be suggested.
 */
export async function getCodeFixes(input: GetCodeFixesInput): Promise<CodeFixAction[]> {
	const { cwd, virtualFiles, config, markdownFile, range, errorCodes } = input
	if (virtualFiles.length === 0 || errorCodes.length === 0) {
		return []
	}

	const resolved = resolveConfig(config)
	const base = await buildBaseOptions(cwd, resolved)
	const options = optionsForFile(cwd, base, resolved.overrides, markdownFile)
	const ls = createLanguageService(cwd, options, virtualFiles)
	const program = ls.getProgram()
	if (!program) {
		return []
	}

	const target = targetForRange(virtualFiles, markdownFile, range)
	if (!target) {
		return []
	}
	const sourceFile = program.getSourceFile(target.vf.fileName)
	if (!sourceFile) {
		return []
	}

	const start = sourceFile.getPositionOfLineAndCharacter(target.startLine, target.startChar)
	const end = sourceFile.getPositionOfLineAndCharacter(target.endLine, target.endChar)
	const formatOptions = ts.getDefaultFormatCodeSettings("\n")
	const preferences: ts.UserPreferences = {
		includeCompletionsForModuleExports: true,
		includeCompletionsForImportStatements: true,
		importModuleSpecifierPreference: "shortest",
		quotePreference: "double",
	}

	const fixes = ls.getCodeFixesAtPosition(target.vf.fileName, start, end, errorCodes, formatOptions, preferences)
	const actions: CodeFixAction[] = []
	for (const fix of fixes) {
		let edits: CodeFixEdit[] = []
		let droppable = false
		for (const change of fix.changes) {
			const mapped = changesToEdits(change, virtualFiles, program)
			if (mapped === null) {
				droppable = true
				break
			}
			edits = [...edits, ...mapped]
		}
		if (!droppable && edits.length > 0) {
			actions.push({ description: fix.description, fixName: fix.fixName, edits })
		}
	}
	return actions
}
