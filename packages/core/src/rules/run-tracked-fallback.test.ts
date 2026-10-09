import * as childProcess from "node:child_process"
import { createProject } from "./run"
import { tempProject } from "./test-helpers"

// Pass every git call through, so one test can make the full listing fail.
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>()
	return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

const { execFileSync } = childProcess
const realExecFileSync = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).execFileSync

const hasGit = (() => {
	try {
		realExecFileSync("git", ["--version"], { stdio: "ignore" })
		return true
	} catch {
		return false
	}
})()

// Inside a git hook these point at the outer repository; clear them so git in a temp dir sees only that dir.
beforeEach(() => {
	for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) {
		vi.stubEnv(name, undefined)
	}
})
afterEach(() => {
	vi.unstubAllEnvs()
	vi.mocked(execFileSync).mockImplementation(realExecFileSync)
})

it.skipIf(!hasGit)("isTracked asks git per path when the full listing fails", async () => {
	const cwd = tempProject({ "tracked.txt": "t", "untracked.txt": "u" })
	realExecFileSync("git", ["init", "-q"], { cwd })
	realExecFileSync("git", ["add", "tracked.txt"], { cwd })
	vi.mocked(execFileSync).mockImplementation(((file: string, args: readonly string[], options: object) => {
		if (args.includes("-z")) {
			throw new Error("stdout maxBuffer length exceeded")
		}
		return realExecFileSync(file, args, options)
	}) as typeof realExecFileSync)
	const { isTracked } = await createProject(cwd)
	expect(isTracked("tracked.txt")).toBe(true)
	expect(isTracked("untracked.txt")).toBe(false)
	expect(vi.mocked(execFileSync).mock.calls.some(([, args]) => args?.includes("--error-unmatch"))).toBe(true)
})
