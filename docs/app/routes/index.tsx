import { href, useNavigate } from "react-router"
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

type CardDef = {
	icon: React.ComponentProps<typeof Icon>["name"]
	title: string
	body: string
	href?: string
}

const CARDS: CardDef[] = [
	{
		icon: "Code",
		title: "Real Type Checking",
		body: "Kiira runs the code fences in your Markdown through the TypeScript compiler against your real project API — invalid imports, missing exports, and wrong option names fail.",
	},
	{
		icon: "FileText",
		title: "Errors On The Markdown Line",
		body: "Diagnostics map back to the exact line inside the fence in your editor, on the CLI, and in CI — not to some generated virtual file.",
	},
	{
		icon: "Search",
		title: "Catches Hallucinated APIs",
		body: "Docs written by AI agents love to invent APIs. Kiira catches invalid imports, wrong subpaths, bad prop names, and non-copy-pasteable examples.",
	},
	{
		icon: "Bot",
		title: "Monorepo Aware",
		body: "Workspace mode discovers your pnpm/npm/yarn packages and resolves @your-scope/* and third-party imports with no hand-written tsconfig paths.",
	},
	{
		icon: "Palette",
		title: "Editor + CLI + CI",
		body: "A VS Code extension for live diagnostics, a kiira CLI for local checks and --fix, and a GitHub Action for annotations in pull requests.",
	},
	{
		icon: "ShieldCheck",
		title: "Quick Fixes & --fix",
		body: "Kiira rewrites mistagged ts fences to tsx, groups continuation snippets, and surfaces TypeScript's own quick fixes in your editor.",
	},
]

function Card({ icon, title, body, href }: CardDef) {
	return (
		<a
			href={href}
			className="group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#2c8794]"
		>
			<div className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-gradient-to-r from-[#2c8794] to-[#329baa]">
				<Icon name={icon} className="size-6 text-white" />
			</div>
			<h3 className="mb-2 font-semibold text-[var(--color-text-active)] text-lg">{title}</h3>
			<p className="text-[var(--color-text-muted)] text-sm leading-relaxed">{body}</p>
			{href ? (
				<span className="mt-3 inline-flex items-center gap-1 font-medium text-[var(--color-text-active)] text-sm">
					Learn more <Icon name="ChevronRight" className="size-4" />
				</span>
			) : null}
		</a>
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

			<main className="flex flex-1 items-center justify-center">
				<div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 text-center">
					<div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-info-border)] bg-[var(--color-info-bg)] px-3 py-1 text-[var(--color-info-text)] text-sm">
						<Icon name="Zap" className="size-4" />
						Version {getLatestVersion()} now available
					</div>

					<h1 className="font-bold text-2xl text-[var(--color-text-active)] leading-snug md:text-3xl xl:text-4xl">
						Type-check the code{" "}
						<span className="bg-gradient-to-r from-[#48ddf3] to-[#fb4bb5] bg-clip-text text-transparent">
							in your Markdown
						</span>
					</h1>

					<p className="max-w-2xl text-[var(--color-text-muted)] text-lg leading-relaxed">
						Kiira runs the TypeScript and JavaScript code fences in your docs through the compiler against your real
						project API, reporting errors on the exact Markdown line — in your editor, on the CLI, and in CI.
					</p>

					<div className="mb-2 grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{CARDS.map((c) => (
							<Card key={c.title} {...c} />
						))}
					</div>

					<div className="mt-6 flex items-center justify-center gap-4">
						<button
							type="button"
							onClick={() => navigate(href("/:version?/home"))}
							className="flex items-center gap-2 rounded-lg bg-[#2c8794] px-6 py-3 font-medium text-white transition-colors hover:bg-[#329baa]"
						>
							<Icon name="Rocket" className="size-5" />
							Get started
						</button>

						<a
							href="https://github.com/AlemTuzlak/kiira"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 rounded-lg bg-[var(--color-background-active)] px-6 py-3 font-medium text-[var(--color-text-active)] transition-colors hover:bg-[var(--color-border)]"
						>
							<Icon name="Github" className="size-5" />
							View on GitHub
						</a>
					</div>

					<p className="mt-8 text-[var(--color-text-muted)] text-sm">
						Kiira ·{" "}
						<a
							href="https://github.com/AlemTuzlak/kiira"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-[var(--color-text)]"
						>
							github.com/AlemTuzlak/kiira
						</a>
					</p>
				</div>
			</main>
		</div>
	)
}
