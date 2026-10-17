/**
 * Node implementations of the core's ports (FsPort, HttpPort). Used by the Electron mains and by the tests.
 *
 * Text files behave like Python's text mode did in the original: reading turns "\r\n" and "\r" into "\n" (universal
 * newlines); writing on Windows gives "\r\n" line ends. A text that already holds "\r\n" (a NeverSink file downloaded
 * with CRLF line ends) is normalised first, so a file never gets "\r\r\n" (the original wrote that for such a text).
 */
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { FsPort, HttpError, HttpPort } from "@poe/core/src/ports.ts";

export interface NodeFsOptions {
  /** line ends of written text files; default "crlf" on Windows, "lf" elsewhere */
  eol?: "lf" | "crlf";
}

export class NodeFs implements FsPort {
  private eol: "lf" | "crlf";

  constructor(opts: NodeFsOptions = {}) {
    this.eol = opts.eol ?? (process.platform === "win32" ? "crlf" : "lf");
  }

  join = (...parts: string[]): string => path.join(...parts);
  basename = (p: string): string => path.basename(p);

  async exists(p: string): Promise<boolean> {
    try {
      await fsp.stat(p);
      return true;
    } catch {
      return false;
    }
  }
  async isFile(p: string): Promise<boolean> {
    try {
      return (await fsp.stat(p)).isFile();
    } catch {
      return false;
    }
  }
  async isDir(p: string): Promise<boolean> {
    try {
      return (await fsp.stat(p)).isDirectory();
    } catch {
      return false;
    }
  }
  async readText(p: string): Promise<string> {
    return (await fsp.readFile(p, "utf-8")).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  }
  async writeText(p: string, text: string): Promise<void> {
    const lf = text.replace(/\r\n?/g, "\n");
    await fsp.writeFile(p, this.eol === "crlf" ? lf.replaceAll("\n", "\r\n") : lf, "utf-8");
  }
  async mkdirp(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
  }
  listDir(dir: string): Promise<string[]> {
    return fsp.readdir(dir);
  }
  async mtimeSec(p: string): Promise<number> {
    return (await fsp.stat(p)).mtimeMs / 1000;
  }
  async sha256(p: string): Promise<string> {
    return createHash("sha256").update(await fsp.readFile(p)).digest("hex");
  }
  copyFile(src: string, dst: string): Promise<void> {
    return fsp.copyFile(src, dst);
  }
}

/** HTTP GET with a fetch function: the global one (Node >= 18) or Electron's `net.fetch` (Chromium network stack, follows the system proxy). */
export class NodeHttp implements HttpPort {
  constructor(private timeoutMs = 15000, private fetchFn: typeof fetch = fetch) {}

  async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const res = await this.fetchFn(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new HttpError(res.status, url);
    return new TextDecoder("utf-8", { fatal: false }).decode(await res.arrayBuffer());
  }
}
