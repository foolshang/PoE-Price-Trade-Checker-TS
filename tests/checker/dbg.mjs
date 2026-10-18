import fs from "node:fs";
import path from "node:path";
import { CHECKER_DIR, launch, sandbox, wait, ROOT } from "../desktop/harness.mjs";
import { fakeInternet, fixtureData } from "../desktop/stubs.mjs";
import { openTextBox, pressKey } from "./win.mjs";
const net = await fakeInternet(fixtureData());
net.state.realItems = true;
for (let i = 0; i < 4; i++) {
  const sbx = sandbox();
  fs.mkdirSync(sbx.checkerDir, { recursive: true });
  fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ game_version: "poe1" }));
  const { app, page } = await launch(sbx, { appDir: CHECKER_DIR, chromiumArgs: net.args });
  await page.waitForFunction(() => /พบ \d+ leagues/.test(document.querySelector("#log").innerText));
  const box = await openTextBox(path.join(ROOT, "tests/parity/fixtures/items/poe1_rare_noheader.txt"), "DBG-BOX");
  await pressKey("F5");
  await page.waitForFunction(() => /เลือก mod/.test(document.querySelector("#log").innerText));
  await wait(300);
  const t0 = Date.now();
  const r = await Promise.race([app.close().then(() => "closed"), wait(20000).then(() => "HANG")]);
  console.log(i, r, Date.now() - t0, "ms");
  if (r === "HANG") console.log(fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8").split("\n").slice(-8).join("\n"));
  await box.close();
}
process.exit(0);
