import { existsSync } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"
import {
	type TypedownConfig,
	type TypedownDiagnostic,
	type VirtualFile,
	checkMarkdownFiles,
	loadConfig,
	loadConfigFile,
	setTypescriptLibDir,
} from "@alemtuzlak/typedown"
import * as vscode from "vscode"
import { checkDocument } from "./check-document"
import { TypedownCodeActionProvider } from "./code-actions"
import { diagnosticCodeLabel, selectDiagnostics } from "./diagnostics"

const VIRTUAL_SCHEME = "typedown"

let collection: vscode.DiagnosticCollection
let output: vscode.OutputChannel
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const virtualFilesByDocument = new Map<string, VirtualFile[]>()
const diagnosticsByDocument = new Map<string, TypedownDiagnostic[]>()

interface TypedownSettings {
	enable: boolean
	configPath: string
	debounceMs: number
	checkOnSave: boolean
	checkOnChange: boolean
	showGeneratedDiagnostics: boolean
}

function readSettings(): TypedownSettings {
	const c = vscode.workspace.getConfiguration("typedown")
	return {
		enable: c.get<boolean>("enable", true),
		configPath: c.get<string>("configPath", "typedown.config.ts"),
		debounceMs: c.get<number>("debounceMs", 300),
		checkOnSave: c.get<boolean>("checkOnSave", true),
		checkOnChange: c.get<boolean>("checkOnChange", true),
		showGeneratedDiagnostics: c.get<boolean>("showGeneratedDiagnostics", false),
	}
}

function workspaceContext(document: vscode.TextDocument): { cwd: string; markdownFile: string } | undefined {
	if (document.uri.scheme !== "file") {
		return undefined
	}
	const folder = vscode.workspace.getWorkspaceFolder(document.uri)
	if (!folder) {
		return undefined
	}
	const cwd = folder.uri.fsPath
	const markdownFile = relative(cwd, document.uri.fsPath).split(sep).join("/")
	return { cwd, markdownFile }
}

async function loadWorkspaceConfig(cwd: string, configPath: string): Promise<Partial<TypedownConfig>> {
	try {
		const explicit = isAbsolute(configPath) ? configPath : join(cwd, configPath)
		if (existsSync(explicit)) {
			return await loadConfigFile(explicit)
		}
		return await loadConfig(cwd)
	} catch (error) {
		output.appendLine(`Failed to load config: ${(error as Error).message}`)
		return { include: ["**/*.md"] }
	}
}

function toVscodeDiagnostic(diagnostic: TypedownDiagnostic): vscode.Diagnostic {
	const { start, end } = diagnostic.markdownRange
	const range = new vscode.Range(start.line, start.character, end.line, end.character)
	const severity =
		diagnostic.severity === "error"
			? vscode.DiagnosticSeverity.Error
			: diagnostic.severity === "warning"
				? vscode.DiagnosticSeverity.Warning
				: vscode.DiagnosticSeverity.Information
	const result = new vscode.Diagnostic(range, diagnostic.message, severity)
	result.source = "typedown"
	const code = diagnosticCodeLabel(diagnostic.code)
	if (code) {
		result.code = code
	}
	return result
}

async function checkAndPublish(document: vscode.TextDocument): Promise<void> {
	const settings = readSettings()
	if (!settings.enable || document.languageId !== "markdown") {
		return
	}
	const ctx = workspaceContext(document)
	if (!ctx) {
		return
	}

	const config = await loadWorkspaceConfig(ctx.cwd, settings.configPath)
	try {
		const { diagnostics, virtualFiles } = await checkDocument({
			cwd: ctx.cwd,
			markdownFile: ctx.markdownFile,
			text: document.getText(),
			config,
			markdownUri: document.uri.toString(),
		})
		virtualFilesByDocument.set(document.uri.toString(), virtualFiles)
		const selected = selectDiagnostics(diagnostics, { showGenerated: settings.showGeneratedDiagnostics })
		// Keep the rich diagnostics (with their `fix` payloads) so the code-action
		// provider can offer quick fixes for what's currently shown.
		diagnosticsByDocument.set(document.uri.toString(), selected)
		collection.set(document.uri, selected.map(toVscodeDiagnostic))
	} catch (error) {
		output.appendLine(`Error checking ${ctx.markdownFile}: ${(error as Error).message}`)
	}
}

function scheduleCheck(document: vscode.TextDocument, delayMs: number): void {
	const key = document.uri.toString()
	const existing = debounceTimers.get(key)
	if (existing) {
		clearTimeout(existing)
	}
	debounceTimers.set(
		key,
		setTimeout(() => {
			debounceTimers.delete(key)
			void checkAndPublish(document)
		}, delayMs)
	)
}

async function checkWorkspaceCommand(): Promise<void> {
	collection.clear()
	const settings = readSettings()
	try {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const cwd = folder.uri.fsPath
			const config = await loadWorkspaceConfig(cwd, settings.configPath)
			const result = await checkMarkdownFiles({ cwd, config })
			const byFile = new Map<string, TypedownDiagnostic[]>()
			for (const d of selectDiagnostics(result.diagnostics, { showGenerated: settings.showGeneratedDiagnostics })) {
				const list = byFile.get(d.markdownFile) ?? []
				list.push(d)
				byFile.set(d.markdownFile, list)
			}
			for (const [file, diags] of byFile) {
				collection.set(vscode.Uri.file(join(cwd, file)), diags.map(toVscodeDiagnostic))
			}
		}
	} catch (error) {
		output.appendLine(`Workspace check failed: ${(error as Error).message}`)
		void vscode.window.showErrorMessage(`Typedown: workspace check failed — ${(error as Error).message}`)
	}
}

/** Serves the generated TypeScript content of a snippet for inspection. */
class VirtualContentProvider implements vscode.TextDocumentContentProvider {
	private readonly contents = new Map<string, string>()
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
	readonly onDidChange = this.emitter.event

	set(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content)
		this.emitter.fire(uri)
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? "// Typedown: no content for this virtual file."
	}
}

async function openVirtualFileCommand(provider: VirtualContentProvider): Promise<void> {
	const document = vscode.window.activeTextEditor?.document
	if (!document) {
		return
	}
	const virtualFiles = virtualFilesByDocument.get(document.uri.toString())
	if (!virtualFiles || virtualFiles.length === 0) {
		void vscode.window.showInformationMessage("Typedown: no virtual files for this document yet — check it first.")
		return
	}

	let selected: VirtualFile | undefined = virtualFiles[0]
	if (virtualFiles.length > 1) {
		const pick = await vscode.window.showQuickPick(
			virtualFiles.map((vf, index) => ({
				label: vf.fileName.split(/[\\/]/).pop() ?? vf.id,
				description: vf.snippet.meta.name,
				index,
			})),
			{ placeHolder: "Select a snippet to inspect" }
		)
		selected = pick ? virtualFiles[pick.index] : undefined
	}
	if (!selected) {
		return
	}

	const name = selected.fileName.split(/[\\/]/).pop() ?? `${selected.id}.${selected.lang}`
	const uri = vscode.Uri.from({
		scheme: VIRTUAL_SCHEME,
		path: `/${name}`,
		query: `id=${encodeURIComponent(selected.id)}`,
	})
	provider.set(uri, selected.content)
	const virtualDocument = await vscode.workspace.openTextDocument(uri)
	await vscode.window.showTextDocument(virtualDocument, { preview: true })
}

export function activate(context: vscode.ExtensionContext): void {
	// TypeScript is bundled into this extension, which breaks its built-in lookup of
	// the standard `lib.*.d.ts` files; point it at the copies shipped in `out/lib` so
	// globals (`JSON`, `Date`, DOM types) resolve instead of being flagged.
	setTypescriptLibDir(join(__dirname, "lib"))

	collection = vscode.languages.createDiagnosticCollection("typedown")
	output = vscode.window.createOutputChannel("Typedown")
	const provider = new VirtualContentProvider()

	context.subscriptions.push(
		collection,
		output,
		vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, provider),
		vscode.workspace.onDidOpenTextDocument((document) => void checkAndPublish(document)),
		vscode.workspace.onDidChangeTextDocument((event) => {
			const settings = readSettings()
			if (settings.checkOnChange && event.document.languageId === "markdown") {
				scheduleCheck(event.document, settings.debounceMs)
			}
		}),
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (readSettings().checkOnSave) {
				void checkAndPublish(document)
			}
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			collection.delete(document.uri)
			virtualFilesByDocument.delete(document.uri.toString())
			diagnosticsByDocument.delete(document.uri.toString())
		}),
		vscode.commands.registerCommand("typedown.checkCurrentFile", () => {
			const document = vscode.window.activeTextEditor?.document
			if (document) {
				void checkAndPublish(document)
			}
		}),
		vscode.commands.registerCommand("typedown.checkWorkspace", () => void checkWorkspaceCommand()),
		vscode.commands.registerCommand("typedown.openVirtualFile", () => void openVirtualFileCommand(provider)),
		vscode.commands.registerCommand("typedown.restartServer", () => {
			collection.clear()
			virtualFilesByDocument.clear()
			diagnosticsByDocument.clear()
			for (const document of vscode.workspace.textDocuments) {
				void checkAndPublish(document)
			}
		}),
		vscode.languages.registerCodeActionsProvider(
			{ language: "markdown" },
			new TypedownCodeActionProvider({
				resolveContext: async (document) => {
					const ctx = workspaceContext(document)
					if (!ctx) {
						return undefined
					}
					const config = await loadWorkspaceConfig(ctx.cwd, readSettings().configPath)
					return { cwd: ctx.cwd, markdownFile: ctx.markdownFile, config }
				},
				getVirtualFiles: (uri) => virtualFilesByDocument.get(uri),
				getDiagnostics: (uri) => diagnosticsByDocument.get(uri),
			}),
			{ providedCodeActionKinds: TypedownCodeActionProvider.providedKinds }
		)
	)

	for (const document of vscode.workspace.textDocuments) {
		void checkAndPublish(document)
	}
}

export function deactivate(): void {
	for (const timer of debounceTimers.values()) {
		clearTimeout(timer)
	}
	debounceTimers.clear()
	collection?.dispose()
	output?.dispose()
}
