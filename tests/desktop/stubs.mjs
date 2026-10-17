// A fake internet for the app. The main process fetches with Chromium (net.fetch), so the four hosts it talks to are mapped
// to a local HTTPS server with command line switches of Chromium - the same code path as in real use, in the packaged exe too.
// (tests/desktop/certs is a throw-away key and certificate for this server only.)
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import zlib from "node:zlib";
import { FIXTURES } from "./harness.mjs";

const gz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, f))).toString("utf-8");
const CERTS = path.join(import.meta.dirname, "certs");

/** GGG's stats payload ({result:[{id, entries:[{id,text}]}]}) from the flat list of the fixtures */
function statsPayload(flat) {
  const groups = new Map();
  for (const s of flat) {
    if (!groups.has(s.type)) groups.set(s.type, { id: s.type, label: s.type, entries: [] });
    groups.get(s.type).entries.push({ id: s.id, text: s.text });
  }
  return JSON.stringify({ result: [...groups.values()] });
}

export function fixtureData() {
  const names = { poe1: JSON.parse(gz("trade_names_poe1.json.gz")), poe2: JSON.parse(gz("trade_names_poe2.json.gz")) };
  const payload = (list) => JSON.stringify({ result: [{ id: "all", label: "all", entries: list.map((name) => ({ name })) }] });
  return {
    hub: { poe1: gz("hub_poe1.json.gz"), poe2: gz("hub_poe2.json.gz") },
    ns: {
      poe1: fs.readFileSync(path.join(FIXTURES, "neversink_poe1_s2.filter"), "utf-8"),
      poe2: fs.readFileSync(path.join(FIXTURES, "neversink_poe2_s2.filter"), "utf-8"),
    },
    ggg: { poe1: payload(names.poe1), poe2: payload(names.poe2) },
    names,
    checker: Object.fromEntries(["poe1", "poe2"].map((g) => [g, {
      stats: statsPayload(JSON.parse(gz(`gstats_${g}.json.gz`))), items: gz(`gitems_${g}.json.gz`), meta: gz(`hub_meta_${g}.json.gz`),
      leagues: gz(`hub_league_index_${g}.json.gz`), skills: JSON.parse(gz(`hub_skills_${g}.json.gz`)),
    }])),
  };
}

const HOSTS = ["storage.googleapis.com", "api.github.com", "raw.githubusercontent.com", "www.pathofexile.com"];

/** Start the server; `args` = the Chromium switches that send the hosts to it. `tag` = the NeverSink release it reports. */
export async function fakeInternet(data = fixtureData(), { tag = "v-test" } = {}) {
  /** realItems: GGG's items endpoint answers with the real list of bases (the Checker), not the list of names the filter generator reads */
  const state = { tag, calls: [], hubDown: false, gggDown: false, realItems: false };
  const server = https.createServer({ key: fs.readFileSync(path.join(CERTS, "test.key")), cert: fs.readFileSync(path.join(CERTS, "test.crt")) }, (req, res) => {
    const host = String(req.headers.host || "").split(":")[0];
    const url = `https://${host}${req.url}`;
    state.calls.push(url);
    const send = (status, body, type = "text/plain; charset=utf-8") => { res.writeHead(status, { "content-type": type }); res.end(body); };
    if (host === "api.github.com") return send(200, JSON.stringify({ tag_name: state.tag }), "application/json");
    if (host === "raw.githubusercontent.com") return send(200, /PoE2/i.test(req.url) || /PoE2/i.test(decodeURIComponent(req.url)) ? data.ns.poe2 : data.ns.poe1);
    if (host === "storage.googleapis.com") {
      const m = req.url.match(/poe-data-hub\/(poe[12])\/(.*)$/);
      if (state.hubDown) return send(503, "down");
      if (m && m[2] === "prices/latest.json") return send(200, data.hub[m[1]], "application/json");
      if (m) {
        const c = data.checker[m[1]];
        const path = m[2];
        if (path === "prices/index.json") return send(state.noLeagueIndex ? 404 : 200, state.noLeagueIndex ? "not found" : (state.leagueIndex?.[m[1]] ?? c.leagues), "application/json");
        if (path === "meta/latest.json") return send(200, c.meta, "application/json");
        if (path === "skills/index.json") return send(200, JSON.stringify(state.skillsIndex ?? c.skills.index), "application/json");
        if (path === "skills/dictionary.json") return send(200, JSON.stringify(c.skills.dictionary), "application/json");
        if (path === "passives/latest.json") return send(200, JSON.stringify(c.skills.passives), "application/json");
        const file = c.skills.files[`${m[1]}/${path}`];
        if (file) return send(200, JSON.stringify(file), "application/json");
      }
      return send(404, "not found");
    }
    if (host === "www.pathofexile.com") {
      if (state.gggDown) return send(503, "down");
      if (req.url.startsWith("/api/trade2/data/items")) return send(200, state.realItems ? data.checker.poe2.items : data.ggg.poe2, "application/json");
      if (req.url.startsWith("/api/trade/data/items")) return send(200, state.realItems ? data.checker.poe1.items : data.ggg.poe1, "application/json");
      if (req.url.startsWith("/api/trade2/data/stats")) return send(200, data.checker.poe2.stats, "application/json");
      if (req.url.startsWith("/api/trade/data/stats")) return send(200, data.checker.poe1.stats, "application/json");
    }
    send(404, "unexpected " + url);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const args = [
    `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(", ")}`,
    "--ignore-certificate-errors",
  ];
  return { state, args, port, close: () => new Promise((r) => server.close(r)), calls: () => state.calls.slice() };
}
