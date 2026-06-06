import {
	type CodeFixEdit,
	type KiiraConfig,
	type KiiraDiagnostic,
	type KiiraFix,
	type VirtualFile,
	getCodeFixes,
} from "kiira-core"
import * as vscode from "vscode"
import { fenceLanguageTokenRange } from "./fence-edits"

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

/** Build an in-document edit for a Kiira fix (language tag or fence metadata). */
function kiiraFixEdit(document: vscode.TextDocument, fix: KiiraFix): vscode.WorkspaceEdit | undefined {
	const edit = new vscode.WorkspaceEdit()
	if (fix.kind === "fence-language") {
		const token = fenceLanguageTokenRange(document.lineAt(fix.line).text)
		if (!token) {
			return undefined
		}
		edit.replace(document.uri, new vscode.Range(fix.line, token.start, fix.line, token.end), fix.language)
		return edit
	}
	if (fix.kind === "fence-meta") {
		const end = document.lineAt(fix.line).text.length
		edit.insert(document.uri, new vscode.Position(fix.line, end), ` ${fix.append}`)
		return edit
	}
	// config-override edits an external config file; left to `kiira check --fix`.
	return undefined
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
			const edit = kiiraFixEdit(document, diagnostic.fix)
			if (edit) {
				const action = new vscode.CodeAction(kiiraFixTitle(diagnostic.fix), vscode.CodeActionKind.QuickFix)
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

function kiiraFixTitle(fix: KiiraFix): string {
	if (fix.kind === "fence-language") {
		return `Change code fence language to \`${fix.language}\``
	}
	if (fix.kind === "fence-meta") {
		return `Add \`${fix.append}\` to this fence`
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
