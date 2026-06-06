import { getTokenColor, isTokenType, tokenize } from "~/components/code-block/code-block-syntax-highlighter"
import { Icon } from "~/ui/icon/icon"

/**
 * Landing-page demo: a real README excerpt (prose + a wrong code fence) on the
 * left flows through Kiira in the middle and comes out on the right with the bad
 * lines highlighted and the type errors flagged. Syntax highlighting reuses the
 * docs' own theme-aware tokenizer (the same one every code block uses), so it
 * matches the site. Pure React/CSS, SSR-safe, loops on a 6s beat.
 */

const RED = "#e8272b"
const TEAL = "#2c8794"
const CYAN = "#48ddf3"

const SNIPPET = [
	'import { useChat } from "@tanstack/ai/react"',
	"",
	"const chat = useChat({ onMessge: reset })",
	'chat.sendMessages("hi")',
]
const ERROR_LINES = new Set([2, 3])
const ERROR_TOKENS = new Set(["onMessge", "sendMessages"])

const SQUIGGLE = "kiira-squiggle 6s ease-in-out infinite"
const REVEAL = "kiira-reveal 6s ease-in-out infinite"

function CodeLine({ line, index, checked }: { line: string; index: number; checked: boolean }) {
	const highlight = checked && ERROR_LINES.has(index)
	const tokens = tokenize(line)
	return (
		<div
			className={highlight ? "kiira-anim" : undefined}
			style={{
				padding: "0 6px",
				margin: "0 -6px",
				borderLeft: highlight ? `2px solid ${RED}` : "2px solid transparent",
				background: highlight ? "rgba(232,39,43,0.13)" : "transparent",
				borderRadius: 3,
				animation: highlight ? SQUIGGLE : undefined,
				minHeight: "1.5em",
			}}
		>
			{tokens.length === 0 ? " " : null}
			{tokens.map((tok, i) => {
				const errTok = checked && ERROR_TOKENS.has(tok.value)
				const color = isTokenType(tok.type) ? getTokenColor(tok.type) : "var(--color-code-block-text)"
				return (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: static token list
						key={i}
						style={{
							color,
							...(errTok
								? { textDecoration: "underline wavy", textDecorationColor: RED, textUnderlineOffset: 3 }
								: {}),
						}}
					>
						{tok.value}
					</span>
				)
			})}
		</div>
	)
}

function Readme({ checked }: { checked: boolean }) {
	return (
		<div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-active)]/90 text-left shadow-xl backdrop-blur">
			<div className="flex items-center gap-2 border-[var(--color-border)] border-b px-4 py-2.5 text-[var(--color-text-muted)] text-xs">
				<Icon name="FileText" className="size-4" />
				README.md
				<span className="ml-auto">
					{checked ? (
						<span
							className="kiira-anim inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[10px]"
							style={{ color: RED, backgroundColor: "rgba(232,39,43,.12)", animation: SQUIGGLE }}
						>
							<Icon name="TriangleAlert" className="size-3" /> 2 errors
						</span>
					) : (
						<span className="text-[10px]">unchecked</span>
					)}
				</span>
			</div>

			<div className="px-4 py-4 text-left">
				<p className="font-semibold text-[var(--color-text-active)] text-sm">Usage</p>
				<p className="mt-1 text-[var(--color-text-muted)] text-sm leading-relaxed">Call the hook and send a message:</p>

				<pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-code-block-bg)] px-3 py-3 text-left font-mono text-[13px] text-[var(--color-code-block-text)] leading-relaxed">
					<code>
						{SNIPPET.map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static line list
							<CodeLine key={i} line={line} index={i} checked={checked} />
						))}
					</code>
				</pre>

				<p className="mt-3 text-[var(--color-text-muted)] text-sm leading-relaxed">It returns the chat instance.</p>

				{checked && (
					<div className="mt-4 space-y-2 border-[var(--color-border)] border-t pt-3">
						<div className="kiira-anim flex items-start gap-2 text-xs" style={{ animation: REVEAL }}>
							<Icon name="TriangleAlert" className="mt-0.5 size-3.5 shrink-0" style={{ color: RED }} />
							<span className="text-[var(--color-text-muted)]">
								<span className="font-medium" style={{ color: RED }}>
									TS2353
								</span>{" "}
								· line 3 — no known property <span className="text-[var(--color-text-active)]">onMessge</span>; did you
								mean <span className="text-[var(--color-text-active)]">onMessage</span>?
							</span>
						</div>
						<div className="kiira-anim flex items-start gap-2 text-xs" style={{ animation: REVEAL }}>
							<Icon name="TriangleAlert" className="mt-0.5 size-3.5 shrink-0" style={{ color: RED }} />
							<span className="text-[var(--color-text-muted)]">
								<span className="font-medium" style={{ color: RED }}>
									TS2551
								</span>{" "}
								· line 4 — <span className="text-[var(--color-text-active)]">sendMessages</span> does not exist; did you
								mean <span className="text-[var(--color-text-active)]">sendMessage</span>?
							</span>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

function Beam({ name }: { name: "kiira-beam-in" | "kiira-beam-out" }) {
	const horizontal = name === "kiira-beam-in" ? "to right" : "to left"
	return (
		<>
			{/* mobile: short vertical connector */}
			<div className="flex h-6 w-full items-center justify-center md:hidden">
				<div className="h-full w-px" style={{ background: `linear-gradient(to bottom, transparent, ${TEAL})` }} />
			</div>
			{/* desktop: horizontal beam, height-matched to the Kiira core so it lines up */}
			<div className="relative hidden shrink-0 items-center md:flex md:h-20 md:w-16">
				<div
					className="h-px w-full"
					style={{ background: `linear-gradient(${horizontal}, transparent, ${TEAL}, ${TEAL})` }}
				/>
				<div
					className="kiira-anim absolute top-1/2 size-2.5 rounded-full"
					style={{
						marginLeft: "-5px",
						transform: "translateY(-50%)",
						background: CYAN,
						boxShadow: `0 0 12px 3px ${CYAN}`,
						animation: `${name} 6s ease-in-out infinite`,
					}}
				/>
			</div>
		</>
	)
}

export function CheckFlow() {
	return (
		<div className="flex w-full flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-0">
			<Readme checked={false} />
			<Beam name="kiira-beam-in" />
			{/* Just the box is in flow (label is absolute) so the beams line up with the box's center. */}
			<div className="relative flex shrink-0 items-center px-2">
				<div
					className="kiira-anim size-20 overflow-hidden rounded-2xl border-2"
					style={{
						backgroundColor: "#0d0e12",
						borderColor: TEAL,
						animation: "kiira-core-pulse 6s ease-in-out infinite",
					}}
				>
					<img src="/static/images/kiira-logo.png" alt="Kiira" className="size-full object-cover" />
				</div>
				<span className="-translate-x-1/2 absolute top-full left-1/2 mt-2 font-semibold text-[var(--color-text-active)] text-sm">
					Kiira
				</span>
			</div>
			<Beam name="kiira-beam-out" />
			<Readme checked={true} />
		</div>
	)
}

export default CheckFlow
