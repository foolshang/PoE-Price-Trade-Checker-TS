// Stand-ins for the two games: a plain window in a program called like the game's (PathOfExile_x64Steam.exe) inside a folder called like the
// game's ("Path of Exile" / "Path of Exile 2"). The real games have the same exe names in both, so the folder (and the title) is all that
// tells them apart - which is exactly what the Checker looks at.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import koffi from "koffi";
import { foregroundTitle } from "./win.mjs";

const user32 = koffi.load("user32.dll");
const FindWindowW = user32.func("void* __stdcall FindWindowW(const char16_t *cls, const char16_t *title)");
const SetForegroundWindow = user32.func("bool __stdcall SetForegroundWindow(void *h)");
const keybd_event = user32.func("void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FOLDER = { poe1: "Path of Exile", poe2: "Path of Exile 2" };

let built = null;
function build() {
  if (built && fs.existsSync(built)) return built;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-standin-build-"));
  const out = path.join(dir, "PathOfExile_x64Steam.exe");
  const src = path.join(import.meta.dirname, "standin_game.cs");
  execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -TypeDefinition ([IO.File]::ReadAllText('${src}')) -OutputAssembly '${out}' -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms`], { windowsHide: true });
  built = out;
  return out;
}

/** give the keyboard focus to the window with this title (a real click in the window does the same for a player) */
export async function bringTitleToFront(title) {
  const hwnd = FindWindowW(null, title);
  if (!hwnd) throw new Error(`no window titled "${title}"`);
  for (let i = 0; i < 20; i++) {
    keybd_event(0x12, 0, 0, 0); keybd_event(0x12, 0, 2, 0);
    SetForegroundWindow(hwnd);
    await sleep(150);
    if (foregroundTitle() === title) { keybd_event(0x1b, 0, 0, 0); keybd_event(0x1b, 0, 2, 0); await sleep(100); return; }
  }
  throw new Error(`could not bring "${title}" to the front (front = "${foregroundTitle()}")`);
}

/** start a stand-in of `game` (title = the real game's) in a folder like the real install; `root` = where the game folders are made */
export async function openGame(game, root, { title = FOLDER[game], folder = FOLDER[game] } = {}) {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, "PathOfExile_x64Steam.exe");
  fs.copyFileSync(build(), exe);
  const proc = spawn(exe, [title], { stdio: "ignore", windowsHide: false });
  let hwnd = null;
  for (let i = 0; i < 100 && !hwnd; i++) { await sleep(100); hwnd = FindWindowW(null, title); }
  if (!hwnd) throw new Error("the stand-in game did not open");
  const g = {
    title, exe,
    async front() {
      for (let i = 0; i < 20; i++) {
        keybd_event(0x12, 0, 0, 0); keybd_event(0x12, 0, 2, 0); // an Alt tap: Windows then lets this process take the foreground
        SetForegroundWindow(hwnd);
        await sleep(150);
        if (foregroundTitle() === title) { keybd_event(0x1b, 0, 0, 0); keybd_event(0x1b, 0, 2, 0); await sleep(100); return; }
      }
      throw new Error(`could not bring "${title}" to the front (front = "${foregroundTitle()}")`);
    },
    async close() { try { execFileSync("taskkill", ["/F", "/PID", String(proc.pid), "/T"], { stdio: "ignore" }); } catch { /* gone */ } },
  };
  return g;
}
