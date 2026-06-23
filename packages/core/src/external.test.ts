import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectPackageManager } from "./external"

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "kiira-ext-"))
}

describe("detectPackageManager", () => {
	it("defaults to npm when no lockfile is present", () => {
		expect(detectPackageManager(tempDir())).toBe("npm")
	})

	it("detects pnpm, yarn, and bun from their lockfiles", () => {
		const pnpm = tempDir()
		writeFileSync(join(pnpm, "pnpm-lock.yaml"), "")
		expect(detectPackageManager(pnpm)).toBe("pnpm")

		const yarn = tempDir()
		writeFileSync(join(yarn, "yarn.lock"), "")
		expect(detectPackageManager(yarn)).toBe("yarn")

		const bun = tempDir()
		writeFileSync(join(bun, "bun.lock"), "")
		expect(detectPackageManager(bun)).toBe("bun")
	})

	it("prefers bun when both bun and npm lockfiles exist", () => {
		const dir = tempDir()
		writeFileSync(join(dir, "bun.lockb"), "")
		writeFileSync(join(dir, "package-lock.json"), "{}")
		expect(detectPackageManager(dir)).toBe("bun")
	})
})
