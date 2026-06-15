import { glob } from "tinyglobby"

export interface DiscoverInput {
	cwd: string
	include: string[]
	exclude?: string[]
}

const ALWAYS_IGNORE = ["**/node_modules/**", "**/dist/**", "**/.kiira/**"]

function toPosix(path: string): string {
	return path.split("\\").join("/")
}

/**
 * Discover Markdown files under `cwd` matching the `include` globs and not
 * matching `exclude`. Results are posix-relative to `cwd`, de-duplicated, and
 * sorted. Only files ending in `.md` or `.mdx` are returned even if a broader
 * glob matches.
 */
export async function discoverMarkdownFiles({ cwd, include, exclude = [] }: DiscoverInput): Promise<string[]> {
	const matches = await glob(include, {
		cwd,
		ignore: [...exclude, ...ALWAYS_IGNORE],
		onlyFiles: true,
		dot: false,
	})

	const markdown = matches.map(toPosix).filter((file) => /\.mdx?$/i.test(file))

	return Array.from(new Set(markdown)).sort()
}
