/**
 * The renderer of the desktop app: the same page as the web (packages/ui) with the desktop platform plugged in - the network
 * and the game folder go through the main process, the settings live in %LOCALAPPDATA%\PoeFilterGenTS.
 */
import { filterService } from "@poe/core";
import {
  FS, KEY_CFG, S, boot, flushConfig, h, nsLatestTag, platform, setAppVersion, setPlatform, setStoreBackend, sounds, store, useFolderBackend,
} from "@poe/ui";
import type { Platform } from "@poe/ui";
import type { GameId } from "../shared/api.ts";
import { desktopFolder } from "./desktop_folder.ts";

const d = window.desktop;
const TITLE = "PoE1 & PoE2 Filter Generator (TypeScript)";
const AUDIO = /\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i;
const base = (v: string): string => v.split(/[\\/]/).pop() as string;

/** The sound files the original program kept by path: read them (from that path or the game folder) into the page's slots. */
async function importLegacySounds(game: GameId): Promise<void> {
  const cfg = S.cfg;
  const jobs: { label: string; get(): unknown; set(name: string): void }[] = [];
  for (const n of ["1", "2", "3", "4", "5", "6"]) jobs.push({ label: n, get: () => cfg[`sound_${n}`], set: (v) => { cfg[`sound_${n}`] = v; } });
  for (const t of ["s", "a", "b", "c"]) jobs.push({ label: t.toUpperCase(), get: () => cfg[`sound_${t}`], set: (v) => { cfg[`sound_${t}`] = v; } });
  const q = cfg.style_q?.sound;
  if (q && q.kind === "file") jobs.push({ label: "Q", get: () => q.file, set: (v) => { q.file = v; } });
  for (const [label, st] of Object.entries<any>(cfg.wl_tier_style ?? {})) {
    const s = st?.sound;
    if (s && s.kind === "file") jobs.push({ label, get: () => s.file, set: (v) => { s.file = v; } });
  }
  let changed = false;
  for (const j of jobs) {
    const v = j.get();
    if (typeof v !== "string" || !v || !AUDIO.test(v)) continue;
    const have = sounds.mem[j.label];
    if (have && have.name === base(v)) { if (v !== base(v)) { j.set(base(v)); changed = true; } continue; }
    if (have) continue; // a sound the player already picked in this app
    const r = await d.readLegacySound(game, v);
    if (!r) continue; // the file is gone: the name stays (a filter naming it still works if it is in the folder)
    await sounds.setBytes(j.label, r.name, "", r.bytes);
    j.set(r.name);
    changed = true;
  }
  if (changed) store.set(KEY_CFG, JSON.stringify(cfg));
}

const desktopPlatform = (init: { version: string; configDir: string; importNote: string }): Platform => ({
  kind: "desktop",
  async getText(url, headers) {
    const r = await d.httpGet(url, headers);
    if (!r.ok && r.status === 0) throw new Error(r.text || "network error");
    return r;
  },
  getNames: (game) => d.tradeNames(game as GameId),
  beforeStart: (game) => importLegacySounds(game as GameId),
  onShell(log) {
    log(`PoE Filter Generator v${init.version} — config: ${init.configDir}`, "info"); // the version marker first (CLAUDE.md rule 5)
    if (init.importNote) log(init.importNote, "info");
  },
  nsExtras(cfg, changed) {
    const box = h("input", { type: "checkbox", id: "auto-regen-ns", checked: !!cfg.auto_regen_neversink, onchange: (e: Event) => {
      cfg.auto_regen_neversink = (e.target as HTMLInputElement).checked;
      changed();
    } });
    return [h("div", { class: "row" }, h("label", {}, box, " regenerate อัตโนมัติเมื่อ NeverSink ออกเวอร์ชันใหม่"))];
  },
  async afterGenerate(info) {
    const cfg = S.cfg;
    cfg[`last_filter_name_${info.mode}`] = info.name;
    if (info.mode === "tier" && info.baseTag) cfg[`neversink_tag_${info.game}`] = info.baseTag;
    store.set(KEY_CFG, JSON.stringify(cfg));
  },
  async adoptOpenedDir(game) {
    if (!FS.pickedDir) return;
    FS.pickedDir = "";
    const r = await d.adoptPickedDir(game as GameId);
    if (r) await FS.adopt(game, r);
  },
  onReady(ctl) {
    // at start: a newer NeverSink release than the one the tier filter was built from? regenerate (if asked) or say so
    setTimeout(async () => {
      try {
        const game = ctl.game();
        const cfgLike = { get: (k: string, dflt?: any) => (k === "filter_gen" ? S.cfg : dflt), set: () => {}, save: () => {}, appDir: () => init.configDir };
        const info = await filterService.checkNeversinkUpdate(cfgLike, game, nsLatestTag);
        if (!info) return;
        if (info.auto) {
          await ctl.generate("tier", true);
          if (S.cfg[`neversink_tag_${game}`] === info.new) ctl.log(filterService.neversinkUpdateMessage(info, true), "ok");
        } else ctl.log(filterService.neversinkUpdateMessage(info, false), "warn");
      } catch { /* a failed check is not worth a message */ }
    }, 1500);
  },
});

async function main(): Promise<void> {
  const init = await d.init();
  const mem = new Map(Object.entries(init.store));
  setStoreBackend({
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => { mem.set(k, v); d.storeSet(k, v); return true; },
    del: (k) => { mem.delete(k); d.storeDel(k); },
    keys: () => [...mem.keys()],
  });
  setAppVersion(init.version);
  setPlatform(desktopPlatform(init));
  useFolderBackend(desktopFolder(d));
  d.onFlush(() => { try { flushConfig(); } catch { /* the main process saves what it has */ } d.flushDone(); });
  document.title = `${TITLE} v${init.version}`;
  (window as any).PFG_DESKTOP = { platform };
  await boot(document.getElementById("root") as HTMLElement, { title: TITLE });
}

void main();
