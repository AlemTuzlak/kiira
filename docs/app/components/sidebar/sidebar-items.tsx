import { NavLink } from "react-router"
import { AccordionItem } from "~/ui/accordion"
import { buildSectionedTo } from "~/utils/path-builders"
import { useCurrentVersion } from "~/utils/version-resolvers"
import type { SidebarSection } from "./sidebar"

const getIndentClass = (depth: number) => {
	const indentMap = { 0: "ml-4", 1: "ml-7", 2: "ml-10" }
	return indentMap[depth as keyof typeof indentMap] || "ml-10"
}

type DocumentationNavLinkProps = {
	title: string
	to: string
	depth?: number
	onClick?: () => void
	className?: string
}

export function DocumentationNavLink({ title, to, depth = 0, onClick, className }: DocumentationNavLinkProps) {
	const indentClass = getIndentClass(depth)
	return (
		<NavLink
			prefetch="intent"
			to={to}
			onClick={onClick}
			className={({ isActive, isPending }) =>
				`block rounded-md px-3 py-0.5 text-sm md:text-base ${indentClass} ${className}
         ${isPending ? "text-[var(--color-text-hover)]" : ""}
         ${
						isActive
							? "bg-[var(--color-background-active)] font-medium text-[var(--color-text-active)]"
							: "text-[var(--color-text-normal)] hover:text-[var(--color-text-hover)]"
					}`
			}
		>
			{title}
		</NavLink>
	)
}

interface SectionItemProps {
	item: SidebarSection
	depth?: number
	onItemClick?: () => void
	className?: string
}

const SectionTitle = ({ title }: { title: string }) => {
	return (
		<h3 className="my-2 ml-4 px-3 font-semibold text-[var(--color-text-active)] text-sm uppercase tracking-wide md:text-base">
			{title}
		</h3>
	)
}

export const SectionItem = ({ item, depth = 0, onItemClick, className = "my-1" }: SectionItemProps) => {
	const isTopLevel = depth === 0
	const version = useCurrentVersion()
	const content = (
		<div>
			{item.documentationPages.length > 0 && (
				<div className="flex flex-col">
					{item.documentationPages.map((doc) => (
						<DocumentationNavLink
							key={doc.slug}
							title={doc.title}
							depth={depth}
							onClick={onItemClick}
							to={buildSectionedTo(version, doc.slug)}
							className={className}
						/>
					))}
				</div>
			)}

			{item.subsections.length > 0 && (
				<div>
					{item.subsections.map((subsection) => (
						<SectionItem
							key={subsection.slug}
							item={subsection}
							depth={depth + 1}
							onItemClick={onItemClick}
							className={className}
						/>
					))}
				</div>
			)}
		</div>
	)

	if (isTopLevel) {
		return (
			<AccordionItem
				title={item.title}
				titleElement="h5"
				titleClassName="font-semibold tracking-wide text-[var(--color-text-active)]"
				content={content}
				defaultOpen={true}
			/>
		)
	}

	return (
		<div className="my-2 flex flex-col">
			<SectionTitle title={item.title} />
			{content}
		</div>
	)
}
