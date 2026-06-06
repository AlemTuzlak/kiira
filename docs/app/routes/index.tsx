import { useNavigate } from "react-router"
import { Header } from "~/components/header"
import { Logo } from "~/components/logo"
import { Icon } from "~/ui/icon/icon"
import { getDomain } from "~/utils/get-domain"
import { generateMetaFields } from "~/utils/seo"
import { getLatestVersion } from "~/utils/version-resolvers"
import type { Route } from "./+types"

export const meta = ({ data }: Route.MetaArgs) => {
	const { domain } = data
	return generateMetaFields({
		domain,
		path: "/",
		title: "Kiira",
		description:
			"Type-check the TypeScript and JavaScript code fences inside your Markdown docs against your real project API — in your editor, on the CLI, and in CI.",
	})
}

export async function loader({ request }: Route.LoaderArgs) {
	const { domain } = getDomain(request)
	return { domain }
}

const DOCS_BASE = `/${getLatestVersion()}`
const GITHUB_URL = "https://github.com/AlemTuzlak/kiira"
const NPM_URL = "https://www.npmjs.com/package/kiira"
const MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=CodeForge.kiira-vscode"

type CardDef = {
	icon: React.ComponentProps<typeof Icon>["name"]
	title: string
	body: string
	href: string
}

const CARDS: CardDef[] = [
	{
		icon: "Code",
		title: "Real type checking",
		body: "Kiira runs the code fences in your Markdown through the TypeScript compiler against your real project API — invalid imports, missing exports, and wrong option names fail.",
		href: `${DOCS_BASE}/getting-started`,
	},
	{
		icon: "FileText",
		title: "Errors on the Markdown line",
		body: "Diagnostics map back to the exact line inside the fence — in your editor, on the CLI, and in CI — not to some generated virtual file.",
		href: `${DOCS_BASE}/cli/reporters`,
	},
	{
		icon: "Search",
		title: "Catches hallucinated APIs",
		body: "Docs written by AI agents love to invent APIs. Kiira catches invalid imports, wrong subpaths, bad prop names, and non-copy-pasteable examples.",
		href: `${DOCS_BASE}/fences/fence-metadata`,
	},
	{
		icon: "Bot",
		title: "Monorepo aware",
		body: "Workspace mode discovers your pnpm/npm/yarn packages and resolves @your-scope/* and third-party imports with no hand-written tsconfig paths.",
		href: `${DOCS_BASE}/projects/monorepos`,
	},
	{
		icon: "Palette",
		title: "Editor + CLI + CI",
		body: "A VS Code extension for live diagnostics, a kiira CLI for local checks and --fix, and a GitHub Action for annotations in pull requests.",
		href: `${DOCS_BASE}/ci/github-action`,
	},
	{
		icon: "ShieldCheck",
		title: "Quick fixes & --fix",
		body: "Kiira rewrites mistagged ts fences to tsx, groups continuation snippets, and surfaces TypeScript's own quick fixes in your editor.",
		href: `${DOCS_BASE}/cli/fix`,
	},
]

type SurfaceDef = {
	icon: React.ComponentProps<typeof Icon>["name"]
	title: string
	body: string
	cta: string
	href: string
	internal?: boolean
}

const SURFACES: SurfaceDef[] = [
	{
		icon: "Code",
		title: "CLI",
		body: "Install kiira and run kiira check locally or in CI.",
		cta: "View on npm",
		href: NPM_URL,
	},
	{
		icon: "FileText",
		title: "VS Code",
		body: "Live diagnostics and quick fixes as you write Markdown.",
		cta: "Get the extension",
		href: MARKETPLACE_URL,
	},
	{
		icon: "Github",
		title: "GitHub Action",
		body: "Annotate failing docs on the exact line of every pull request.",
		cta: "Read the guide",
		href: `${DOCS_BASE}/ci/github-action`,
		internal: true,
	},
]

function Card({ icon, title, body, href }: CardDef) {
	return (
		<a
			href={href}
			className="group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 text-left transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#2c8794]"
		>
			<div className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-gradient-to-r from-[#2c8794] to-[#329baa]">
				<Icon name={icon} className="size-6 text-white" />
			</div>
			<h3 className="mb-2 font-semibold text-[var(--color-text-active)] text-lg">{title}</h3>
			<p className="text-[var(--color-text-muted)] text-sm leading-relaxed">{body}</p>
			<span className="mt-3 inline-flex items-center gap-1 font-medium text-[var(--color-text-active)] text-sm">
				Learn more <Icon name="ChevronRight" className="size-4" />
			</span>
		</a>
	)
}

function CommandBlock() {
	return (
		<pre className="w-full max-w-2xl overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-background-active)] px-5 py-4 text-left font-mono text-[var(--color-text-active)] text-sm">
			<code>
				<span className="text-[var(--color-text-muted)]">$ </span>pnpm add -D kiira
				{"\n"}
				<span className="text-[var(--color-text-muted)]">$ </span>pnpm kiira init
				{"\n"}
				<span className="text-[var(--color-text-muted)]">$ </span>pnpm kiira check
			</code>
		</pre>
	)
}

function ExampleBlock() {
	return (
		<div className="w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-active)] text-left">
			<div className="flex items-center gap-2 border-[var(--color-border)] border-b px-4 py-2 text-[var(--color-text-muted)] text-xs">
				<Icon name="FileText" className="size-4" />
				README.md
			</div>
			<pre className="overflow-x-auto px-5 py-4 font-mono text-sm leading-relaxed">
				<code>
					<span className="text-[var(--color-text-muted)]">```ts{"\n"}</span>
					<span className="text-[var(--color-text-normal)]">
						import {"{"} renderToString {"}"} from "your-lib"
					</span>
					{"\n"}
					<span className="text-[var(--color-text-muted)]">```{"\n"}</span>
				</code>
			</pre>
			<div className="flex items-start gap-2 border-[var(--color-border)] border-t px-5 py-3 text-sm">
				<Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0 text-[#fb4bb5]" />
				<span className="text-[var(--color-text-muted)]">
					<span className="font-medium text-[var(--color-text-active)]">TS2305</span> — Module "your-lib" has no
					exported member "renderToString". <span className="text-[var(--color-text-active)]">Caught on line 2.</span>
				</span>
			</div>
		</div>
	)
}

export default function Index() {
	const navigate = useNavigate()

	return (
		<div className="flex min-h-screen flex-col bg-[var(--color-background)] 2xl:container 2xl:mx-auto">
			<Header>
				<Logo>
					<span className="p-0">Kiira</span>
				</Logo>
			</Header>

			<main className="flex flex-1 flex-col items-center">
				<section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-7 px-6 py-16 text-center">
					<div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-info-border)] bg-[var(--color-info-bg)] px-3 py-1 text-[var(--color-info-text)] text-sm">
						<Icon name="Zap" className="size-4" />
						Version {getLatestVersion()} now available
					</div>

					<h1 className="font-bold text-3xl text-[var(--color-text-active)] leading-snug md:text-4xl xl:text-5xl">
						Type-check the code{" "}
						<span className="bg-gradient-to-r from-[#48ddf3] to-[#fb4bb5] bg-clip-text text-transparent">
							in your Markdown
						</span>
					</h1>

					<p className="max-w-2xl text-[var(--color-text-muted)] text-lg leading-relaxed">
						Kiira runs the TypeScript and JavaScript code fences in your docs through the compiler against your real
						project API, reporting errors on the exact Markdown line — in your editor, on the CLI, and in CI.
					</p>

					<CommandBlock />

					<div className="flex flex-wrap items-center justify-center gap-4">
						<button
							type="button"
							onClick={() => navigate(`${DOCS_BASE}/getting-started`)}
							className="flex items-center gap-2 rounded-lg bg-[#2c8794] px-6 py-3 font-medium text-white transition-colors hover:bg-[#329baa]"
						>
							<Icon name="Rocket" className="size-5" />
							Get started
						</button>

						<a
							href={GITHUB_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 rounded-lg bg-[var(--color-background-active)] px-6 py-3 font-medium text-[var(--color-text-active)] transition-colors hover:bg-[var(--color-border)]"
						>
							<Icon name="Github" className="size-5" />
							View on GitHub
						</a>
					</div>
				</section>

				<section className="w-full border-[var(--color-border)] border-y bg-[var(--color-background-active)]/40">
					<div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-14 text-center">
						<h2 className="font-semibold text-2xl text-[var(--color-text-active)]">
							Broken examples fail like broken code
						</h2>
						<p className="max-w-2xl text-[var(--color-text-muted)]">
							A snippet that imports something your library doesn't export is a real type error — and Kiira points
							right at it.
						</p>
						<ExampleBlock />
					</div>
				</section>

				<section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 py-16 text-center">
					<h2 className="font-semibold text-2xl text-[var(--color-text-active)]">Everything Kiira gives you</h2>
					<div className="grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{CARDS.map((c) => (
							<Card key={c.title} {...c} />
						))}
					</div>
				</section>

				<section className="w-full border-[var(--color-border)] border-t bg-[var(--color-background-active)]/40">
					<div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 py-16 text-center">
						<h2 className="font-semibold text-2xl text-[var(--color-text-active)]">Three ways to run Kiira</h2>
						<div className="grid w-full gap-6 sm:grid-cols-3">
							{SURFACES.map((s) => (
								<a
									key={s.title}
									href={s.href}
									target={s.internal ? undefined : "_blank"}
									rel={s.internal ? undefined : "noopener noreferrer"}
									className="group flex flex-col items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#2c8794]"
								>
									<div className="inline-flex size-12 items-center justify-center rounded-xl bg-gradient-to-r from-[#2c8794] to-[#329baa]">
										<Icon name={s.icon} className="size-6 text-white" />
									</div>
									<h3 className="font-semibold text-[var(--color-text-active)] text-lg">{s.title}</h3>
									<p className="text-[var(--color-text-muted)] text-sm leading-relaxed">{s.body}</p>
									<span className="mt-1 inline-flex items-center gap-1 font-medium text-[var(--color-text-active)] text-sm">
										{s.cta} <Icon name="ChevronRight" className="size-4" />
									</span>
								</a>
							))}
						</div>
					</div>
				</section>

				<footer className="mx-auto w-full max-w-6xl px-6 py-10 text-center text-[var(--color-text-muted)] text-sm">
					Kiira ·{" "}
					<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--color-text)]">
						github.com/AlemTuzlak/kiira
					</a>{" "}
					· MIT
				</footer>
			</main>
		</div>
	)
}
