import { describe, expect, it, vi } from "vitest"
import { WorkspaceFolderCheckLifecycle } from "./workspace-folders"

describe("WorkspaceFolderCheckLifecycle", () => {
	it("discards a check resumed after removal and closes after the check drains", async () => {
		const lifecycle = new WorkspaceFolderCheckLifecycle()
		lifecycle.setWorkspaceFolders([{ uri: { fsPath: "/workspace/one" } }])
		let resumeConfig!: () => void
		const config = new Promise<void>((resolve) => {
			resumeConfig = resolve
		})
		const events: string[] = []

		const check = lifecycle.runIfPresent("/workspace/one", async (isCurrent) => {
			events.push("config:start")
			await config
			events.push("config:resume")
			if (!isCurrent()) {
				return
			}
			events.push("check")
			events.push("publish")
		})
		await Promise.resolve()

		const closeSession = vi.fn(async (cwd: string) => {
			events.push(`close:${cwd}`)
		})
		const removal = lifecycle.closeRemoved([{ uri: { fsPath: "/workspace/one" } }], closeSession)
		resumeConfig()
		await Promise.all([check, removal])

		expect(events).toEqual(["config:start", "config:resume", "close:/workspace/one"])
		expect(closeSession).toHaveBeenCalledExactlyOnceWith("/workspace/one")
	})

	it("keeps the session when the folder is re-added before its checks drain", async () => {
		const lifecycle = new WorkspaceFolderCheckLifecycle()
		const cwd = "/workspace/one"
		lifecycle.setWorkspaceFolders([{ uri: { fsPath: cwd } }])
		let resumeCheck!: () => void
		const blocked = new Promise<void>((resolve) => {
			resumeCheck = resolve
		})
		const check = lifecycle.runIfPresent(cwd, () => blocked)
		await Promise.resolve()

		lifecycle.setWorkspaceFolders([])
		const closeSession = vi.fn(async () => undefined)
		const removal = lifecycle.closeRemoved([{ uri: { fsPath: cwd } }], closeSession)
		lifecycle.setWorkspaceFolders([{ uri: { fsPath: cwd } }])
		resumeCheck()
		await Promise.all([check, removal])

		expect(closeSession).not.toHaveBeenCalled()
	})

	it("skips a removed folder queued behind a deferred workspace check", async () => {
		const lifecycle = new WorkspaceFolderCheckLifecycle()
		const first = "/workspace/one"
		const removed = "/workspace/two"
		lifecycle.setWorkspaceFolders([{ uri: { fsPath: first } }, { uri: { fsPath: removed } }])
		let resumeConfig!: () => void
		let configStarted!: () => void
		const config = new Promise<void>((resolve) => {
			resumeConfig = resolve
		})
		const started = new Promise<void>((resolve) => {
			configStarted = resolve
		})
		const events: string[] = []

		const checkWorkspace = async () => {
			for (const cwd of [first, removed]) {
				await lifecycle.runIfPresent(cwd, async (isCurrent) => {
					events.push(`config:${cwd}`)
					if (cwd === first) {
						configStarted()
						await config
					}
					if (!isCurrent()) {
						return
					}
					events.push(`publish:${cwd}`)
				})
			}
		}

		const running = checkWorkspace()
		await started
		lifecycle.setWorkspaceFolders([{ uri: { fsPath: first } }])
		const closeSession = vi.fn(async (cwd: string) => {
			events.push(`close:${cwd}`)
		})
		await lifecycle.closeRemoved([{ uri: { fsPath: removed } }], closeSession)
		resumeConfig()
		await running

		expect(events).toEqual([`config:${first}`, `close:${removed}`, `publish:${first}`])
		expect(closeSession).toHaveBeenCalledExactlyOnceWith(removed)
	})
})
