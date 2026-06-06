import type { ComponentPropsWithoutRef } from "react"
import { cn } from "~/utils/css"

/**
 * Styled table primitives wired into the MDX renderer so Markdown tables
 * (e.g. the CLI flags and GitHub Action inputs tables) render as a polished,
 * horizontally-scrollable card instead of a bare HTML table.
 */
export const Table = ({ className, ...props }: ComponentPropsWithoutRef<"table">) => (
	<div className="my-6 w-full overflow-x-auto rounded-xl border border-[var(--color-border)]">
		<table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />
	</div>
)

export const TableHead = (props: ComponentPropsWithoutRef<"thead">) => (
	<thead
		className="border-[var(--color-border)] border-b bg-[var(--color-background-active)] text-[var(--color-text-active)]"
		{...props}
	/>
)

export const TableHeaderCell = ({ className, ...props }: ComponentPropsWithoutRef<"th">) => (
	<th className={cn("whitespace-nowrap px-4 py-2.5 font-semibold", className)} {...props} />
)

export const TableCell = ({ className, ...props }: ComponentPropsWithoutRef<"td">) => (
	<td
		className={cn(
			"border-[var(--color-border)] border-t px-4 py-2.5 align-top text-[var(--color-text-muted)]",
			className
		)}
		{...props}
	/>
)
