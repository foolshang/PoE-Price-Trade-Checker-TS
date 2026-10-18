// A throw-away update feed for the tests: serves a folder over http on 127.0.0.1 (with Range, which electron-updater uses),
// and counts what was asked for. Nothing here talks to the internet.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export async function serveFolder(dir, { yml = {}, port: wantPort = 0 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "");
    requests.push({ name, range: req.headers.range || "" });
    const file = path.join(dir, name);
    if (!name || name.includes("..") || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end("not found");
    }
    if (yml[name]) { // a changed copy of a .yml (a wrong checksum ...)
      const body = yml[name](fs.readFileSync(file, "utf-8"));
      res.writeHead(200, { "content-type": "text/yaml" });
      return res.end(body);
    }
    const size = fs.statSync(file).size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.writeHead(206, { "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-length": size, "accept-ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(wantPort, "127.0.0.1", r));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
