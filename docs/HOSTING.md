# TierBrain hosting recommendation

Reviewed on 20 October 2026. This work has not deployed to Cloudflare or changed DNS.

## Recommendation

Use **Cloudflare Workers Static Assets**, keeping GitHub and Supabase. Existing HTML/JavaScript runs without a framework rewrite or Worker script. Cloudflare recommends Workers for new projects; Pages continues to work. [Cloudflare guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#use-workers-static-assets-for-new-projects)

Moving hosting does **not** fix Supabase permissions, scoring, retention or excessive browser-to-Supabase requests. Those require separate repairs. Cloudflare controls on the website do not protect a directly accessible Supabase endpoint.

GitHub Pages is a poor fit for the planned paid service: its documented limits prohibit using it to run an online business, ecommerce site or commercial SaaS. Donation links have a separate permitted exception. This motivates moving before launching paid hosting; it is not a finding that the present free site violates the policy. [GitHub limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Pages terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages)

| | Workers Static Assets | Pages |
|---|---|---|
| Existing static games | Supported without server code | Supported |
| Current static-request pricing | Free and unlimited; asset storage has no additional charge | Free and unlimited |
| Free asset limits | 20,000 files; 25 MiB each | 20,000 files; 25 MiB each |
| Free builds | 3,000 build minutes/month | 500 builds/month |
| URL compatibility | Can preserve `.html` paths explicitly | Automatically redirects `.html` to extensionless paths |

Sources: [Workers billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Pages routing](https://developers.cloudflare.com/pages/configuration/serving-pages/). Terms may change; other services have separate quotas/costs.

## Prepare locally now

- Generate an allowlisted `dist/` containing only public pages/assets, `404.html`, sitemap files, `robots.txt` and host rules. Exclude scripts, tests, docs, Git metadata, configuration and GitHub's `CNAME` file. Never publish the whole repository directory.
- Point `assets.directory` at `dist`; use `not_found_handling: "404-page"` and test `html_handling: "none"` to retain `.html` canonical URLs. Explicitly test `/`, `/index.html`, nested pages, query strings and missing URLs; disabling HTML handling also disables normal extensionless/directory-index mapping, so add exact rewrites where required. Do not enable SPA fallback. [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)
- Put security headers in `_headers`; test browser dependencies before imposing a strict CSP. Use `_redirects` only for deliberate rewrites/redirects. These files apply to static responses; future server-generated responses need their own rules. [Headers](https://developers.cloudflare.com/workers/static-assets/headers/), [redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)

## Migration checklist — after local review and authorisation

1. Connect only the intended GitHub repository. Match project name `tierbrain` to Wrangler, use repository root, and set an explicit build command: Workers Builds ignores Wrangler's custom build setting. For initial review use `python3 build-site.py --preview` and deploy command `npx wrangler deploy`. No build environment variable is required. Final **Deploy** starts hosting; leave custom domains unconfigured. [Build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
2. Test games, joining/reconnecting, redirects, headers, search metadata and real 404 responses. Review Auth redirect URLs and any application/Edge Function CORS origin checks **if used**; retaining `https://tierbrain.co` normally preserves its existing origin. Do not broadly allow every preview domain. [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls)
3. Export DNS records and record current hosting/settings. Review all imported records, preserving MX, SPF, DKIM, DMARC, verification records and other subdomains. For an active Cloudflare zone, follow the nameserver and DNSSEC sequence; domain registration need not move. [DNS migration](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
4. Add `tierbrain.co` through Workers **Custom Domains** after resolving conflicting hosting records; configure `www` deliberately. Cloudflare creates the domain's DNS record. Verify HTTPS, email and gameplay before retiring the old host. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## Preview and production builds

Run `python3 build-site.py --preview` for display review. Only generated `dist/` changes: CSP blocks backend connections and form submissions, static responses gain `noindex`, and pages show a preview notice. Multiplayer, live scores and forms are unavailable; isolated test Supabase is required to test them. Restrict hosted review with [Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). Cloudflare branch isolation does not isolate hardcoded external services.

For local routing review run these sequentially:

```sh
python3 build-site.py --preview
npx wrangler@4.151.2 dev --local
```

Wrangler has no custom build hook, so it serves the existing `dist/` without resetting preview mode. Earlier local routing/header checks passed without deployment.

For production set the dashboard build command to `python3 build-site.py` before approval to promote. This preserves source pages and normal backend behaviour. If using optional `TIERBRAIN_PREVIEW=1` locally, unset it before a production build. Host permission/scoring repairs still need separate verification.

## Rollback

Retain the previous verified build/version and DNS export. Revert to that [Worker version](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) for a code regression. If necessary, detach the Worker domain and restore the prior web-hosting records; allow DNS caches to expire. A nameserver rollback additionally needs matching DNSSEC/DS settings. Hosting rollback does not reverse database changes; handle those separately with tested migrations/backups.
