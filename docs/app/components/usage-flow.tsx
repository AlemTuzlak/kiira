import { Icon } from "~/ui/icon/icon"
import { VSCodeIcon } from "~/ui/vscode-icon"

/**
 * "How you use Kiira" — kiira-core feeds the Kiira engine, which fans out into the
 * CLI, the VS Code extension, and the GitHub Action. Plain React/CSS, committable.
 */

const TEAL = "#2c8794"
const LOGO = "/static/images/kiira-logo.png"

function Node({ children, label, sub }: { children: React.ReactNode; label: string; sub?: string }) {
	return (
		<div className="flex w-48 items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-active)]/80 px-4 py-3 text-left backdrop-blur">
			<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#2c8794] to-[#7bac42] text-white">
				{children}
			</span>
			<div className="min-w-0">
				<p className="font-medium text-[var(--color-text-active)] text-sm leading-tight">{label}</p>
				{sub ? <p className="text-[var(--color-text-muted)] text-xs">{sub}</p> : null}
			</div>
		</div>
	)
}

function Connector() {
	return (
		<div className="flex items-center justify-center text-[var(--color-text-muted)]">
			<div className="hidden h-px w-6 md:block" style={{ background: `linear-gradient(to right, transparent, ${TEAL})` }} />
			<Icon name="ChevronRight" className="size-5 rotate-90 md:rotate-0" />
			<div className="hidden h-px w-6 md:block" style={{ background: `linear-gradient(to right, ${TEAL}, transparent)` }} />
		</div>
	)
}

export function UsageFlow() {
	return (
		<div className="flex flex-col items-center justify-center gap-3 md:flex-row md:gap-4">
			<Node label="kiira-core" sub="the check engine">
				<Icon name="Zap" className="size-5" />
			</Node>

			<Connector />

			{/* Kiira engine — the logo on its matching dark card */}
			<div
				className="kiira-anim size-20 shrink-0 overflow-hidden rounded-2xl border-2"
				style={{ backgroundColor: "#0d0e12", borderColor: TEAL, animation: "kiira-core-pulse 6s ease-in-out infinite" }}
			>
				<img src={LOGO} alt="Kiira" className="size-full object-cover" />
			</div>

			<Connector />

			{/* fans out into the three surfaces */}
			<div className="flex flex-col gap-3">
				<Node label="CLI" sub="kiira check">
					<Icon name="Code" className="size-5" />
				</Node>
				<Node label="VS Code" sub="live diagnostics">
					<VSCodeIcon className="size-5" />
				</Node>
				<Node label="GitHub Action" sub="PR annotations">
					<Icon name="Github" className="size-5" />
				</Node>
			</div>
		</div>
	)
}

export default UsageFlow
