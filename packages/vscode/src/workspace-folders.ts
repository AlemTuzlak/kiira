import { closeNativeEngine } from "kiira-core"

interface RemovedWorkspaceFolder {
	uri: {
		fsPath: string
	}
}

export async function closeRemovedWorkspaceFolderSessions(
	removed: readonly RemovedWorkspaceFolder[],
	closeSession: (cwd: string) => Promise<void> = closeNativeEngine
): Promise<void> {
	await Promise.all(removed.map((folder) => closeSession(folder.uri.fsPath)))
}
