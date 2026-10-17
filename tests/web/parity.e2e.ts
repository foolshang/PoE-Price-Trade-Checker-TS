// @ts-nocheck
/**
 * The built page, run in a real browser, against the original and against the core:
 *  A) the golden of the ORIGINAL (tests/parity/golden): NeverSink tab and Whitelist tab, both games - the file the page
 *     downloads equals the original's file byte for byte (line ends are CRLF in the download, LF in the golden; the settings
 *     line block differs only in the recorded app name, so it is compared decoded, without `app`).
 *  B) the core (which is proven equal to the original): 12 random whitelist settings per game through the whole page (settings
 *     in localStorage -> generate -> download) give exactly the core's file for the same settings, app name included.
 * Run: npm run test:e2e (needs apps/web/dist: npm run web:build)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { WlModel, filterCore, wlEmbed } from "../../packages/core/src/index.ts";
import { fixture } from "../parity/runner.ts";
import { FIXTURES, launchBrowser, routeNetwork, startServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const GOLDEN = path.join(ROOT, "tests", "parity", "golden");
const APP = "web-" + JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
const golden = (g) => JSON.parse(fs.readFileSync(path.join(GOLDEN, g + ".json"), "utf-8"));
const cases = (g) => JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "parity", "cases", g + ".json"), "utf-8"));
const goldenText = (name) => zlib.gunzipSync(fs.readFileSync(path.join(GOLDEN, "texts", name + ".txt.gz"))).toString("utf-8");
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf-8")).digest("hex");
const MARK = wlEmbed.MARK;
const lf = (t) => t.replace(/\r\n/g, "\n");
const stripBlob = (t) => lf(t).split("\n").filter((l) => !l.startsWith(MARK)).join("\n");
const names = (g) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, `trade_names_${g}.json.gz`))).toString("utf-8"));

let browser, srv, url;
beforeAll(async () => {
  browser = await launchBrowser();
  ({ srv, url } = await startServer());
}, 60000);
afterAll(async () => { await browser?.close(); srv?.close(); });

/** open the page with these saved settings and game, optionally on a tab; returns the file a click on Generate downloads */
async function run(game, cfg, mode) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await routeNetwork(ctx, []);
  // the real-names list of the original's tests (instead of the snapshot the page ships)
  await ctx.route(/\/data\/trade_names_poe[12]\.json$/, (route) => {
    const g = /poe1/.test(route.request().url()) ? "poe1" : "poe2";
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(names(g)) });
  });
  await ctx.addInitScript(([g, c]) => {
    localStorage.setItem("poeFilterGen.game", g);
    localStorage.setItem("poeFilterGen.cfg", JSON.stringify(c));
  }, [game, cfg]);
  const page = await ctx.newPage();
  await page.goto(url + "/");
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText));
  await page.click(mode === "tier" ? "#tab-ns" : "#tab-wl");
  await page.click(mode === "tier" ? "#btn-generate-tier" : "#btn-generate-wl");
  await page.waitForSelector("#btn-download:not([hidden])");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-download")]);
  const text = fs.readFileSync(await dl.path(), "utf-8");
  await ctx.close();
  return text;
}

// the model keeps the rarities of a typed name in the canonical order; the original's golden settings hold the order they were set in
const embedded = (t) => {
  const e = wlEmbed.extract(lf(t));
  delete e.app;
  for (const k of Object.keys(e.cfg)) {
    if (k.startsWith("whitelist_custom_")) e.cfg[k] = e.cfg[k].map((x) => ({ ...x, rarities: [...x.rarities].sort() }));
  }
  return e;
};

describe("A) the golden of the original", () => {
  const tierGolden = golden("tier");
  const tierCases = cases("tier").filter((c) => /-s2-none-(noq|q_color|q_game_sound|q_empty|q_file_sound)$/.test(c.id));
  it.each(tierCases.map((c) => [c.id, c]))("NeverSink tab %s", async (_id, c) => {
    const text = await run(c.args.game, c.args.cfg, "tier");
    expect(text.includes("\r\r\n")).toBe(false);
    expect(sha(lf(text))).toBe(tierGolden[c.id].result.file.$text);
  }, 60000);

  for (const [group, game] of [["wlrand-poe1", "poe1"], ["wlrand-poe2", "poe2"]]) {
    it(`Whitelist tab ${game}: ${group}/001-build equals the original's file (settings block compared decoded)`, async () => {
      const id = `${group}/001-build`;
      const c = cases(group).find((x) => x.id === id);
      const want = goldenText(`${group}__001-build.file`);
      const text = await run(game, c.args.cfg, "whitelist");
      expect(stripBlob(text)).toBe(stripBlob(want));
      expect(embedded(text)).toEqual(embedded(want));
    }, 60000);
  }
});

describe("B) the core, through the whole page", () => {
  for (const [group, game] of [["wlrand-poe1", "poe1"], ["wlrand-poe2", "poe2"]]) {
    const builds = cases(group).filter((c) => c.id.endsWith("-build")).slice(0, 12);
    it.each(builds.map((c) => [c.id, c]))(`Whitelist tab ${game} %s`, async (_id, c) => {
      const cfg = { ...c.args.cfg };
      const got = await run(game, cfg, "whitelist");
      // the page merges its own tab values (names, strictness) into the saved settings; the core gets what the page sent
      const saved = c.args.cfg;
      const asPage = { ...saved, ...WlModel.fromConfig(structuredClone(saved), game).toConfig({}) }; // the page merges its model's settings
      const res = await filterCore.buildFilterText(asPage, game, {
        hubData: fixture(`fx:hub_${game}`), baseText: fixture(`fx:ns_${game}_s2`), extraNames: fixture(`fx:names_${game}`), appVersion: APP, log: () => {},
        copySoundsFn: (m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v).map(([k, v]) => [k, filterCore.safeSoundName(v.split(/[\\/]/).pop())[0]])),
      });
      const want = filterCore.composeFilterBody(res.generated_section, res.base_text);
      expect(lf(got)).toBe(want);
      expect(got.includes("\r\r\n")).toBe(false);
    }, 60000);
  }
});
