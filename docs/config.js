// Point this at your deployed Worker URL after `wrangler deploy`.
// While running `wrangler dev` locally it defaults to the local dev server.
window.API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
	? "http://127.0.0.1:8787"
	: "https://anipet-subscriptions.YOUR-SUBDOMAIN.workers.dev";
