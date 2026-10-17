# Deploying the web page, and going back

The public site is the `gh-pages` branch of `foolshang/PoE-Filter-Generator`
(https://foolshang.github.io/PoE-Filter-Generator/). Both workflows need the secret `RELEASE_TOKEN` of this repo
(`gh secret list --repo foolshang/PoE-Price-Trade-Checker-TS` shows its name only). Never print it.

## Layout of gh-pages

| Path | What |
|---|---|
| `/` | the TypeScript page (`index.html`, `assets/`, `data/`, `.nojekyll`) |
| `/legacy/` | the old Pyodide page (v0.13.5), moved here once by the first deploy; never overwritten afterwards |
| anything else | not web files of either page: never touched |

Same origin for both, so settings, remembered folders and sounds are shared.

## Deploy (Actions -> "Deploy web to GitHub Pages" -> Run workflow)

- `dry_run` = true (default): builds, prepares the commit, prints the top-level listing, the files removed and added; pushes nothing.
- `dry_run` = false: the same, then pushes (a normal commit on top of gh-pages) and waits until the live page serves `web-<version>`.
- Steps: refresh the trade names (a list that shrank by more than 20% keeps the committed snapshot, with a warning) ->
  build -> check that the bundle contains `web-<package.json version>` -> prepare gh-pages (first time: old page to
  `/legacy/`, refuses if the root is not the old page) -> replace the root web files -> push -> verify.
- Only built files go up. If a step fails, stop and report; do not edit gh-pages by hand.

## Going back (one command)

`gh workflow run rollback-web.yml --repo foolshang/PoE-Price-Trade-Checker-TS -f confirm=ROLLBACK`

It puts the contents of `/legacy/` back at the root (`/legacy/` stays) and waits for the old page to be served. To go
forward again, run the deploy workflow; it recognises the old root files and replaces them.

## Clash with the original repo (report, nothing changed there)

`PoE_Price-Trade_Checker/.github/workflows/deploy-web.yml` (called by `release.yml` on every `v*` tag without `-`) builds
the old page and **force-pushes a single commit to gh-pages** (`git init` + `git push --force`). A new release of the
original therefore replaces the whole branch: the new page at the root and `/legacy/` would be gone. Until that is
changed, **do not tag the original**. Proposed change is in the phase report (waiting for Winai's approval).
