/**
 * Economy Filter Generator - filesystem side: Documents/My Games resolution, writing the merged .filter, sound-file copy.
 * Port of poe_price_trade/filter_output.py. The folder of the Documents library is given by the caller (Electron:
 * `app.getPath("documents")`, which honours OneDrive redirection like SHGetKnownFolderPath did); the file system is a port.
 */
import * as filterCore from "./filter_core.ts";
import { FsPort } from "./ports.ts";
import { Log, PyError, noopLog, truthy } from "./py.ts";

/** The game's filter folder: the override when set, else <Documents>\My Games\Path of Exile[ 2]. */
export function gameFilterDir(fs: FsPort, documentsDir: string, game: string, override = ""): string {
  if (override) return override;
  const sub = game === "poe2" ? "Path of Exile 2" : "Path of Exile";
  return fs.join(documentsDir, "My Games", sub);
}

export const filterPath = (fs: FsPort, dir: string, name: string = filterCore.DEFAULT_TIER_NAME): string => fs.join(dir, `${name}.filter`);

/**
 * generatedSection (our blocks, may be "") + baseText (NeverSink, may be null) -> dir/<name>.filter, overwritten
 * unconditionally. Throws a ValueError if the name is not usable, or if both sources are empty - the caller must not
 * touch the existing file in that case.
 */
export async function writeFilter(fs: FsPort, dir: string, generatedSection: string, baseText: string | null,
  name: string = filterCore.DEFAULT_TIER_NAME): Promise<string> {
  const [, err] = filterCore.validateFilterName(name);
  if (err) throw new PyError("ValueError", err);
  const body = filterCore.composeFilterBody(generatedSection, baseText);
  await fs.mkdirp(dir);
  const path = filterPath(fs, dir, name);
  await fs.writeText(path, body);
  return path;
}

/**
 * sound_map: {label: source file or null} (labels: S/A/B/C/Q ...). Copies each chosen sound into the filter folder under
 * its ORIGINAL file name ("#" / ";" become "_") and returns {label: name written}. Nothing already in the folder is
 * touched silently: same name + same content = reuse it; same name + different content = decide(name, newName) ->
 * "overwrite" | "keep" (default keep: the new file gets newName). notify(text) gets every message the user should see.
 */
export async function copySounds(fs: FsPort, dir: string, soundMap: Record<string, string | null> | null,
  decide?: filterCore.Decide | null, notify: (text: string) => void = () => {}, warn: Log = noopLog): Promise<Record<string, string>> {
  const requests: [string, string, string][] = [];
  const srcs = new Map<string, string>();
  for (const [label, src] of Object.entries(soundMap ?? {})) {
    if (!truthy(src)) continue;
    if (!(await fs.isFile(src!))) {
      warn(`Filter sound for ${label} not found: ${src}`, "warn");
      notify(`⚠ ไม่พบไฟล์เสียง "${src}" (ข้าม)`);
      continue;
    }
    requests.push([label, fs.basename(src!), await fs.sha256(src!)]);
    srcs.set(label, src!);
  }
  if (!requests.length) return {};
  const existing: Record<string, string | null> = {};
  if (await fs.isDir(dir)) {
    const wanted = new Set(requests.map(([, n]) => filterCore.safeSoundName(n)[0]));
    for (const name of await fs.listDir(dir)) {
      const p = fs.join(dir, name);
      if (await fs.isFile(p)) existing[name] = wanted.has(name) ? await fs.sha256(p) : null;
    }
  }
  const plan = filterCore.planSoundFiles(requests, existing);
  const [dest, copies, msgs] = filterCore.resolveSoundPlan(plan, decide);
  for (const m of msgs) notify(m);
  await fs.mkdirp(dir);
  const done = new Set<string>();
  for (const [label, final] of copies) {
    try {
      await fs.copyFile(srcs.get(label)!, fs.join(dir, final));
      done.add(final);
    } catch (e) {
      warn(`Filter sound copy failed (${label}): ${(e as Error).message}`, "warn");
      notify(`⚠ ก๊อปไฟล์เสียง "${final}" ไม่ได้: ${(e as Error).message}`);
    }
  }
  const reused = new Set(plan.items.filter((it) => it.status === "same").map((it) => it.dest));
  const out: Record<string, string> = {};
  for (const [lab, d] of Object.entries(dest)) if (done.has(d) || reused.has(d)) out[lab] = d;
  return out;
}
