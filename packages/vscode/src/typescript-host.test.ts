import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type ts from "typescript"
import { findTypescript, isSupportedTypescript } from "./typescript-host"

/** A fake installed `typescript` package at `root/node_modules/typescript`. */
function installTypescript(root: string, version: string): string {
	const dir = join(root, "node_modules", "typescript")
	mkdirSync(join(dir, "lib"), { recursive: true })
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "typescript", version, main: "./lib/typescript.js" }))
	writeFileSync(join(dir, "lib", "typescript.js"), "module.exports = {}")
	return join(dir, "lib", "typescript.js")
}

const fakeModule = { version: "fake" } as unknown as typeof ts
const loader = (seen: string[]) => (path: string) => {
	seen.push(path)
	return fakeModule
}

describe("isSupportedTypescript", () => {
	it("accepts 5.4 and newer below 7", () => {
		expect(["5.4.0", "5.9.3", "6.0.1"].filter(isSupportedTypescript)).toEqual(["5.4.0", "5.9.3", "6.0.1"])
		expect(["4.9.5", "5.3.3", "7.0.0", "unknown"].filter(isSupportedTypescript)).toEqual([])
	})
})

describe("findTypescript", () => {
	it("uses the workspace's TypeScript and skips loading VS Code's", () => {
		const workspace = mkdtempSync(join(tmpdir(), "kiira-ws-ts-"))
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-"))
		const expected = installTypescript(workspace, "5.8.3")
		installTypescript(join(appRoot, "extensions"), "5.9.0")
		const seen: string[] = []
		const found = findTypescript({ workspaceFolders: [workspace], appRoot, load: loader(seen) })
		expect(found).toEqual({ workspace: [{ folder: workspace, version: "5.8.3", path: expected }], fallback: undefined })
		expect(seen).toEqual([])
	})

	it("loads VS Code's TypeScript as the fallback for a folder without one", () => {
		const withTs = mkdtempSync(join(tmpdir(), "kiira-ws-ts-"))
		const withoutTs = mkdtempSync(join(tmpdir(), "kiira-ws-none-"))
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-"))
		installTypescript(withTs, "5.8.3")
		const expected = installTypescript(join(appRoot, "extensions"), "5.9.0")
		const found = findTypescript({ workspaceFolders: [withTs, withoutTs], appRoot, load: loader([]) })
		expect(found.workspace.map((ws) => ws.folder)).toEqual([withTs])
		expect(found.fallback).toEqual({ version: "5.9.0", path: expected, module: fakeModule })
	})

	it("skips an unsupported TypeScript in the workspace and in VS Code", () => {
		const workspace = mkdtempSync(join(tmpdir(), "kiira-ws-ts7-"))
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-"))
		installTypescript(workspace, "7.0.0")
		// VS Code 1.85-1.87 ship TypeScript 5.3, which kiira-core cannot use.
		installTypescript(join(appRoot, "extensions"), "5.3.3")
		expect(findTypescript({ workspaceFolders: [workspace], appRoot, load: loader([]) })).toEqual({
			workspace: [],
			fallback: undefined,
		})
	})

	it("does not look above the workspace folder", () => {
		const parent = mkdtempSync(join(tmpdir(), "kiira-parent-"))
		const workspace = join(parent, "project")
		mkdirSync(workspace)
		installTypescript(parent, "5.8.3")
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-empty-"))
		expect(findTypescript({ workspaceFolders: [workspace], appRoot, load: loader([]) }).workspace).toEqual([])
	})
})
