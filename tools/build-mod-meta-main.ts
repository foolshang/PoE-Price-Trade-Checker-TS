/**
 * Build the mod tier ladders the Checker ships (`mod_meta_poe1.json`, `mod_meta_poe2.json`) from the community datamine, repoe-fork.
 * The TypeScript twin of tools/build_mod_meta.py of the original program (same output, byte for byte - see tests/parity).
 *
 *     npm run mod-meta:build                          both games from GitHub -> apps/checker/resources/
 *     npm run mod-meta:build -- --game poe2           one game
 *     npm run mod-meta:build -- --local <dir>         read <dir>/<game>/base_items.json + mods.json (or <dir>/base_items.json for one game)
 *     npm run mod-meta:build -- -o <dir or file>      write somewhere else
 *
 * A build that finds hollow data (too few bases / families, no prefixes, ...) stops with a message and writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { modMetaBuild } from "../packages/core/src/index.ts";

type Game = modMetaBuild.Game;

interface Args { games: Game[]; local: string | null; out: string | null }

function parseArgs(argv: string[]): Args {
  const a: Args = { games: ["poe1", "poe2"], local: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--game") {
      const g = argv[++i];
      if (g === "all") a.games = ["poe1", "poe2"];
      else if (g === "poe1" || g === "poe2") a.games = [g];
      else throw new Error(`--game poe1 | poe2 | all (got "${g}")`);
    } else if (v === "--local") a.local = argv[++i] ?? null;
    else if (v === "-o" || v === "--out") a.out = argv[++i] ?? null;
    else throw new Error(`unknown argument ${v}`);
  }
  return a;
}

async function load(game: Game, local: string | null, multi: boolean): Promise<[Record<string, any>, Record<string, any>]> {
  const texts: string[] = [];
  for (const name of modMetaBuild.FILES) {
    if (local) {
      const dir = multi && fs.existsSync(path.join(local, game)) ? path.join(local, game) : local;
      texts.push(fs.readFileSync(path.join(dir, name), "utf-8"));
    } else {
      const url = modMetaBuild.RAW_URL(game) + name;
      console.error(`ดึง ${url} …`);
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      texts.push(await res.text());
    }
  }
  for (const t of texts) {
    if (modMetaBuild.floatLookingIntegers(t)) {
      throw new Error("the source has a whole number written as a float (1.0): this builder would write 1 (the original program writes 1.0) - stop and look");
    }
  }
  return [JSON.parse(texts[0]), JSON.parse(texts[1])];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const defaultDir = path.resolve("apps", "checker", "resources");
  let code = 0;
  for (const game of args.games) {
    const t0 = Date.now();
    let outPath: string;
    if (args.out && args.games.length === 1 && /\.json$/i.test(args.out)) outPath = path.resolve(args.out);
    else outPath = path.join(path.resolve(args.out ?? defaultDir), `mod_meta_${game}.json`);
    try {
      const [bases, mods] = await load(game, args.local, args.games.length > 1);
      const { meta, tagsetsBeforeDedupe } = modMetaBuild.buildModMeta(game, bases, mods, modMetaBuild.utcStamp());
      const text = modMetaBuild.serialize(meta);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, text, "utf-8");
      const ms = Date.now() - t0;
      console.log(`เขียน ${outPath}  (${(Buffer.byteLength(text) / 1e6).toFixed(1)} MB)  bases=${Object.keys(meta.bases).length} ` +
        `tagsets=${Object.keys(meta.tagsets).length} (dedupe จาก ${tagsetsBeforeDedupe})  ใช้เวลา ${(ms / 1000).toFixed(1)} s`);
    } catch (e) {
      if (e instanceof modMetaBuild.ModMetaError) {
        console.error(`✗ validation ล้มเหลวสำหรับ --game ${game}:`);
        for (const p of e.problems) console.error(`  - ${p}`);
      } else console.error(`✗ ${game}: ${(e as Error).message}`);
      code = 1;
    }
  }
  return code;
}

process.exit(await main());
