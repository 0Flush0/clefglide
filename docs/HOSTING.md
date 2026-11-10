# Hosting

`npm run build` writes the static site to `dist/`. Serve it over HTTPS so Chrome can offer Web MIDI when the user selects **Connect MIDI**. Use a top-level page, or allow MIDI through the embedding page’s permissions policy. The app requires no runtime backend, accounts or API keys.

Production is served at [piano.rit.cl](https://piano.rit.cl/). The [GitHub Actions workflow](../.github/workflows/deploy.yml) publishes the `ghcr.io/0flush0/sightflow` image used by the existing STRATO deployment. The [Dockerfile](../Dockerfile) builds the app and copies `dist/` into Nginx, which serves the site behind Caddy. The image name and other internal deployment identifiers retain the original SightFlow name for compatibility.

## Search metadata and verification

The title, description, canonical URL, and Open Graph and Twitter metadata are in [index.html](../index.html). The [robots file](../public/robots.txt) allows crawler access to the app and its assets. The [sitemap](../public/sitemap.xml) lists the homepage because Practice, Progress and Settings are views within it. Vite copies both files and the [Google ownership file](../public/google8841eb056d99831e.html) to the site root.

After a deployment, check the following on the live host.

1. View the page source and confirm the title, description and canonical URL. The homepage and bundled assets should return HTTP 200. Inspect the HTML and response headers for an unexpected `noindex` directive, including any `X-Robots-Tag` from a proxy.
2. Open `/robots.txt`, `/sitemap.xml` and `/google8841eb056d99831e.html` on the production origin. Each should return its own file with HTTP 200. Verify that JavaScript, CSS and fonts are crawlable.
3. For the URL-prefix property in [Google Search Console](https://search.google.com/search-console/), keep the existing ownership file at its original URL while file verification is in use. The owner can also verify a property using a Google-provided HTML tag or DNS record. See [Google’s ownership verification guide](https://support.google.com/webmasters/answer/9008080?hl=en).
4. In Search Console, submit the sitemap, then use **URL inspection** to test the live canonical URL, check indexing eligibility and request indexing if needed. See [Google’s URL inspection guide](https://support.google.com/webmasters/answer/9012289?hl=en).
