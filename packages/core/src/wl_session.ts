/**
 * What the Whitelist tab says and decides when a filter file is opened or the item lists arrive. Port of
 * poe_price_trade/wl_session.py: kept in the shared core so the desktop window and the web page show the same messages
 * and make the same choices. No file or network access: the caller reads the file and answers the two small questions
 * about sound files through callbacks.
 *
 * Messages are [tag, text] pairs, tag = "ok" | "warn" | "err" | "info", in the order they are to be shown.
 */
import * as filterCore from "./filter_core.ts";
import * as filterStyle from "./filter_style.ts";
import * as wlEmbed from "./wl_embed.ts";
import * as wlImport from "./wl_import.ts";
import { WlModel } from "./wl_model.ts";
import { isDict, truthy } from "./py.ts";

export type Message = [string, string];

export interface Opened {
  ok: boolean;
  messages: Message[];
  model: WlModel | null;
  name: string; // the filter name = the file name without ".filter"
  sounds: Record<string, string>; // S|A|B -> what to put in that sound slot (a path / name)
  kind: string; // "embedded" | "old"
  app: string; // program version that wrote the embedded settings ("" = not recorded)
}

const fail = (tag: string, text: string): Opened => ({ ok: false, messages: [[tag, text]], model: null, name: "", sounds: {}, kind: "", app: "" });

/** After the item lists were given to the model: its notes, then the "loaded" line. */
export function dataLoadedMessages(model: WlModel, baseText: string): Message[] {
  const out: Message[] = model.takeNotes().map((n): Message => ["warn", "⚠ " + n]);
  out.push(baseText ? ["ok", "✓ โหลดรายการ whitelist แล้ว"] : ["warn", "⚠ ไม่มี NeverSink base filter — ไม่มี tier เริ่มต้น"]);
  return out;
}

export type WlData = [hub: any, baseText: string, realNames: Iterable<string> | null];

export interface OpenOptions {
  /** (unused now: the tier sound is read from the model) */
  currentSound?: (label: string) => string;
  /** a path / handle when a file of that name sits next to the opened filter, else null */
  soundFile?: (name: string) => string | null;
  /** that folder when the caller has one: the file sounds of an old file's styles are then resolved to real paths */
  folder?: wlImport.FolderLike | null;
}

/**
 * Open the text of a whitelist filter file for the tab of `game`. `filename` = the file's name with its extension;
 * `current` = the settings now; `data` = [hub, base text, real names] or null when the lists are not loaded.
 */
export function openText(text: string, filename: string, game: string, current: WlModel, data: WlData | null, opts: OpenOptions = {}): Opened {
  const { soundFile = () => null, folder = null } = opts;
  const stem = filename.toLowerCase().endsWith(".filter") ? filename.slice(0, -".filter".length) : filename;
  const kind = wlEmbed.classify(text);
  const [, err] = filterCore.validateFilterName(stem);
  if ((kind === "ok" || kind === "no_config") && err) return fail("err", `✗ ชื่อไฟล์ใช้เป็นชื่อ filter ไม่ได้: ${err}`);
  if (kind === "no_config") return openOld(text, stem, filename, game, current, data, soundFile, folder);
  if (kind !== "ok") {
    return fail("warn", kind === "foreign" ? "✗ เปิดแก้ไม่ได้: ไฟล์นี้ไม่ได้สร้างจากแท็บ Whitelist ของโปรแกรมนี้"
      : "✗ เปิดแก้ไม่ได้: ไฟล์นี้สร้างจากแท็บ NeverSink ไม่ใช่ Whitelist");
  }
  const emb = wlEmbed.extract(text)!;
  if (emb.game !== game) return fail("warn", `✗ ไฟล์นี้เป็นของ ${emb.game.toUpperCase()} แต่หน้าต่างนี้เป็น ${game.toUpperCase()}`);
  const model = WlModel.fromConfig(emb.cfg, game);
  const msgs: Message[] = [];
  if (data !== null) {
    model.setData(data[0], data[1], data[2]);
    msgs.push(...model.takeNotes().map((n): Message => ["warn", "⚠ " + n]));
  }
  const made = truthy(emb.app) ? ` (ค่าฝังจากรุ่น ${emb.app})` : " (ค่าฝังไม่ได้บันทึกรุ่น)";
  msgs.push(["ok", `✓ เปิด ${filename} แล้ว${made} — แก้แล้วกด Generate Now เพื่อเขียนทับไฟล์นี้`]);
  return { ok: true, messages: msgs, model, name: stem, sounds: {}, kind: "embedded", app: emb.app || "" };
}

/** A whitelist file of this program from before settings were embedded (v1 / v2 engine): read its blocks back. */
function openOld(text: string, stem: string, filename: string, game: string, current: WlModel, data: WlData | null,
  soundFile: (name: string) => string | null, folder: wlImport.FolderLike | null): Opened {
  if (wlImport.versionOf(text) === null) return fail("warn", "✗ เปิดแก้ไม่ได้: ไฟล์นี้ไม่ได้สร้างจากแท็บ Whitelist ของโปรแกรมนี้");
  const guess = wlImport.guessGame(text);
  if (guess && guess !== game) return fail("warn", `✗ ไฟล์นี้ดูเป็นของ ${guess.toUpperCase()} แต่หน้าต่างนี้เป็น ${game.toUpperCase()}`);
  if (data === null) {
    return fail("warn", "✗ ยังโหลดรายการ whitelist ไม่เสร็จ — รอให้โหลดเสร็จแล้วเปิดไฟล์อีกครั้ง (ใช้ชื่อไอเท็มจริงอ่านไฟล์เก่ากลับ)");
  }
  const res = wlImport.read(text, game, current, folder);
  if (res === null || res.overlap < 0.2) return fail("warn", "✗ เปิดแก้ไม่ได้: ชื่อในไฟล์ไม่ตรงกับรายการของเกมนี้ — ไฟล์น่าจะเป็นของอีกเกมหรืออีกลีก");
  const model = res.model;
  const msgs: Message[] = model.takeNotes().map((n): Message => ["warn", "⚠ " + n]);
  const ver = res.version === "v1" ? "v1 (โชว์เฉพาะแบบเก่า)" : "v2 (ก่อนฝังค่าที่ตั้ง)";
  msgs.push(["ok", `✓ เปิด ${filename} แล้ว — ไฟล์รุ่น ${ver} ไม่มีค่าที่ฝังไว้ จึงอ่านกลับจาก block ` +
    `(แก้แล้วกด Generate Now เพื่อเขียนทับไฟล์นี้ แล้วไฟล์จะมีค่าฝังตามปกติ)`]);
  msgs.push(...res.notes.map((n): Message => ["warn", "⚠ เดา/ปรับ: " + n]));
  const sounds: Record<string, string> = {};
  for (const [label, fname] of Object.entries(res.sounds)) { // tier S / A / B sound = the file the old filter played
    if (label !== "S" && label !== "A" && label !== "B") continue; // Q is left to the NeverSink tab
    const curStyle: Record<string, any> = isDict(model.tier_style[label]) ? model.tier_style[label] : {};
    const curSound: Record<string, any> = truthy(curStyle.sound) ? curStyle.sound : {};
    const found = soundFile(fname);
    if (truthy(found)) {
      sounds[label] = found!;
      model.tier_style[label] = filterStyle.normalizeStyle({ ...curStyle, sound: { kind: "file", id: 1, file: String(found), volume: 300 } });
      msgs.push(["warn", `⚠ เสียง tier ${label} ของแท็บ Whitelist ตั้งเป็น ${fname} ตามไฟล์ที่เปิด`]);
    } else {
      if (curSound.kind === "file") { // the importer kept the bare name: no file, so no sound
        model.tier_style[label] = filterStyle.normalizeStyle({ ...curStyle, sound: { kind: "none" } });
      }
      msgs.push(["warn", `⚠ เสียง tier ${label} ในไฟล์คือ "${fname}" แต่ไม่พบไฟล์นี้ข้างๆ filter — ไม่ได้ตั้งเสียง`]);
    }
  }
  return { ok: true, messages: msgs, model, name: stem, sounds, kind: "old", app: "" };
}
