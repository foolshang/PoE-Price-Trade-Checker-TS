// The Checker against the REAL hub and GGG (no fake internet): league list, skill data (F4), stats + items (F5 popup).
//   node tests/checker/live.mjs [path to the installed exe]
// A throw-away LOCALAPPDATA; takes the keyboard focus for a moment (a text box comes to the front, F4 / F5 are pressed).
import path from "node:path";
import { CHECKER_DIR, launch, sandbox, ROOT } from "../desktop/harness.mjs";
import { openTextBox, pressKey } from "./win.mjs";

const exe = process.argv[2] || process.env.PFG_CHECKER_EXE;
const sbx = sandbox();
const { app, page } = await launch(sbx, { exe, appDir: CHECKER_DIR });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const out = { exe: exe || "dev build" };
await page.waitForFunction(() => /พบ \d+ leagues|ดึง league ไม่ได้/.test(document.querySelector("#log").innerText), null, { timeout: 60000 });
out.leagues = await page.locator("#league option").allInnerTexts();
out.picked = await page.locator("#league").inputValue();
const windowWith = async (part) => {
  for (let i = 0; i < 200; i++) { const w = app.windows().find((x) => x.url().includes(part)); if (w) return w; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("no window " + part);
};
// F4
await pressKey("F4");
const sk = await windowWith("skillref.html");
await sk.waitForSelector("#skill-input");
out.skillUnavailable = await sk.locator("#unavailable").count();
await sk.fill("#skill-input", "winter");
await sk.waitForSelector("#suggest li", { timeout: 20000 });
out.suggestions = await sk.locator("#suggest li").allInnerTexts();
await sk.keyboard.press("Enter");
await sk.waitForSelector("#brackets button", { timeout: 30000 });
out.brackets = await sk.locator("#brackets button").allInnerTexts();
out.population = await sk.locator("#population").innerText();
out.slotTabs = await sk.locator("#slot-tabs button").allInnerTexts();
out.modRows = await sk.locator("#mods .s-mod").count();
out.passiveRows = await sk.locator("#passives .s-mod").count();
await sk.keyboard.press("Escape").catch(() => {});
// F5 on a rare (real GGG stats + items)
const box = await openTextBox(path.join(ROOT, "tests", "parity", "fixtures", "items", "poe2_rare_gloves.txt"), "PFG-LIVE-BOX");
await pressKey("F5");
const pk = await windowWith("picker.html");
await pk.waitForSelector(".p-row", { timeout: 60000 });
out.pickerRows = await pk.locator(".p-row").count();
out.pickerSearchable = await pk.locator(".p-row input[type=checkbox]:not([disabled])").count();
out.pickerChecked = await pk.locator(".p-row input[type=checkbox]:checked").count();
out.summary = await pk.locator(".p-summary").textContent();
await pk.keyboard.press("Escape").catch(() => {});
await box.close();
out.log = (await page.locator("#log").innerText()).split("\n");
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await app.close();
