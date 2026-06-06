// Fetches the React Bits Pro components the landing page uses. Their source is
// license-gated and not committed to this public repo, so we pull them at build
// time using REACTBITS_LICENSE_KEY. Skips quietly when the files are already
// present (local dev).
//
// We hit the Pro registry JSON directly and write the files ourselves rather than
// shelling out to `npx shadcn add`. The CLI was unreliable inside the Docker build
// (no TTY, `@latest` version drift, opaque alias resolution): it printed the
// components' doc URLs as if it had succeeded but never wrote the .tsx files, so
// the subsequent `react-router build` failed to resolve `~/components/*`. Doing
// the fetch + alias rewrite here is deterministic and debuggable.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

const REGISTRY = "https://pro.reactbits.dev/api/r/starter"
const ITEMS = ["silk-waves-tw", "blinking-squares-tw", "falling-rays-tw", "rising-lines-tw"]
const OUT_DIR = "app/components"

// Mirror the shadcn alias rewrite for these components. The registry source uses
// `@/…` import aliases; map them to this project's `~/…` aliases (see
// components.json). Only `@/lib/utils` appears today, but the broader map keeps us
// safe if a future component pulls another shared module. Order matters: the most
// specific prefix (`@/lib/utils`) must win over the general `@/lib/` rule.
const ALIAS_REWRITES = [
	[/@\/lib\/utils/g, "~/utils/css"],
	[/@\/lib\//g, "~/utils/"],
	[/@\/components\//g, "~/components/"],
	[/@\/ui\//g, "~/ui/"],
	[/@\/hooks\//g, "~/hooks/"],
]

const targetPath = (item) => join(OUT_DIR, `${item.replace(/-tw$/, "")}.tsx`)

if (ITEMS.every((i) => existsSync(targetPath(i)))) {
	console.log("✓ React Bits Pro components already present — skipping fetch.")
	process.exit(0)
}

const key = process.env.REACTBITS_LICENSE_KEY
if (!key) {
	console.error(
		"✗ React Bits Pro components are missing and REACTBITS_LICENSE_KEY is not set.\n" +
			"  Set it in docs/.env.local (local) or as a CI/Fly secret, then re-run.\n" +
			"  See https://pro.reactbits.dev/docs/installation"
	)
	process.exit(1)
}

const rewriteAliases = (content) => ALIAS_REWRITES.reduce((c, [re, to]) => c.replace(re, to), content)

async function pull(item) {
	const res = await fetch(`${REGISTRY}/${item}.json`, {
		headers: { Authorization: `Bearer ${key}` },
	})
	if (!res.ok) {
		throw new Error(`${item}: registry responded ${res.status} ${res.statusText}`)
	}
	const json = await res.json()
	const files = json.files ?? []
	if (files.length === 0) {
		throw new Error(`${item}: registry item has no files`)
	}
	for (const file of files) {
		// Flatten the registry path (e.g. components/react-bits/foo.tsx) into our
		// components dir, matching how shadcn resolves the `components` alias.
		const out = join(OUT_DIR, basename(file.path))
		mkdirSync(dirname(out), { recursive: true })
		writeFileSync(out, rewriteAliases(file.content), "utf8")
		console.log(`  ✔ ${out}`)
	}
}

console.log("⬇ Fetching React Bits Pro components from the Pro registry…")
try {
	await Promise.all(ITEMS.map(pull))
} catch (err) {
	console.error(`✗ ${err.message}`)
	process.exit(1)
}

// Hard-fail if anything we promised the build is still missing.
const missing = ITEMS.map(targetPath).filter((f) => !existsSync(f))
if (missing.length > 0) {
	console.error(`✗ Expected component files were not written:\n  ${missing.join("\n  ")}`)
	process.exit(1)
}
console.log("✓ React Bits Pro components ready.")
