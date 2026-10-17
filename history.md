# PoE Price & Trade Checker (TypeScript) - History

> Entry format: date - summary - files touched - status / open problems.
> Newest entry on top.

---

## 2026-10-17 - phase 0: skeleton, survey of the Python original, plan (nothing converted)

- Created `D:\Projects\PoE_Price-Trade_Checker_TS` and the public repo `foolshang/PoE-Price-Trade-Checker-TS`
  ("PoE Price & Trade Checker (TypeScript)"). Skeleton only: `CLAUDE.md`, `docs/PLAN.md`, `docs/CONVERSION.md`,
  `README.md`, root `package.json` (workspaces), `.gitignore`, `.gitattributes`, empty `packages/core`,
  `apps/{checker,filtergen,web}`. No dependencies installed, no tag.
- Read (read only) the original at v0.13.5 (master c9c5752): CLAUDE.md, history.md, every file of `poe_price_trade/`,
  `web/`, `tools/`, `tests/`, the release / deploy workflows, and the standing rules kept in Winai's memory notes.
  The original folder and repo were not touched.
- Findings worth keeping: embedded-config zlib bytes only match Python with pako 2.1.0 (`node:zlib` and fflate differ,
  measured); web origin data (localStorage key `poeFilterGen.cfg`, IndexedDB `poe-filter-gen` v2) must stay compatible;
  the original drops unknown `config.json` keys on save, so two apps should not share one file.
- Status: waiting for Winai's decisions (docs/PLAN.md section F). Next: phase 1 after approval.
