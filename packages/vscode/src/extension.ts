import { existsSync } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"
import {
	type KiiraConfig,
	type KiiraDiagnostic,
	type VirtualFile,
	checkMarkdownFiles,
	closeNativeEngine,
	loadConfig,
	loadConfigFile,
	setFallbackTypescriptModule,
	setTypescriptLibDir,
} from "kiira-core"
import * as vscode from "vscode"
import { checkDocument } from "./check-document"
import { KiiraCodeActionProvider } from "./code-actions"
import { diagnosticCodeLabel, selectDiagnostics } from "./diagnostics"
import { findTypescript } from "./typescript-host"

const VIRTUAL_SCHEME = "kiira"

let collection: vscode.DiagnosticCollection
let output: vscode.OutputChannel
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const virtualFilesByDocument = new Map<string, VirtualFile[]>()
const diagnosticsByDocument = new Map<string, KiiraDiagnostic[]>()
const sourcesByDocument = new Map<string, Record<string, string>>()

interface KiiraSettings {
	enable: boolean
	configPath: string
	debounceMs: number
	checkOnSave: boolean
	checkOnChange: boolean
	showGeneratedDiagnostics: boolean
}

function readSettings(): KiiraSettings {
	const c = vscode.workspace.getConfiguration("kiira")
	return {
		enable: c.get<boolean>("enable", true),
		configPath: c.get<string>("configPath", "kiira.config.ts"),
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

async function loadWorkspaceConfig(cwd: string, configPath: string): Promise<Partial<KiiraConfig>> {
	try {
		const explicit = isAbsolute(configPath) ? configPath : join(cwd, configPath)
		if (existsSync(explicit)) {
			return await loadConfigFile(explicit)
		}
		return await loadConfig(cwd)
	} catch (error) {
		output.appendLine(`Failed to load config: ${(error as Error).message}`)
		return { include: ["**/*.{md,mdx}"] }
	}
}

function toVscodeDiagnostic(diagnostic: KiiraDiagnostic): vscode.Diagnostic {
	const { start, end } = diagnostic.markdownRange
	const range = new vscode.Range(start.line, start.character, end.line, end.character)
	const severity =
		diagnostic.severity === "error"
			? vscode.DiagnosticSeverity.Error
			: diagnostic.severity === "warning"
				? vscode.DiagnosticSeverity.Warning
				: vscode.DiagnosticSeverity.Information
	const result = new vscode.Diagnostic(range, diagnostic.message, severity)
	result.source = "kiira"
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
		const { diagnostics, virtualFiles, sources } = await checkDocument({
			cwd: ctx.cwd,
			markdownFile: ctx.markdownFile,
			text: document.getText(),
			config,
			markdownUri: document.uri.toString(),
		})
		virtualFilesByDocument.set(document.uri.toString(), virtualFiles)
		sourcesByDocument.set(document.uri.toString(), sources)
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
			const byFile = new Map<string, KiiraDiagnostic[]>()
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
		void vscode.window.showErrorMessage(`Kiira: workspace check failed — ${(error as Error).message}`)
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
		return this.contents.get(uri.toString()) ?? "// Kiira: no content for this virtual file."
	}
}

async function openVirtualFileCommand(provider: VirtualContentProvider): Promise<void> {
	const document = vscode.window.activeTextEditor?.document
	if (!document) {
		return
	}
	const virtualFiles = virtualFilesByDocument.get(document.uri.toString())
	if (!virtualFiles || virtualFiles.length === 0) {
		void vscode.window.showInformationMessage("Kiira: no virtual files for this document yet — check it first.")
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

/**
 * TypeScript is loaded once, so ask for a reload when a workspace folder's
 * `node_modules/typescript` is installed, replaced, or updated. Non-recursive
 * watchers, because `files.watcherExclude` hides `node_modules` from recursive ones.
 */
function watchTypescriptInstalls(folders: readonly string[]): vscode.Disposable[] {
	let prompted = false
	const promptReload = (): void => {
		if (prompted) {
			return
		}
		prompted = true
		void vscode.window
			.showInformationMessage(
				"Kiira: TypeScript changed in the workspace. Reload the window to use it.",
				"Reload Window"
			)
			.then((choice) => {
				prompted = false
				if (choice === "Reload Window") {
					void vscode.commands.executeCommand("workbench.action.reloadWindow")
				}
			})
	}
	const watch = (base: string, pattern: string, ignoreChange = false): vscode.FileSystemWatcher => {
		const pathPattern = new vscode.RelativePattern(vscode.Uri.file(base), pattern)
		const watcher = vscode.workspace.createFileSystemWatcher(pathPattern, false, ignoreChange, false)
		watcher.onDidCreate(promptReload)
		watcher.onDidChange(promptReload)
		watcher.onDidDelete(promptReload)
		return watcher
	}
	return folders.flatMap((folder) => [
		// Changes to `node_modules` itself come from any package, so only its creation counts.
		watch(folder, "node_modules", true),
		watch(join(folder, "node_modules"), "typescript"),
		watch(join(folder, "node_modules", "typescript"), "package.json"),
	])
}

export function activate(context: vscode.ExtensionContext): void {
	collection = vscode.languages.createDiagnosticCollection("kiira")
	output = vscode.window.createOutputChannel("Kiira")

	// The extension does not bundle TypeScript (it was ~10 MB of the install).
	// kiira-core checks each folder with that folder's own TypeScript, so
	// diagnostics match the project; the copy VS Code ships for its built-in
	// TypeScript features is the fallback. Either is a real on-disk install, so
	// TypeScript finds its own `lib.*.d.ts`.
	const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
	const setup = findTypescript({ workspaceFolders: folders, appRoot: vscode.env.appRoot })
	context.subscriptions.push(collection, output, ...watchTypescriptInstalls(folders))
	if (folders.length > 0 && setup.workspace.length === 0 && !setup.fallback) {
		const message =
			"Kiira needs TypeScript 5.4 or newer (below 7): install `typescript` in the workspace, or enable VS Code's built-in TypeScript extension."
		output.appendLine(message)
		void vscode.window.showErrorMessage(message)
		return
	}
	for (const found of setup.workspace) {
		output.appendLine(`Using TypeScript ${found.version} for ${found.folder} (${found.path})`)
	}
	if (setup.fallback) {
		output.appendLine(
			`Using TypeScript ${setup.fallback.version} from VS Code for folders without their own (${setup.fallback.path})`
		)
	}
	setFallbackTypescriptModule(setup.fallback?.module)
	setTypescriptLibDir(undefined)
	const provider = new VirtualContentProvider()

	context.subscriptions.push(
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
			sourcesByDocument.delete(document.uri.toString())
		}),
		vscode.commands.registerCommand("kiira.checkCurrentFile", () => {
			const document = vscode.window.activeTextEditor?.document
			if (document) {
				void checkAndPublish(document)
			}
		}),
		vscode.commands.registerCommand("kiira.checkWorkspace", () => void checkWorkspaceCommand()),
		vscode.commands.registerCommand("kiira.openVirtualFile", () => void openVirtualFileCommand(provider)),
		vscode.commands.registerCommand("kiira.restartServer", () => {
			collection.clear()
			virtualFilesByDocument.clear()
			diagnosticsByDocument.clear()
			sourcesByDocument.clear()
			for (const document of vscode.workspace.textDocuments) {
				void checkAndPublish(document)
			}
		}),
		vscode.languages.registerCodeActionsProvider(
			{ language: "markdown" },
			new KiiraCodeActionProvider({
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
				getSources: (uri) => sourcesByDocument.get(uri),
			}),
			{ providedCodeActionKinds: KiiraCodeActionProvider.providedKinds }
		)
	)

	for (const document of vscode.workspace.textDocuments) {
		void checkAndPublish(document)
	}
}

export async function deactivate(): Promise<void> {
	for (const timer of debounceTimers.values()) {
		clearTimeout(timer)
	}
	debounceTimers.clear()
	collection?.dispose()
	output?.dispose()
	await closeNativeEngine()
}
