// Guards what library consumers pay for: no sourcemaps in the published files, and
// importing kiira-core must not load `typescript` (an optional peer, resolved lazily).
// Runs against the built `dist`, so it hangs off the `test:publint` target (which builds first).
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(root, "dist")
const failures = []

if (!existsSync(join(dist, "index.mjs")) || !existsSync(join(dist, "plugin.mjs"))) {
	process.stderr.write("dist is missing; run the build first.\n")
	process.exit(1)
}

const maps = readdirSync(dist).filter((file) => file.endsWith(".map"))
if (maps.length > 0) {
	failures.push(`dist contains sourcemaps: ${maps.join(", ")}`)
}

// Both the ESM and CJS entries register anything they load in `require.cache`.
const listLoaded = `
const { createRequire } = require("node:module")
const cache = Object.keys(createRequire(process.cwd() + "/").cache)
process.stdout.write(JSON.stringify(cache.filter((file) => /[\\\\/]node_modules[\\\\/](typescript|jiti)[\\\\/]/.test(file))))
`
const probes = [
	{
		entry: "dist/index.mjs",
		type: "module",
		code: `await import(${JSON.stringify(pathToFileURL(join(dist, "index.mjs")).href)})`,
	},
	{ entry: "dist/index.cjs", type: "commonjs", code: `require(${JSON.stringify(join(dist, "index.cjs"))})` },
	{
		entry: "dist/plugin.mjs",
		type: "module",
		code: `await import(${JSON.stringify(pathToFileURL(join(dist, "plugin.mjs")).href)})`,
	},
	{ entry: "dist/plugin.cjs", type: "commonjs", code: `require(${JSON.stringify(join(dist, "plugin.cjs"))})` },
]

for (const { entry, type, code } of probes) {
	const script =
		type === "module"
			? `import { createRequire as r } from "node:module"\nglobalThis.require = r(import.meta.url)\n${code}\n${listLoaded}`
			: `${code}\n${listLoaded}`
	const result = spawnSync(process.execPath, ["--input-type", type, "-e", script], { cwd: root, encoding: "utf8" })
	if (result.status !== 0) {
		failures.push(`importing ${entry} failed:\n${result.stderr}`)
		continue
	}
	const offenders = JSON.parse(result.stdout || "[]")
	if (offenders.length > 0) {
		failures.push(`importing ${entry} loaded optional peers: ${offenders.slice(0, 3).join(", ")}`)
	}
}

// The MDX parser (acorn et al.) is only for `.mdx` files and must stay in lazily loaded
// chunks. Those packages are ESM-only and bundled, so they never show up in `require.cache`;
// instead, follow each entry's static chunk imports (dynamic `import()` is not followed)
// and fail if any of them contains the parser.
const staticChunkImport =
	/^(?:import\b[^\n]*?\bfrom\s*|import\s*|(?:const|var|let)\s[^\n=]*=\s*require\()["'](\.\/[^"']+)["']/gm
const mdxChunk = /micromark-extension-mdxjs/
const acornSource = /acorn/i

for (const entry of ["index.mjs", "index.cjs", "plugin.mjs", "plugin.cjs"]) {
	const seen = new Set()
	const queue = [entry]
	while (queue.length > 0) {
		const file = queue.pop()
		if (seen.has(file)) {
			continue
		}
		seen.add(file)
		const source = readFileSync(join(dist, file), "utf8")
		if (mdxChunk.test(file) || acornSource.test(source)) {
			failures.push(`dist/${entry} statically loads the MDX parser via dist/${file}`)
			break
		}
		for (const match of source.matchAll(staticChunkImport)) {
			queue.push(match[1].slice(2))
		}
	}
}

// `kiira-core/plugin` is for plugin authors: it must stay free of runtime imports.
for (const file of ["plugin.mjs", "plugin.cjs"]) {
	const source = readFileSync(join(dist, file), "utf8")
	if (/^\s*import\b|\brequire\(/m.test(source)) {
		failures.push(`dist/${file} has runtime imports`)
	}
}

if (failures.length > 0) {
	process.stderr.write(`${failures.join("\n")}\n`)
	process.exit(1)
}
process.stdout.write("kiira-core package check passed\n")
