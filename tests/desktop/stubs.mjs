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
  };
}

const HOSTS = ["storage.googleapis.com", "api.github.com", "raw.githubusercontent.com", "www.pathofexile.com"];

/** Start the server; `args` = the Chromium switches that send the hosts to it. `tag` = the NeverSink release it reports. */
export async function fakeInternet(data = fixtureData(), { tag = "v-test" } = {}) {
  const state = { tag, calls: [], hubDown: false, gggDown: false };
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
      return send(404, "not found");
    }
    if (host === "www.pathofexile.com") {
      if (state.gggDown) return send(503, "down");
      if (req.url.startsWith("/api/trade2/data/items")) return send(200, data.ggg.poe2, "application/json");
      if (req.url.startsWith("/api/trade/data/items")) return send(200, data.ggg.poe1, "application/json");
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
