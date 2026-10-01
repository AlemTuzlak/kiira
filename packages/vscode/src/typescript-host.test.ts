import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type ts from "typescript"
import { findTypescript } from "./typescript-host"

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

describe("findTypescript", () => {
	it("prefers the workspace's TypeScript 5", () => {
		const workspace = mkdtempSync(join(tmpdir(), "kiira-ws-ts-"))
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-"))
		const expected = installTypescript(workspace, "5.8.3")
		installTypescript(join(appRoot, "extensions"), "5.9.0")
		const seen: string[] = []
		const found = findTypescript({ workspaceFolders: [workspace], appRoot, load: loader(seen) })
		expect(found).toMatchObject({ source: "workspace", version: "5.8.3", path: expected, module: fakeModule })
		expect(seen).toEqual([expected])
	})

	it("falls back to VS Code's TypeScript when the workspace has none", () => {
		const workspace = mkdtempSync(join(tmpdir(), "kiira-ws-none-"))
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-"))
		const expected = installTypescript(join(appRoot, "extensions"), "5.9.0")
		const found = findTypescript({ workspaceFolders: [workspace], appRoot, load: loader([]) })
		expect(found).toMatchObject({ source: "vscode", version: "5.9.0", path: expected })
	})

	it("skips a workspace TypeScript 7 (no classic API) in favor of VS Code's", () => {
		const workspace = mkdtempSync(join(tmpdir(), "kiira-ws-ts7-"))
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-"))
		installTypescript(workspace, "7.0.0")
		installTypescript(join(appRoot, "extensions"), "5.9.0")
		expect(findTypescript({ workspaceFolders: [workspace], appRoot, load: loader([]) })?.source).toBe("vscode")
	})

	it("returns undefined when neither exists", () => {
		const workspace = mkdtempSync(join(tmpdir(), "kiira-ws-empty-"))
		const appRoot = mkdtempSync(join(tmpdir(), "kiira-app-empty-"))
		expect(findTypescript({ workspaceFolders: [workspace], appRoot, load: loader([]) })).toBeUndefined()
	})
})
