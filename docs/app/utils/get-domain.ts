import { createDomain } from "~/utils/http"

export function getDomain(request: Request) {
	// Use the proxy-aware resolver so the origin is correct (https in prod) behind
	// Fly/Cloudflare — otherwise `request.url` reports http and OG/canonical URLs
	// come out as http://, which scrapers reject on HTTPS-only domains like .dev.
	const domain = createDomain(request)
	return { domain }
}
