import { readFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import {
	type CodeFixEdit,
	type KiiraConfig,
	type KiiraDiagnostic,
	type KiiraEditsFix,
	type KiiraFenceLanguageFix,
	type KiiraFenceMetaFix,
	type KiiraFix,
	type VirtualFile,
	getCodeFixes,
} from "kiira-core"
import * as vscode from "vscode"
import { fenceLanguageTokenRange } from "./fence-edits"

type KiiraFenceFix = KiiraFenceLanguageFix | KiiraFenceMetaFix

export interface CodeActionContext {
	cwd: string
	markdownFile: string
	config: Partial<KiiraConfig>
}

export interface KiiraCodeActionDeps {
	/** Resolve the workspace context (cwd, relative path, config) for a document. */
	resolveContext: (document: vscode.TextDocument) => Promise<CodeActionContext | undefined>
	/** The virtual files from this document's most recent check. */
	getVirtualFiles: (uri: string) => VirtualFile[] | undefined
	/** The Kiira diagnostics (with their `fix` payloads) from the most recent check. */
	getDiagnostics: (uri: string) => KiiraDiagnostic[] | undefined
	/** The text this document's most recent check read, keyed by cwd-relative posix path. */
	getSources: (uri: string) => Record<string, string> | undefined
}

function overlaps(a: KiiraDiagnostic["markdownRange"], b: vscode.Range): boolean {
	const start = new vscode.Position(a.start.line, a.start.character)
	const end = new vscode.Position(a.end.line, a.end.character)
	// Treat a zero-width diagnostic as covering its whole line so the lightbulb still
	// appears when the cursor is anywhere on that line.
	const range = start.isEqual(end)
		? new vscode.Range(a.start.line, 0, a.start.line, Number.MAX_SAFE_INTEGER)
		: new vscode.Range(start, end)
	return !!range.intersection(b) || range.contains(b.start) || b.contains(start)
}

function editsToWorkspaceEdit(uri: vscode.Uri, edits: CodeFixEdit[]): vscode.WorkspaceEdit {
	const edit = new vscode.WorkspaceEdit()
	for (const e of edits) {
		const range = new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character)
		edit.replace(uri, range, e.newText)
	}
	return edit
}

/** A file's text as an edit would see it: the open (possibly unsaved) buffer, else the file on disk. */
async function currentText(uri: vscode.Uri): Promise<string | undefined> {
	const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
	if (open) {
		return open.getText()
	}
	try {
		return await readFile(uri.fsPath, "utf8")
	} catch {
		return undefined
	}
}

/**
 * A rule's `edits` fix as a workspace edit. The current document's edits apply to
 * the open (possibly unsaved) text; other files are addressed from the workspace
 * root. Refused when a file path leaves the workspace, or when any file's text is
 * not what the check read, since the ranges would then be stale.
 */
async function textEditsToWorkspaceEdit(
	document: vscode.TextDocument,
	ctx: CodeActionContext,
	fix: KiiraEditsFix,
	sources: Record<string, string>
): Promise<vscode.WorkspaceEdit | undefined> {
	const edit = new vscode.WorkspaceEdit()
	for (const e of fix.edits) {
		const file = relative(ctx.cwd, resolve(ctx.cwd, e.file)).split(sep).join("/")
		if (file.startsWith("..") || isAbsolute(e.file)) {
			return undefined
		}
		const uri = file === ctx.markdownFile ? document.uri : vscode.Uri.file(join(ctx.cwd, file))
		const source = sources[file]
		if (source === undefined || (await currentText(uri)) !== source) {
			return undefined
		}
		edit.replace(
			uri,
			new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character),
			e.newText
		)
	}
	return edit
}

/** Build an in-document edit for a Kiira fix (language tag or fence metadata). */
function kiiraFixEdit(document: vscode.TextDocument, fix: KiiraFenceFix): vscode.WorkspaceEdit | undefined {
	const edit = new vscode.WorkspaceEdit()
	if (fix.kind === "fence-language") {
		const token = fenceLanguageTokenRange(document.lineAt(fix.line).text)
		if (!token) {
			return undefined
		}
		edit.replace(document.uri, new vscode.Range(fix.line, token.start, fix.line, token.end), fix.language)
		return edit
	}
	const end = document.lineAt(fix.line).text.length
	edit.insert(document.uri, new vscode.Position(fix.line, end), ` ${fix.append}`)
	return edit
}

export class KiiraCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedKinds = [vscode.CodeActionKind.QuickFix]

	constructor(private readonly deps: KiiraCodeActionDeps) {}

	async provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		_context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): Promise<vscode.CodeAction[]> {
		const uri = document.uri.toString()
		const diagnostics = this.deps.getDiagnostics(uri) ?? []
		const inRange = diagnostics.filter((d) => overlaps(d.markdownRange, range))
		if (inRange.length === 0) {
			return []
		}

		const actions: vscode.CodeAction[] = []

		// 1) Kiira's own fixes (ts->tsx language tag, add group=).
		for (const diagnostic of inRange) {
			if (!diagnostic.fix) {
				continue
			}
			const fix = diagnostic.fix
			// config-override edits an external config file; left to `kiira check --fix`.
			if (fix.kind === "config-override") {
				continue
			}
			let edit: vscode.WorkspaceEdit | undefined
			if (fix.kind === "edits") {
				const ctx = await this.deps.resolveContext(document)
				const sources = this.deps.getSources(uri)
				edit = ctx && sources && (await textEditsToWorkspaceEdit(document, ctx, fix, sources))
			} else {
				edit = kiiraFixEdit(document, fix)
			}
			if (edit) {
				const action = new vscode.CodeAction(kiiraFixTitle(fix, diagnostic), vscode.CodeActionKind.QuickFix)
				action.edit = edit
				action.diagnostics = [toVscodeRangeDiagnostic(diagnostic)]
				actions.push(action)
			}
		}

		// 2) TypeScript quick fixes (auto-import, spelling, add await, …).
		const tsCodes = [
			...new Set(
				inRange.filter((d) => d.source === "typescript" && typeof d.code === "number").map((d) => d.code as number)
			),
		]
		if (tsCodes.length > 0 && !token.isCancellationRequested) {
			const ctx = await this.deps.resolveContext(document)
			const virtualFiles = this.deps.getVirtualFiles(uri)
			if (ctx && virtualFiles && virtualFiles.length > 0 && !token.isCancellationRequested) {
				const fixes = await getCodeFixes({
					cwd: ctx.cwd,
					virtualFiles,
					config: ctx.config,
					markdownFile: ctx.markdownFile,
					range: {
						start: { line: range.start.line, character: range.start.character },
						end: { line: range.end.line, character: range.end.character },
					},
					errorCodes: tsCodes,
					text: document.getText(),
				})
				for (const fix of fixes) {
					const action = new vscode.CodeAction(fix.description, vscode.CodeActionKind.QuickFix)
					action.edit = editsToWorkspaceEdit(document.uri, fix.edits)
					if (fix.fixName === "import") {
						action.isPreferred = true
					}
					actions.push(action)
				}
			}
		}

		return actions
	}
}

function kiiraFixTitle(fix: KiiraFix, diagnostic: KiiraDiagnostic): string {
	if (fix.kind === "fence-language") {
		return `Change code fence language to \`${fix.language}\``
	}
	if (fix.kind === "fence-meta") {
		return `Add \`${fix.append}\` to this fence`
	}
	if (fix.kind === "edits") {
		return diagnostic.message.split("\n")[0]
	}
	return "Apply Kiira fix"
}

/** A lightweight vscode.Diagnostic so the action attaches to the right squiggle. */
function toVscodeRangeDiagnostic(diagnostic: KiiraDiagnostic): vscode.Diagnostic {
	const { start, end } = diagnostic.markdownRange
	const severity =
		diagnostic.severity === "error"
			? vscode.DiagnosticSeverity.Error
			: diagnostic.severity === "warning"
				? vscode.DiagnosticSeverity.Warning
				: vscode.DiagnosticSeverity.Information
	const result = new vscode.Diagnostic(
		new vscode.Range(start.line, start.character, end.line, end.character),
		diagnostic.message,
		severity
	)
	result.source = "kiira"
	return result
}
