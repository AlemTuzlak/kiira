import { generateMeta } from "@forge42/seo-tools/remix/metadata"
import type { MetaDescriptor } from "react-router"

interface MetaFields {
	domain: string
	title: string
	description: string
	path: string
	additionalData?: MetaDescriptor[]
}

export function generateMetaFields({ domain, title, description, path, additionalData }: MetaFields) {
	const fullUrl = `${domain}${path}`

	return generateMeta(
		{
			title,
			description,
			url: fullUrl,
			siteName: "Kiira",
			// Absolute URL (OG/Twitter scrapers require it). Served from public/.
			image: `${domain}/static/images/cover-dark.png`,
		},
		[
			// Open Graph
			{ property: "og:type", content: "website" },
			...(additionalData ?? []),
		]
	)
}
