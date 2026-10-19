# TierBrain hosting recommendation

Reviewed against official documentation on 19 October 2026. This document proposes a migration; no account connection, deployment or DNS change has been made.

## Recommendation

Use **Cloudflare Workers Static Assets**, keeping GitHub for source control and Supabase for multiplayer/database. TierBrain's existing HTML/JavaScript can run without a framework rewrite or a Worker script. Cloudflare now recommends Workers for new projects; Pages continues to work, but new development focuses on Workers. [Cloudflare guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#use-workers-static-assets-for-new-projects)

Moving hosting does **not** fix Supabase permissions, scoring, retention or excessive browser-to-Supabase requests. Those require separate repairs. Cloudflare controls on the website do not protect a directly accessible Supabase endpoint.

GitHub Pages is a poor fit for the planned paid service: its documented limits prohibit using it to run an online business, ecommerce site or commercial SaaS. Donation links have a separate permitted exception. This motivates moving before launching paid hosting; it is not a finding that the present free site violates the policy. [GitHub limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Pages terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages)

| | Workers Static Assets | Pages |
|---|---|---|
| Existing static games | Supported without server code | Supported |
| Current static-request pricing | Free and unlimited; asset storage has no additional charge | Free and unlimited |
| Free asset limits | 20,000 files; 25 MiB each | 20,000 files; 25 MiB each |
| Free builds | 3,000 build minutes/month | 500 builds/month |
| URL compatibility | Can preserve `.html` paths explicitly | Automatically redirects `.html` to extensionless paths |

Sources: [Workers billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Pages routing](https://developers.cloudflare.com/pages/configuration/serving-pages/). These are current terms, not price guarantees; server code, builds, Supabase and other services have separate quotas/costs.

## Prepare locally now

- Generate an allowlisted `dist/` containing only public pages/assets, `404.html`, sitemap files, `robots.txt` and host rules. Exclude scripts, tests, docs, Git metadata, configuration and GitHub's `CNAME` file. Never publish the whole repository directory.
- Point `assets.directory` at `dist`; use `not_found_handling: "404-page"` and test `html_handling: "none"` to retain `.html` canonical URLs. Explicitly test `/`, `/index.html`, nested pages, query strings and missing URLs; disabling HTML handling also disables normal extensionless/directory-index mapping, so add exact rewrites where required. Do not enable SPA fallback. [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)
- Put security headers in `_headers`; test browser dependencies before imposing a strict CSP. Use `_redirects` only for deliberate rewrites/redirects. These files apply to static responses; future server-generated responses need their own rules. [Headers](https://developers.cloudflare.com/workers/static-assets/headers/), [redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)

## Migration checklist — after local review and authorisation

1. Connect only the intended GitHub repository. Configure the protected production branch and [preview builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/); restrict previews with [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). Use isolated test data, because preview hosting alone does not isolate Supabase.
2. Test games, joining/reconnecting, redirects, headers, search metadata and real 404 responses. Review Auth redirect URLs and any application/Edge Function CORS origin checks **if used**; retaining `https://tierbrain.co` normally preserves its existing origin. Do not broadly allow every preview domain. [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls)
3. Export DNS records and record current hosting/settings. Review all imported records, preserving MX, SPF, DKIM, DMARC, verification records and other subdomains. For an active Cloudflare zone, follow the nameserver and DNSSEC sequence; domain registration need not move. [DNS migration](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
4. Add `tierbrain.co` through Workers **Custom Domains** after resolving conflicting hosting records; configure `www` deliberately. Cloudflare creates the domain's DNS record. Verify HTTPS, email and gameplay before retiring the old host. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## Local verification completed

Wrangler **4.151.2** ran this branch locally with `wrangler dev --local`, without login or deployment. Twelve HTTP checks passed: homepage and explicit `.html` URLs, extensionless redirects with query strings preserved, nested question/answer URLs, real 404 responses, exclusion of repository docs/config, security headers and join-page noindex headers. The generated homepage rewrite resolves `/` under `html_handling: "none"`.

For a local routing check, run `npx wrangler@4.151.2 dev --local` after installing the required local tooling. This server verifies hosting behaviour; use `python preview-site.py` for a visual preview with external browser connections blocked. A normal Wrangler preview does not itself isolate production Supabase, so do not run live multiplayer through it before configuring staging data.

## Rollback

Retain the previous verified build/version and DNS export. Revert to that [Worker version](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) for a code regression. If necessary, detach the Worker domain and restore the prior web-hosting records; allow DNS caches to expire. A nameserver rollback additionally needs matching DNSSEC/DS settings. Hosting rollback does not reverse database changes; handle those separately with tested migrations/backups.
