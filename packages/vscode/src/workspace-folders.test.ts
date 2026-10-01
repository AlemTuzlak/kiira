import { describe, expect, it, vi } from "vitest"
import { closeRemovedWorkspaceFolderSessions } from "./workspace-folders"

describe("closeRemovedWorkspaceFolderSessions", () => {
	it("closes one native session for each removed workspace folder", async () => {
		const closeSession = vi.fn(async (_cwd: string) => undefined)

		await closeRemovedWorkspaceFolderSessions(
			[{ uri: { fsPath: "/workspace/one" } }, { uri: { fsPath: "/workspace/two" } }],
			closeSession
		)

		expect(closeSession.mock.calls).toEqual([["/workspace/one"], ["/workspace/two"]])
	})
})
