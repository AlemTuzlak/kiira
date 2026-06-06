import { useEffect, useState } from "react"
import { Link } from "react-router"
import BlinkingSquares from "~/components/blinking-squares"
import { CheckFlow } from "~/components/check-flow"
import FallingRays from "~/components/falling-rays"
import RisingLines from "~/components/rising-lines"
import SilkWaves from "~/components/silk-waves"
import { UsageFlow } from "~/components/usage-flow"
import { Icon } from "~/ui/icon/icon"
import { VSCodeIcon } from "~/ui/vscode-icon"
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
const DOCS_START = `${DOCS_BASE}/getting-started`
const GITHUB_URL = "https://github.com/AlemTuzlak/kiira"
const NPM_URL = "https://www.npmjs.com/package/kiira"
const MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=CodeForge.kiira-vscode"
const LOGO = "/static/images/kiira-logo.png"

// Brand palette — teal/cyan base + the logo's red (errors caught) and green (passing).
const TEAL = "#2c8794"
const RED = "#e8272b"
const GREEN = "#7bac42"

/** WebGL/canvas components touch the DOM — only render them after mount. */
function ClientOnly({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	if (!mounted) return null
	return <>{children}</>
}

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
		href: DOCS_START,
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

// The failure modes Kiira catches — a clean, legible list.
const FAILURES = [
	"invalid imports",
	"missing exports",
	"wrong package subpaths",
	"wrong prop / option names",
	"hallucinated APIs",
	"non-copy-pasteable examples",
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
		body: "Drop AlemTuzlak/kiira@v1 into a workflow to annotate failing docs on the exact line of every pull request.",
		cta: "Read the guide",
		href: `${DOCS_BASE}/ci/github-action`,
		internal: true,
	},
]

function Card({ icon, title, body, href }: CardDef) {
	return (
		<Link
			to={href}
			className="group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-7 text-left backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-[#7bac42] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#2c8794]"
		>
			<div className="mb-5 inline-flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#2c8794] to-[#7bac42] shadow-[0_0_28px_-6px_#2c8794]">
				<Icon name={icon} className="size-6 text-white" />
			</div>
			<h3 className="mb-2.5 font-semibold text-[var(--color-text-active)] text-lg">{title}</h3>
			<p className="text-[var(--color-text-muted)] text-sm leading-relaxed">{body}</p>
			<span className="mt-4 inline-flex items-center gap-1 font-medium text-[var(--color-text-active)] text-sm">
				Learn more <Icon name="ChevronRight" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
			</span>
		</Link>
	)
}

function TerminalBlock() {
	return (
		<div className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-active)]/90 text-left shadow-2xl backdrop-blur">
			<div className="flex items-center gap-2 border-[var(--color-border)] border-b px-4 py-3">
				<span className="size-3 rounded-full" style={{ backgroundColor: RED }} />
				<span className="size-3 rounded-full" style={{ backgroundColor: GREEN }} />
				<span className="size-3 rounded-full" style={{ backgroundColor: "var(--color-text-muted)" }} />
				<span className="ml-2 text-[var(--color-text-muted)] text-xs">terminal</span>
			</div>
			<pre className="overflow-x-auto px-5 py-5 font-mono text-[var(--color-text-active)] text-sm leading-loose">
				<code>
					<span className="text-[var(--color-text-muted)]">$ </span>pnpm add -D kiira{"\n"}
					<span className="text-[var(--color-text-muted)]">$ </span>pnpm kiira init{"\n"}
					<span className="text-[var(--color-text-muted)]">$ </span>pnpm kiira check{"\n"}
					<span style={{ color: GREEN }}>✓ Kiira found no errors in 12 files.</span>
				</code>
			</pre>
		</div>
	)
}

function SiteHeader() {
	const iconLink =
		"text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-active)]"
	return (
		<header className="sticky top-0 z-50 w-full bg-[var(--color-background)]/80 backdrop-blur">
			<div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
				<Link to="/" aria-label="Kiira home" className="flex items-center">
					<img src={LOGO} alt="Kiira" className="size-9 rounded-lg border border-[var(--color-border)]" />
				</Link>
				<nav className="flex items-center gap-4 sm:gap-5">
					<Link
						to={DOCS_START}
						className="font-medium text-[var(--color-text-muted)] text-sm transition-colors hover:text-[var(--color-text-active)]"
					>
						Docs
					</Link>
					<a
						href={MARKETPLACE_URL}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Kiira on the VS Code Marketplace"
						className={iconLink}
					>
						<VSCodeIcon className="size-5" />
					</a>
					<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className={iconLink}>
						<Icon name="Github" className="size-5" />
					</a>
				</nav>
			</div>
		</header>
	)
}

export default function Index() {
	return (
		<div className="flex min-h-screen flex-col bg-[var(--color-background)]">
			<SiteHeader />

			<main className="flex flex-1 flex-col items-center">
				{/* Hero with slow silk-waves background */}
				<section className="relative w-full overflow-hidden">
					<ClientOnly>
						<div className="pointer-events-none absolute inset-0 z-0 opacity-25">
							<SilkWaves colors={[GREEN, RED, GREEN]} speed={0.4} scale={2.4} opacity={1} className="size-full" />
						</div>
					</ClientOnly>
					<div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-[var(--color-background)]/60 via-[var(--color-background)]/50 to-[var(--color-background)]" />

					<div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center gap-9 px-6 py-28 text-center md:py-40">
						<div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-background)]/70 px-4 py-1.5 text-[var(--color-text-muted)] text-sm backdrop-blur">
							<Icon name="ShieldCheck" className="size-4" style={{ color: GREEN }} />
							Verified against your real project types
						</div>

						<h1 className="max-w-4xl font-bold text-4xl text-[var(--color-text-active)] leading-[1.1] md:text-6xl xl:text-7xl">
							Type-check the code{" "}
							<span className="bg-gradient-to-r from-[#e8272b] to-[#7bac42] bg-clip-text text-transparent">
								in your Markdown
							</span>
						</h1>

						<p className="max-w-2xl text-[var(--color-text-muted)] text-lg leading-relaxed md:text-xl">
							Kiira runs the TypeScript and JavaScript code fences in your docs through the compiler against your real
							project API, reporting errors on the exact Markdown line — in your editor, on the CLI, and in CI.
						</p>

						<TerminalBlock />

						<div className="mt-2 flex flex-wrap items-center justify-center gap-4">
							<Link
								to={DOCS_START}
								className="flex items-center gap-2 rounded-lg bg-[#7bac42] px-7 py-3.5 font-medium text-white shadow-[0_0_34px_-8px_#7bac42] transition-colors duration-300 hover:bg-[#6f9f3b]"
							>
								<Icon name="Rocket" className="size-5" />
								Get started
							</Link>
							<a
								href={GITHUB_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2 rounded-lg bg-[var(--color-background-active)] px-7 py-3.5 font-medium text-[var(--color-text-active)] transition-colors duration-300 hover:bg-[var(--color-border)]"
							>
								<Icon name="Github" className="size-5" />
								View on GitHub
							</a>
						</div>
					</div>
				</section>

				{/* See it work — wrong code -> Kiira -> highlighted errors */}
				<section className="w-full border-[var(--color-border)] border-t">
					<div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-14 px-6 py-28 text-center">
						<div className="max-w-2xl">
							<h2 className="font-semibold text-3xl text-[var(--color-text-active)] leading-tight md:text-4xl">
								Watch Kiira catch a bug
							</h2>
							<p className="mt-5 text-[var(--color-text-muted)] text-lg leading-relaxed">
								A broken snippet goes in, runs through the real TypeScript compiler, and comes back with the errors
								flagged on the exact line — the same check you get in your editor, on the CLI, and in CI.
							</p>
						</div>
						<CheckFlow />
					</div>
				</section>

				{/* What breaks a copy-pasted example — a clean list */}
				<section className="w-full border-[var(--color-border)] border-t">
					<div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-28 md:grid-cols-2">
						<div className="text-left">
							<h2 className="font-semibold text-3xl text-[var(--color-text-active)] leading-tight md:text-4xl">
								Everything that breaks a copy-pasted example
							</h2>
							<p className="mt-5 max-w-md text-[var(--color-text-muted)] text-lg leading-relaxed">
								Docs rot quietly — and agents hallucinate APIs with total confidence. Kiira fails the check the moment
								an example stops matching your real types.
							</p>
						</div>
						<div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
							{FAILURES.map((f) => (
								<div
									key={f}
									className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-active)]/60 px-4 py-3.5"
								>
									<span
										className="flex size-6 shrink-0 items-center justify-center rounded-full"
										style={{ backgroundColor: "rgba(232,39,43,0.14)" }}
									>
										<Icon name="X" className="size-3.5" style={{ color: RED }} />
									</span>
									<span className="text-[var(--color-text-active)] text-sm">{f}</span>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* One engine, every surface — center-flow diagram */}
				<section className="relative w-full overflow-hidden border-[var(--color-border)] border-t bg-[var(--color-background-active)]/30">
					<div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-6 py-28 text-center">
						<div className="max-w-2xl">
							<h2 className="font-semibold text-3xl text-[var(--color-text-active)] leading-tight md:text-4xl">
								One engine, every surface
							</h2>
							<p className="mt-5 text-[var(--color-text-muted)] text-lg leading-relaxed">
								The same check powers your editor, the command line, and CI — so "it passes locally" means "it passes
								in the PR."
							</p>
						</div>
						<UsageFlow />
					</div>
				</section>

				{/* Feature cards over a faint blinking-squares field */}
				<section className="relative w-full overflow-hidden border-[var(--color-border)] border-t">
					<ClientOnly>
						<div className="pointer-events-none absolute inset-0 z-0 opacity-[0.12]">
							<BlinkingSquares
								squareColor={TEAL}
								backgroundColor="transparent"
								gridSize={16}
								twinkleSpeed={0.5}
								twinkleStrength={0.6}
								className="size-full"
							/>
						</div>
					</ClientOnly>
					<div className="pointer-events-none absolute inset-0 z-0 bg-[var(--color-background)]/40" />
					<div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-14 px-6 py-32 text-center">
						<h2 className="font-semibold text-3xl text-[var(--color-text-active)] leading-tight md:text-4xl">
							Everything Kiira gives you
						</h2>
						<div className="grid w-full gap-7 sm:grid-cols-2 lg:grid-cols-3">
							{CARDS.map((c) => (
								<Card key={c.title} {...c} />
							))}
						</div>
					</div>
				</section>

				{/* CTA band with slow falling-rays (teal -> green) */}
				<section className="relative w-full overflow-hidden border-[var(--color-border)] border-t">
					<ClientOnly>
						<div className="pointer-events-none absolute inset-0 z-0 opacity-20">
							<FallingRays
								color1={TEAL}
								color2={GREEN}
								pulseSpeed={0.2}
								trailLength={0.7}
								motionBlur={0.5}
								className="size-full"
							/>
						</div>
					</ClientOnly>
					<div className="pointer-events-none absolute inset-0 z-0 bg-[var(--color-background)]/70" />
					<div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-6 py-32 text-center">
						<h2 className="font-semibold text-3xl text-[var(--color-text-active)] leading-tight md:text-4xl">
							Three ways to run Kiira
						</h2>
						<div className="grid w-full gap-7 sm:grid-cols-3">
							{SURFACES.map((s) => {
								const cls =
									"group flex flex-col items-center gap-3.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-7 backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-[#7bac42] hover:shadow-xl"
								const inner = (
									<>
										<div className="inline-flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#2c8794] to-[#7bac42]">
											<Icon name={s.icon} className="size-6 text-white" />
										</div>
										<h3 className="font-semibold text-[var(--color-text-active)] text-lg">{s.title}</h3>
										<p className="text-[var(--color-text-muted)] text-sm leading-relaxed">{s.body}</p>
										<span className="mt-1 inline-flex items-center gap-1 font-medium text-[var(--color-text-active)] text-sm">
											{s.cta} <Icon name="ChevronRight" className="size-4" />
										</span>
									</>
								)
								return s.internal ? (
									<Link key={s.title} to={s.href} className={cls}>
										{inner}
									</Link>
								) : (
									<a key={s.title} href={s.href} target="_blank" rel="noopener noreferrer" className={cls}>
										{inner}
									</a>
								)
							})}
						</div>
						<Link
							to={DOCS_START}
							className="mt-4 flex items-center gap-2 rounded-lg bg-[#7bac42] px-7 py-3.5 font-medium text-white shadow-[0_0_34px_-8px_#7bac42] transition-colors duration-300 hover:bg-[#6f9f3b]"
						>
							<Icon name="Rocket" className="size-5" />
							Get started in 60 seconds
						</Link>
					</div>
				</section>

				{/* Footer band with slow rising-lines */}
				<section className="relative w-full overflow-hidden border-[var(--color-border)] border-t">
					<ClientOnly>
						<div className="pointer-events-none absolute inset-0 z-0 opacity-20">
							<RisingLines color={TEAL} riseSpeed={0.06} flowSpeed={0.12} className="size-full" />
						</div>
					</ClientOnly>
					<div className="pointer-events-none absolute inset-0 z-0 bg-[var(--color-background)]/70" />
					<footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-6 py-20 text-center text-[var(--color-text-muted)] text-sm">
						<img src={LOGO} alt="Kiira" className="size-10 rounded-lg border border-[var(--color-border)]" />
						<p className="mt-1 font-semibold text-[var(--color-text-active)] text-xl">Kiira</p>
						<p>Type-check the code in your Markdown.</p>
						<p className="mt-3">
							<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--color-text)]">
								github.com/AlemTuzlak/kiira
							</a>{" "}
							· MIT
						</p>
					</footer>
				</section>
			</main>
		</div>
	)
}
