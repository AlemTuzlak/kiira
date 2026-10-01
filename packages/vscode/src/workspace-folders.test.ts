import { describe, expect, it, vi } from "vitest"
import { WorkspaceFolderCheckLifecycle } from "./workspace-folders"

describe("WorkspaceFolderCheckLifecycle", () => {
	it("discards a check resumed after removal and closes after the check drains", async () => {
		const lifecycle = new WorkspaceFolderCheckLifecycle()
		let resumeConfig!: () => void
		const config = new Promise<void>((resolve) => {
			resumeConfig = resolve
		})
		const events: string[] = []

		const check = lifecycle.run("/workspace/one", async (isCurrent) => {
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
})
