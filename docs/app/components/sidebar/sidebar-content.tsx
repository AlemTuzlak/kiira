import { useMobileView } from "~/hooks/use-mobile-view"
import { Accordion } from "~/ui/accordion"
import type { SidebarTree } from "~/utils/create-sidebar-tree"
import { buildStandaloneTo } from "~/utils/path-builders"
import { useCurrentVersion } from "~/utils/version-resolvers"
import { DocumentationNavLink, SectionItem } from "./sidebar-items"

export const SidebarContent = ({
	sidebarTree,
	onClose,
}: {
	sidebarTree: SidebarTree
	onClose?: () => void
}) => {
	const { isMobile } = useMobileView()
	const handle = isMobile ? onClose : undefined
	const { sections, documentationPages } = sidebarTree
	const version = useCurrentVersion()
	return (
		<nav
			className="flex max-h-[calc(100vh-var(--header-height))] min-h-0 flex-col overflow-y-auto pr-4"
			aria-label="Documentation navigation"
		>
			{documentationPages.length > 0 && (
				<div className="my-3">
					{documentationPages.map((p) => (
						<DocumentationNavLink
							key={p.slug}
							title={p.title}
							onClick={handle}
							to={buildStandaloneTo(version, p.slug)}
						/>
					))}
				</div>
			)}

			<Accordion className="flex flex-col gap-1">
				{sections.map((item) => (
					<SectionItem key={item.slug} item={item} onItemClick={handle} />
				))}
			</Accordion>
		</nav>
	)
}
