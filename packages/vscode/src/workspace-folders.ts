import { closeNativeEngine } from "kiira-core"

interface RemovedWorkspaceFolder {
	uri: {
		fsPath: string
	}
}

export class WorkspaceFolderCheckLifecycle {
	private readonly generations = new Map<string, number>()
	private readonly checks = new Map<string, Set<Promise<void>>>()

	run(cwd: string, check: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
		const generation = this.generations.get(cwd) ?? 0
		const operation = Promise.resolve().then(() => check(() => (this.generations.get(cwd) ?? 0) === generation))
		let active = this.checks.get(cwd)
		if (!active) {
			active = new Set()
			this.checks.set(cwd, active)
		}
		const tracked = operation.finally(() => {
			active.delete(tracked)
			if (active.size === 0) {
				this.checks.delete(cwd)
			}
		})
		active.add(tracked)
		return tracked
	}

	async closeRemoved(
		removed: readonly RemovedWorkspaceFolder[],
		closeSession: (cwd: string) => Promise<void> = closeNativeEngine
	): Promise<void> {
		await Promise.all(
			removed.map(async (folder) => {
				const cwd = folder.uri.fsPath
				this.generations.set(cwd, (this.generations.get(cwd) ?? 0) + 1)
				await Promise.allSettled(this.checks.get(cwd) ?? [])
				await closeSession(cwd)
			})
		)
	}
}
