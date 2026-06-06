import { type ExecSyncOptions, execSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import chalk from "chalk"
import semver from "semver"

const contentDir = "content"
const workspaceRoot = process.cwd()
const outputDir = resolve(workspaceRoot, "generated-docs")

type RunOpts = { cwd?: string; inherit?: boolean }
function run(cmd: string, opts: RunOpts = {}) {
	const exOpts: ExecSyncOptions = {
		cwd: opts.cwd,
		stdio: opts.inherit ? "inherit" : "pipe",
		encoding: "utf8",
	}
	try {
		const res = execSync(cmd, exOpts)
		if (opts.inherit) return ""
		if (typeof res === "string") return res.trim()
		return (res?.toString?.("utf8") ?? "").trim()
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err)
		throw new Error(`Command failed: ${cmd}\n${msg}`)
	}
}

const ensureDir = (p: string) => mkdirSync(p, { recursive: true })
const resetDir = (p: string) => {
	if (existsSync(p)) rmSync(p, { recursive: true, force: true })
	ensureDir(p)
}

let repoRoot = workspaceRoot
let workspaceRelativePath = ""
try {
	repoRoot = run("git rev-parse --show-toplevel")
	// biome-ignore lint/style/useTemplate: <explanation>
	workspaceRelativePath = repoRoot === workspaceRoot ? "" : workspaceRoot.replace(repoRoot + "/", "")
} catch {
	workspaceRelativePath = ""
}

const allTags = () => run("git tag --list").split("\n").filter(Boolean)

function resolveTagsFromSpec(spec: string) {
	const tags = allTags().filter((t) => semver.valid(t))
	const tokens = spec
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean)
	const matched = tags.filter((tag) =>
		tokens.some((token) => semver.satisfies(tag, token, { includePrerelease: true }))
	)
	return matched.sort(semver.rcompare)
}

function hasLocalRef(ref: string) {
	try {
		run(`git show-ref --verify --quiet ${ref}`)
		return true
	} catch {
		return false
	}
}

function buildDocs(sourceDir: string, outDir: string) {
	if (!existsSync(sourceDir)) {
		throw new Error(
			`❌ Documentation workspace not found at: ${sourceDir}
   Cannot build documentation without a valid workspace directory.`
		)
	}

	// biome-ignore lint/suspicious/noConsole: TODO remove this
	console.log(chalk.cyan(`Building docs from: ${sourceDir} → ${outDir}`))
	const docsContentDir = resolve(sourceDir, contentDir)
	if (!existsSync(docsContentDir)) {
		throw new Error(
			`❌ Content directory "${contentDir}" not found at: ${docsContentDir}
   Cannot build documentation without content files.
   Please ensure you have a "${contentDir}/" directory with your documentation content.`
		)
	}

	const packageJsonPath = resolve(sourceDir, "package.json")
	if (!existsSync(packageJsonPath)) {
		throw new Error(
			`❌ package.json not found at: ${packageJsonPath}
   Cannot build documentation without package.json.
   Please ensure your workspace has a valid package.json file.`
		)
	}

	resetDir(outDir)
	run("pnpm run content-collections:build", { cwd: sourceDir, inherit: true })

	const ccSrc = resolve(sourceDir, ".content-collections")
	const ccDest = join(outDir, ".content-collections")
	if (!existsSync(ccSrc)) {
		throw new Error(
			`❌ Build output missing at: ${ccSrc}
   Content collections build failed or did not produce output.
   Please check the build logs above for errors.`
		)
	}

	resetDir(ccDest)
	cpSync(ccSrc, ccDest, { recursive: true })

	// biome-ignore lint/suspicious/noConsole: keep for debugging
	console.log(chalk.green(`✔ Built docs → ${ccDest}`))
}

function buildRef(ref: string, labelForOutDir: string) {
	const tmpBase = mkdtempSync(resolve(os.tmpdir(), "docs-wt-"))
	const safeLabel = labelForOutDir.replace(/[^\w.-]+/g, "_")
	const worktreePath = resolve(tmpBase, safeLabel)

	run(`git worktree add --detach "${worktreePath}" "${ref}"`, {
		cwd: workspaceRoot,
		inherit: true,
	})

	try {
		const rootPkg = existsSync(resolve(worktreePath, "package.json"))
		const rootLock = existsSync(resolve(worktreePath, "pnpm-lock.yaml"))
		if (rootPkg) {
			run(`pnpm install ${rootLock ? "--frozen-lockfile" : "--no-frozen-lockfile"}`, {
				cwd: worktreePath,
				inherit: true,
			})
		}

		const sourceDir = workspaceRelativePath ? resolve(worktreePath, workspaceRelativePath) : worktreePath
		const outDir = resolve(outputDir, labelForOutDir)
		buildDocs(sourceDir, outDir)
	} finally {
		run(`git worktree remove "${worktreePath}" --force`, {
			cwd: workspaceRoot,
			inherit: true,
		})
		rmSync(tmpBase, { recursive: true, force: true })
	}
}

function buildBranch(branch: string, labelForOutDir: string) {
	run(`git fetch --tags --prune origin ${branch}`, {
		cwd: workspaceRoot,
		inherit: true,
	})
	const localRef = `refs/heads/${branch}`
	const targetRef = hasLocalRef(localRef) ? localRef : `origin/${branch}`
	return buildRef(targetRef, labelForOutDir)
}

function buildTag(tag: string) {
	return buildRef(`refs/tags/${tag}`, tag)
}

function getCurrentBranch(): string {
	try {
		return run("git rev-parse --abbrev-ref HEAD")
	} catch {
		throw new Error("Failed to get current branch")
	}
}

function isOnDefaultBranch(defaultBranch: string): boolean {
	const currentBranch = getCurrentBranch()
	return currentBranch === defaultBranch
}

function parseCliArgs() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			versions: { type: "string" },
			branch: { type: "string" },
		},
	})

	const defaultBranch = (values.branch as string | undefined)?.trim()
	if (!defaultBranch) {
		throw new Error(
			"❌ Missing required --branch flag.\n" +
				"   Please specify the default branch name (e.g., --branch main)\n" +
				"   Example: pnpm run generate:docs --branch main"
		)
	}

	const versionsSpec = (values.versions as string | undefined)?.trim() || undefined

	return { defaultBranch, versionsSpec }
}

function buildLatestVersion(onDefaultBranch: boolean, defaultBranch: string) {
	if (onDefaultBranch) {
		buildBranch(defaultBranch, "latest")
	} else {
		buildDocs(workspaceRoot, join(outputDir, "latest"))
	}
}

function writeVersionsFile(versions: string[]) {
	const versionsFile = resolve("app/utils/versions.ts")
	const content = `// Auto-generated file. Do not edit manually.\nexport const versions = ${JSON.stringify(versions, null, 2)} as const\n`

	writeFileSync(versionsFile, content)
}

async function main() {
	const { defaultBranch, versionsSpec } = parseCliArgs()

	const onDefaultBranch = isOnDefaultBranch(defaultBranch)

	let builtVersions: string[]

	if (versionsSpec) {
		const tags = resolveTagsFromSpec(versionsSpec)
		if (tags.length === 0) {
			throw new Error(`No tags matched spec "${versionsSpec}".`)
		}

		// biome-ignore lint/suspicious/noConsole: keep for debugging
		console.log(chalk.cyan(`Building tags: ${tags.join(", ")}`))
		for (const tag of tags) {
			buildTag(tag)
		}

		buildLatestVersion(onDefaultBranch, defaultBranch)
		builtVersions = ["latest", ...tags]
	} else {
		buildLatestVersion(onDefaultBranch, defaultBranch)
		builtVersions = ["latest"]
	}

	writeVersionsFile(builtVersions)
	// biome-ignore lint/suspicious/noConsole: keep for debugging
	console.log(chalk.green("✅ Done"))
}

main().catch((error) => {
	// biome-ignore lint/suspicious/noConsole: keep for debugging
	console.error(chalk.red("❌ Build failed:"), error)
	process.exit(1)
})
