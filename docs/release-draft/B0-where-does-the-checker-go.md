# B0 - where does the new Checker go? (Winai decides)

The original publishes only the Filter Generator in public (its release.yml uploads `PoE-Filter-Generator.exe` to
foolshang/PoE-Filter-Generator); the Checker was never released. The TypeScript Checker needs a home before the cut-over, because its
self-update reads from there.

| | Option 1 - one release, both programs (the draft) | Option 2 - the Checker in its own public repo | Option 3 - the Checker is not published |
|---|---|---|---|
| Release page | one release: 2 Setup + 2 zip + `latest.yml` + `checker.yml` | `foolshang/PoE-Price-Trade-Checker` (a new repo: token, README) | only given to people by hand |
| Auto-update | the Filter Generator reads `latest.yml`, the Checker reads `checker.yml` (electron-updater channel) of the Latest release: both work | the Checker's `publish` points at its repo | none |
| Work | one workflow (drafted), nothing else | a second repo, a second workflow, a second README | none |
| Risk | a release carries 8 files; users of the Filter Generator see the Checker's files next to it | two places to keep in step | users cannot update the Checker |

Recommendation: option 1. The programs share one version number and one build (the Checker's filter page IS the Filter Generator's
page), so one release keeps them in step. If option 2 or 3 is chosen only `apps/checker/electron-builder.yml` (`publish:`) and the draft
workflow change.

Until this is decided the Checker's `publish` block already says option 1 (channel `checker`), so a build writes `checker.yml`.
A copy installed from the zip never updates itself (it only says that a newer release exists, with this link).
