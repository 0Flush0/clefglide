# Hosting

`npm run build` writes the static site to `dist/`. Serve it over HTTPS so Chrome can offer Web MIDI when the user selects **Connect MIDI**. Use a top-level page, or allow MIDI through the embedding page’s permissions policy. The app requires no runtime backend, accounts or API keys.

Production is served at [piano.rit.cl](https://piano.rit.cl/). The [GitHub Actions workflow](../.github/workflows/deploy.yml) publishes `ghcr.io/0flush0/sightflow` and updates the existing Docker Compose project over SSH. The [Dockerfile](../Dockerfile) builds the app and copies `dist/` into Nginx. The image name and `SIGHTFLOW_IMAGE` retain the original SightFlow name for compatibility.

## Production deployment setup

The preparation workflow uses the existing repository SSH secrets. With `DEPLOY_PATH` unset, it resolves `hosting/apps/sightflow` under the remote SSH user's home. Before pushing the preparation workflow to `main`, confirm that this resolves to the existing Compose directory. If the directory differs or you are unsure, add `DEPLOY_PATH` with the current absolute path under **Settings → Secrets and variables → Actions → Repository secrets → New repository secret**. A push to `main` runs checks and, on success, publishes and deploys automatically.

Complete these steps before pushing the environment activation.

1. Open **Settings → Environments → New environment**, enter `production`, and click **Configure environment**. GitHub Free supports this on public repositories. A private personal repository requires GitHub Pro for environment secrets and branch rules.
2. In `production`, under **Deployment branches and tags**, select **Selected branches and tags**. Click **Add deployment branch or tag rule**, choose **Branch**, enter `main`, and click **Add rule**. Leave required reviewers unset to keep deployment automatic.
3. In the same environment, under **Environment secrets → Add secret**, add all five values below from your deployment setup. Use the existing Compose directory for `DEPLOY_PATH`.

   | Secret | Value |
   | --- | --- |
   | `DEPLOY_HOST` | SSH hostname or IP |
   | `DEPLOY_USER` | SSH login username |
   | `DEPLOY_SSH_KEY` | Private SSH key, including its header and footer |
   | `DEPLOY_KNOWN_HOSTS` | Existing verified `known_hosts` entry for the SSH server |
   | `DEPLOY_PATH` | Absolute path to the directory containing the server's Compose file |

4. Uncomment `environment: production` under `jobs.deploy` in the workflow. The branch rule and environment secrets apply to jobs that reference `production`. The environment values take precedence over repository secrets with the same names. A repository-scoped SSH key remains usable by other eligible jobs while the server authorizes it. If the SSH credential itself must be exclusive to `production`, put a new key in the environment and retire the old key's server authorization after verifying the new key works.

[GitHub's environment setup guide](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

## Search metadata and verification

The title, description, canonical URL, and Open Graph and Twitter metadata are in [index.html](../index.html). The [robots file](../public/robots.txt) allows crawler access to the app and its assets. The [sitemap](../public/sitemap.xml) lists the homepage because Practice, Progress and Settings are views within it. Vite copies both files and the [Google ownership file](../public/google8841eb056d99831e.html) to the site root.

After a deployment, check the following on the live host.

1. View the page source and confirm the title, description and canonical URL. The homepage and bundled assets should return HTTP 200. Inspect the HTML and response headers for an unexpected `noindex` directive, including any `X-Robots-Tag` from a proxy.
2. Open `/robots.txt`, `/sitemap.xml` and `/google8841eb056d99831e.html` on the production origin. Each should return its own file with HTTP 200. Verify that JavaScript, CSS and fonts are crawlable.
3. For the URL-prefix property in [Google Search Console](https://search.google.com/search-console/), keep the existing ownership file at its original URL while file verification is in use. The owner can also verify a property using a Google-provided HTML tag or DNS record. See [Google’s ownership verification guide](https://support.google.com/webmasters/answer/9008080?hl=en).
4. In Search Console, submit the sitemap, then use **URL inspection** to test the live canonical URL, check indexing eligibility and request indexing if needed. See [Google’s URL inspection guide](https://support.google.com/webmasters/answer/9012289?hl=en).
