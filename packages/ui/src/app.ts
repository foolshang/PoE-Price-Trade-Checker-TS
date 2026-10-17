/**
 * The page: boot, tabs, game switch, generate / deliver (folder, download, zip), open a filter file, the game folder.
 * Settings use the same keys as the desktop config["filter_gen"], kept in localStorage (the same key as the Pyodide page).
 */
import { APP_VERSION } from "./api.ts";
import { fetchBase, getHub, getNames } from "./data.ts";
import { $, $$, debounce, h, log, logAll, saveBlob } from "./dom.ts";
import { FS, Download, packDownload, sounds, writeToFolder } from "./files.ts";
import { openFilter } from "./open_filter.ts";
import { SHELL_HTML } from "./shell.ts";
import { Ctx, S } from "./state.ts";
import { KEY_GAME, loadCfg, saveCfg, store } from "./storage.ts";
import { tabNs } from "./tab_ns.ts";
import { tabWl } from "./tab_wl.ts";

const DIRS: Record<string, string> = { poe1: "Documents\\My Games\\Path of Exile", poe2: "Documents\\My Games\\Path of Exile 2" };

/** What the page exposes for tests and for the browser console (not used by the page itself). */
export const hooks = { openFilter };

export interface BootOptions {
  /** where the data/ folder (names snapshots) is served, with a trailing slash; default: next to the page */
  dataBase?: string;
  title?: string;
}

let game = "poe2";
let tab = "tier";
let lastText = "";
let lastDownload: Download | null = null;
let loadingLists = false;
let dataBase = "./";

// ---------------------------------------------------------------- settings
function collectCfg(mode?: string): Record<string, any> {
  const cfg = S.cfg;
  tabNs.collect(cfg, game);
  tabWl.collect(cfg);
  Object.assign(cfg, S.api.wlConfig()); // wl_v2 + every wl_* / whitelist_* key of the model
  cfg.whitelist_enabled = (mode || tab) === "whitelist";
  cfg.last_tab = mode || tab;
  return cfg;
}
const persist = debounce(() => saveCfg(collectCfg()), 250);
const changed = (): void => {
  tabNs.refreshQ(S.cfg);
  tabNs.refreshSounds();
  persist();
};

// ---------------------------------------------------------------- lists (hub + NeverSink s2 + real names)
async function loadLists(force: boolean): Promise<void> {
  if (loadingLists) return;
  loadingLists = true;
  const g = game;
  log("⟳ โหลดรายการ whitelist (hub + NeverSink)…", "info");
  tabWl.setLoading(true);
  let hub = null, base: string | null = null, tag: string | null = null, names: string[] | null = null, from = "";
  try { hub = await getHub(g); } catch (e: any) { log(`⚠ ดึง hub ไม่ได้: ${e.message}`, "warn"); }
  try { [base, tag] = await fetchBase(g, 2, !!force); } catch (e: any) { log(`⚠ ดึง NeverSink base filter ไม่ได้: ${e.message}`, "warn"); }
  if (!base) log("⚠ ไม่มี NeverSink base filter (GitHub ล่ม + ไม่มี cache) — รายการ tier เริ่มต้นไม่ครบ", "warn");
  const n = await getNames(g, dataBase);
  if (n) {
    names = n.names;
    from = n.from;
  } else log("⚠ ไม่มีรายชื่อไอเท็มจริง (hub และ snapshot ใช้ไม่ได้) — ชื่อที่ NeverSink ไม่มีจะไม่ถูกเขียน", "warn");
  loadingLists = false;
  if (g !== game) return; // the game was switched while loading
  S.data = { hub, base, baseTag: tag, names, namesFrom: from };
  logAll(S.api.wlLoad(hub, base || "", names));
  if (from) log(`รายชื่อไอเท็มจริง: จาก snapshot ที่มากับหน้านี้${tag ? ` · NeverSink ${tag}` : ""}`, "info");
  tabWl.reload();
  tabNs.showTag(game);
}

// ---------------------------------------------------------------- generate
function soundNamesInUse(cfg: Record<string, any>): string[] {
  const out: string[] = [];
  for (const n of ["1", "2", "3", "4", "5", "6"]) if (cfg[`sound_${n}`]) out.push(cfg[`sound_${n}`]);
  const q = cfg.style_q && cfg.style_q.sound;
  if (q && q.kind === "file" && q.file) out.push(q.file);
  for (const s of Object.values<any>(cfg.wl_tier_style || {})) if (s && s.sound && s.sound.kind === "file" && s.sound.file) out.push(s.sound.file);
  return out;
}

function askConflicts(conflicts: { name: string; new_name: string }[]): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const dlg = $<HTMLDialogElement>("#dlg-ask");
    const decisions: Record<string, HTMLSelectElement> = {};
    const rows = conflicts.map((c) => {
      const sel = h("select", { "aria-label": `ไฟล์ ${c.name}` },
        h("option", { value: "keep" }, `เก็บไฟล์เดิมไว้ แล้วใช้ชื่อ "${c.new_name}" สำหรับไฟล์ใหม่`),
        h("option", { value: "overwrite" }, "ทับไฟล์เดิม"));
      decisions[c.name] = sel;
      return h("div", { class: "row" }, h("div", {}, `ในโฟลเดอร์ filter มีไฟล์ "${c.name}" อยู่แล้ว แต่เป็นคนละไฟล์กับที่เลือก`), sel);
    });
    dlg.replaceChildren(h("h3", {}, "ไฟล์เสียงชื่อซ้ำ"), ...rows,
      h("div", { class: "actions" }, h("button", { type: "button", id: "ask-ok", onclick: () => {
        const out: Record<string, string> = {};
        for (const [k, s] of Object.entries(decisions)) out[k] = s.value;
        dlg.close();
        resolve(out);
      } }, "ตกลง")));
    dlg.addEventListener("cancel", (e) => e.preventDefault(), { once: true });
    dlg.showModal();
  });
}

async function generate(mode: "tier" | "whitelist", refresh: boolean): Promise<void> {
  const cfg = collectCfg(mode);
  saveCfg(cfg);
  const key = mode === "whitelist" ? "filter_name_whitelist" : "filter_name_tier";
  const v = S.api.validateName(cfg[key]);
  if (v.error) {
    log(`✗ ชื่อ filter ใช้ไม่ได้: ${v.error}`, "err");
    return;
  }
  const name = v.name || cfg[key];
  setBusy(true);
  try {
    let hub = null, base: string | null = null, tag: string | null = null, names: string[] | null = null;
    if (mode === "whitelist") {
      if (refresh) await loadLists(true);
      ({ hub, base, baseTag: tag, names } = S.data);
      if (!base) {
        log("⚠ ไม่มี NeverSink base filter — whitelist ไม่มี tier เริ่มต้น ไม่ generate", "warn");
        return;
      }
    } else {
      log(`⟳ ดึง NeverSink base filter (${game})…`, "info");
      const s = cfg[`strictness_${game}`];
      [base, tag] = await fetchBase(game, Number.isInteger(s) ? s : 2, !!refresh);
      if (base === null) {
        log("⚠ ไม่มี NeverSink base filter ให้ใช้ (GitHub ล่ม + ไม่มี cache)", "warn");
        return;
      }
      log(`✓ NeverSink base filter พร้อม (tag=${tag})`, "ok");
      tabNs.showTag(game);
    }
    const logFn = (m: string, t = "info"): void => log(m, t);
    let existing: Record<string, string | null> | null = null;
    if (FS.ready) {
      try {
        const wanted = new Set(soundNamesInUse(cfg).map((n) => S.api.safeName(n)));
        existing = await FS.existingFor(wanted);
      } catch (e: any) {
        log(`⚠ อ่านโฟลเดอร์เกมไม่ได้: ${e.message}`, "warn");
        existing = null;
      }
    }
    let decisions: Record<string, string> = {};
    let res = null;
    for (let round = 0; round < 3; round++) {
      res = await S.api.generate({ cfg, game, hub, baseText: base, baseTag: tag, log: logFn, hashes: sounds.hashes(), names, existing, decisions });
      if (res.status !== "ask") break;
      decisions = await askConflicts(res.conflicts!);
    }
    if (res!.status === "error") { log(`✗ ${res!.message}`, "err"); return; }
    if (res!.status === "none") { log("⚠ ยังไม่ได้เลือกอะไร — ไม่ generate", "warn"); return; }
    if (res!.status !== "ok") { log("✗ สร้าง filter ไม่สำเร็จ", "err"); return; }
    log(res!.mode === "whitelist" ? `✓ filter โหมดโชว์เฉพาะ (${res!.count} รายการ)` : "✓ สร้าง filter แล้ว", "ok");
    await deliver(res!, name);
  } catch (e: any) {
    log(`✗ ${e.message || e}`, "err");
  } finally {
    setBusy(false);
  }
}

async function deliver(res: { text?: string; copies?: [string, string][]; sounds?: Record<string, string> }, name: string): Promise<void> {
  lastText = res.text as string;
  const fileName = `${name}.filter`;
  if (FS.ready) {
    try {
      if (await FS.exists(fileName) && !window.confirm(`จะเขียนทับไฟล์ ${fileName} ในโฟลเดอร์ ${FS.name}\nด้วยค่าที่ตั้งอยู่ตอนนี้ — ต้องการต่อหรือไม่?`)) {
        log("ยกเลิกการเขียนทับ — ไม่ได้เขียนไฟล์", "warn");
        return;
      }
      const written = await writeToFolder(res, name);
      log(`✓ เขียนลงโฟลเดอร์ ${FS.name}: ${written.join(", ")}`, "ok");
      log("Filter updated — reload in game (Options → Game)", "ok");
      showResult(null, `เขียนลงโฟลเดอร์ "${FS.name}" แล้ว: ${written.join(", ")}`);
      return;
    } catch (e: any) {
      log(`⚠ เขียนลงโฟลเดอร์ไม่ได้ (${e.message || e}) — ใช้ดาวน์โหลดแทน`, "warn");
    }
  }
  lastDownload = packDownload(res.text as string, name, res.sounds || {});
  log("Filter ready — ดาวน์โหลดแล้ววางในโฟลเดอร์เกม", "ok");
  showResult(lastDownload, null);
}

function showResult(dl: Download | null, written: string | null): void {
  $("#result").hidden = false;
  const btn = $("#btn-download");
  btn.hidden = !dl;
  if (dl) btn.textContent = dl.kind === "zip" ? `ดาวน์โหลด ${dl.filename} (filter + เสียง)` : `ดาวน์โหลด ${dl.filename}`;
  $("#result-info").textContent = written || (dl!.kind === "zip"
    ? `zip มี ${dl!.names!.length} ไฟล์เสียงที่ filter อ้างถึง — แตกลงโฟลเดอร์ filter ของเกม (Windows จะถามถ้าชื่อไฟล์ซ้ำ)`
    : "ไฟล์เดียว — วางในโฟลเดอร์ filter ของเกม");
  $("#result-steps").replaceChildren(...(written ? [] : [`วางไฟล์ใน ${DIRS[game]}`, "ในเกม: Options → Game → เลือก filter แล้ว reload"].map((t) => h("li", {}, t))));
}

function setBusy(on: boolean): void {
  for (const b of $$<HTMLButtonElement>("#btn-generate-tier, #btn-refresh, #btn-generate-wl, #btn-reload")) b.disabled = on;
}

// ---------------------------------------------------------------- open a filter file
async function openFile(file: File): Promise<void> {
  const text = await file.text();
  let folderFiles: string[] = [];
  if (FS.ready) {
    try { folderFiles = await FS.names(); } catch { folderFiles = []; }
  }
  const res = S.api.wlOpen(text, file.name, folderFiles);
  logAll(res.messages);
  if (!res.ok) return;
  Object.assign(S.cfg, res.cfg);
  S.cfg.filter_name_whitelist = res.name;
  for (const [label, name] of Object.entries(res.sounds || {})) { // the sound file sits in the connected folder
    try { await sounds.setBytes(label, name, "", await FS.read(name)); } // the tier's own slot (the style already names it)
    catch { log(`⚠ อ่านไฟล์เสียง ${name} จากโฟลเดอร์ไม่ได้`, "warn"); }
  }
  tabWl.load(S.cfg);
  tabWl.reload();
  tabNs.refreshSounds();
  showTab("whitelist");
  persist();
}

// ---------------------------------------------------------------- folder (File System Access)
/**
 * The folder of the game picked now: the picker (called straight from the click), then the name check - PoE1 expects
 * "Path of Exile", PoE2 "Path of Exile 2". Another name is asked about: pick again, or keep it (a player's own folder).
 * Returns true when a folder was adopted for the game.
 */
async function chooseFolder(): Promise<boolean> {
  const g = game;
  for (;;) {
    let handle: any;
    try {
      handle = await FS.choose(g);
    } catch (e: any) {
      if (!(e && e.name === "AbortError")) log(`⚠ เลือกโฟลเดอร์ไม่ได้: ${e && e.message ? e.message : e}`, "warn");
      return false;
    }
    let keep = FS.nameOk(g, handle.name);
    if (!keep) {
      const answer = await askFolderName(g, handle.name);
      if (answer === "again") continue; // (the picker is called from the click of that button)
      keep = answer === "keep";
    }
    if (!keep) return false;
    await FS.adopt(g, handle);
    if (g === game) refreshFolder();
    return true;
  }
}

function askFolderName(g: string, picked: string): Promise<"again" | "keep" | "cancel"> {
  return new Promise((resolve) => {
    const dlg = $<HTMLDialogElement>("#dlg-folder");
    const done = (v: "again" | "keep" | "cancel"): void => { dlg.close(); resolve(v); };
    dlg.replaceChildren(
      h("h3", {}, "ชื่อโฟลเดอร์ไม่ตรงกับเกม"),
      h("p", {}, `โฟลเดอร์ที่เลือกชื่อ "${picked}" แต่โฟลเดอร์ของ ${g === "poe2" ? "PoE2" : "PoE1"} ปกติชื่อ "${FS.folderName(g)}" (${DIRS[g]})`),
      h("p", { class: "hint" }, 'ถ้าตั้งใจใช้โฟลเดอร์ชื่อนี้ (เช่น ใช้โฟลเดอร์ของตัวเอง) เลือก "ใช้โฟลเดอร์นี้ต่อ"'),
      h("div", { class: "actions" },
        h("button", { type: "button", id: "btn-folder-again", onclick: () => done("again") }, "เลือกใหม่"),
        h("button", { type: "button", id: "btn-folder-keep", class: "secondary", onclick: () => done("keep") }, "ใช้โฟลเดอร์นี้ต่อ"),
        h("button", { type: "button", id: "btn-folder-cancel", class: "secondary", onclick: () => done("cancel") }, "ยกเลิก")));
    dlg.addEventListener("cancel", () => resolve("cancel"), { once: true });
    dlg.showModal();
  });
}

function refreshFolder(): void {
  const box = $("#folder-box");
  box.hidden = !FS.supported;
  if (!FS.supported) return;
  const name = $("#folder-name");
  if (FS.state === "granted") { name.textContent = `${FS.name} — เขียนไฟล์ลงที่นี่โดยตรง`; name.className = "ok-text"; }
  else if (FS.state === "prompt") { name.textContent = `${FS.name} — ต้องยืนยันสิทธิ์อีกครั้ง`; name.className = "muted"; }
  else { name.textContent = "ยังไม่ได้เลือก — จะดาวน์โหลดเป็นไฟล์แทน"; name.className = "muted"; }
  $("#btn-folder-grant").hidden = FS.state !== "prompt";
  $("#btn-folder-forget").hidden = FS.state === "none";
  const odd = FS.state !== "none" && !FS.nameOk(game, FS.name);
  $("#folder-hint").textContent = `Chrome / Edge: เลือกโฟลเดอร์ ${DIRS[game]} แล้วโปรแกรมเขียน .filter และไฟล์เสียงลงไปให้เลย`
    + (odd ? ` · โฟลเดอร์ที่ใช้อยู่ชื่อ "${FS.name}" ไม่ใช่ "${FS.folderName(game)}" (ใช้ต่อได้)` : "");
}

// ---------------------------------------------------------------- tabs / game
function showTab(t: string): void {
  tab = t;
  for (const b of $$(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === t));
  $("#pane-tier").hidden = t !== "tier";
  $("#pane-whitelist").hidden = t !== "whitelist";
  persist();
}

async function setGame(g: string): Promise<void> {
  game = g;
  store.set(KEY_GAME, g);
  for (const b of $$(".game-toggle button")) b.setAttribute("aria-pressed", String(b.dataset.game === g));
  const init = S.api.wlInit(g, S.cfg);
  Object.assign(S.cfg, init.updates);
  for (const n of init.notes) log("ℹ " + n, "warn");
  for (const [from, to] of Object.entries(init.moved || {})) await sounds.copy(from, to); // the old S / A / B files -> sounds 1 / 2 / 3
  S.data = { hub: null, base: null, baseTag: null, names: null, namesFrom: "" };
  tabNs.load(S.cfg, g);
  tabWl.load(S.cfg);
  tabWl.reload();
  await FS.init(g);
  refreshFolder();
  void loadLists(false);
}

// ---------------------------------------------------------------- boot
export async function boot(root: HTMLElement, opts: BootOptions = {}): Promise<void> {
  dataBase = opts.dataBase ?? "./";
  root.innerHTML = SHELL_HTML;
  if (opts.title) $("#app-title").textContent = opts.title;
  $("#ver").textContent = `เวอร์ชัน ${APP_VERSION}`;
  (window as any).PFG = { api: S.api, FS, hooks, sounds, store, state: S };

  await sounds.load();
  S.cfg = loadCfg();
  const ctx: Ctx = {
    cfg: S.cfg, changed, generate, openFile, gotoNsTab: () => showTab("tier"), reloadLists: () => loadLists(true), game: () => game,
    // "เปิด filter…": the folder's list / the file picker; `fallback` is the plain file input. Nothing may fail silently here: a
    // list that throws says why and the next click goes straight to the plain input (it needs the click itself)
    openFilter: async (fallback) => {
      if (S.openFilterBroken) return fallback();
      try {
        await hooks.openFilter({ game, openFile, fallback, log, chooseFolder, dirHint: DIRS[game] });
      } catch (e: any) {
        S.openFilterBroken = true;
        log(`⚠ เปิดรายการไฟล์ไม่ได้: ${e && e.message ? e.message : e} — กด "เปิด filter…" อีกครั้งเพื่อเลือกไฟล์ด้วยช่องเลือกไฟล์`, "err");
      }
    },
  };
  S.ctx = ctx;
  tabNs.mount($("#pane-tier"), ctx);
  tabWl.mount($("#pane-whitelist"), ctx);
  for (const b of $$(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab as string));
  for (const b of $$(".game-toggle button")) {
    b.addEventListener("click", () => {
      if (b.dataset.game !== game) {
        persist();
        saveCfg(collectCfg());
        void setGame(b.dataset.game as string);
      }
    });
  }
  $("#btn-download").addEventListener("click", () => { if (lastDownload) saveBlob(lastDownload.bytes, lastDownload.filename, lastDownload.mime); });
  $("#btn-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lastText); log("คัดลอกแล้ว", "ok"); } catch { log("คัดลอกไม่ได้ (เบราว์เซอร์ไม่อนุญาต)", "warn"); }
  });
  $("#btn-folder").addEventListener("click", async () => { await chooseFolder(); refreshFolder(); });
  $("#btn-folder-grant").addEventListener("click", async () => {
    try { if (!(await FS.grant())) log("⚠ ไม่ได้รับสิทธิ์เขียนโฟลเดอร์", "warn"); } catch (e: any) { log(`⚠ ${e.message || e}`, "warn"); }
    refreshFolder();
  });
  $("#btn-folder-forget").addEventListener("click", async () => { await FS.forget(game); refreshFolder(); });

  $("#loading").hidden = true;
  $("#app").hidden = false;
  const g = store.get(KEY_GAME);
  showTab(S.cfg.last_tab === "whitelist" ? "whitelist" : "tier");
  await setGame(g === "poe1" || g === "poe2" ? g : "poe2");
}
