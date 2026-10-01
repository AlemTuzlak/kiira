// Guards what library consumers pay for: no sourcemaps in the published files, and
// importing kiira-core must not load `typescript` (an optional peer, resolved lazily).
// Runs against the built `dist`, so it hangs off the `test:publint` target (which builds first).
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(root, "dist")
const failures = []

if (!existsSync(join(dist, "index.mjs"))) {
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
	{ entry: "dist/index.mjs", type: "module", code: `await import(${JSON.stringify(join(dist, "index.mjs"))})` },
	{ entry: "dist/index.cjs", type: "commonjs", code: `require(${JSON.stringify(join(dist, "index.cjs"))})` },
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

if (failures.length > 0) {
	process.stderr.write(`${failures.join("\n")}\n`)
	process.exit(1)
}
process.stdout.write("kiira-core package check passed\n")
