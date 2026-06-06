// Fetches the React Bits Pro components the landing page uses. Their source is
// license-gated and not committed to this public repo, so we pull them at build
// time via the shadcn CLI using REACTBITS_LICENSE_KEY (the registry config lives
// in components.json). Skips quietly when the files are already present (local dev).
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const ITEMS = ["silk-waves-tw", "blinking-squares-tw", "falling-rays-tw", "rising-lines-tw"]
const FILES = ITEMS.map((i) => `app/components/${i.replace(/-tw$/, "")}.tsx`)

if (FILES.every((f) => existsSync(f))) {
	console.log("✓ React Bits Pro components already present — skipping fetch.")
	process.exit(0)
}

if (!process.env.REACTBITS_LICENSE_KEY) {
	console.error(
		"✗ React Bits Pro components are missing and REACTBITS_LICENSE_KEY is not set.\n" +
			"  Set it in docs/.env.local (local) or as a CI/Fly secret, then re-run.\n" +
			"  See https://pro.reactbits.dev/docs/installation"
	)
	process.exit(1)
}

console.log("⬇ Fetching React Bits Pro components via shadcn…")
// Static args only (no user input); arg array avoids any shell interpolation.
const args = ["--yes", "shadcn@latest", "add", ...ITEMS.map((i) => `@reactbits-starter/${i}`), "--yes", "--overwrite"]
const res = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" })
process.exit(res.status ?? 1)
