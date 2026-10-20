// A controlled foreground window for the F5 tests: a plain Windows text box holding the item text, selected, brought to the front.
// F5 sends Ctrl+C to whatever is in front - in a test that must be this box and nothing else (a terminal would take Ctrl+C as an interrupt).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const FindWindowW = user32.func("void* __stdcall FindWindowW(const char16_t *cls, const char16_t *title)");
const SetForegroundWindow = user32.func("bool __stdcall SetForegroundWindow(void *h)");
const GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");
const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(void *h, _Out_ uint16_t *buf, int n)");
const keybd_event = user32.func("void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function foregroundTitle() {
  const buf = new Uint16Array(256);
  const len = GetWindowTextW(GetForegroundWindow(), buf, 256);
  return String.fromCharCode(...buf.slice(0, len));
}

/** key down+up of Alt: Windows then lets this process take the foreground */
function altTap() {
  keybd_event(0x12, 0, 0, 0);
  keybd_event(0x12, 0, 2, 0);
}

export async function openTextBox(file, title, { grab = false } = {}) {
  const ready = path.join(os.tmpdir(), `pfg-box-${process.pid}-${Date.now()}.ready`);
  const keyLog = ready.replace(/\.ready$/, ".keys");
  const proc = spawn("powershell", ["-NoProfile", "-STA", "-File", path.join(import.meta.dirname, "textbox.ps1"), file, title, ready, keyLog, grab ? "1" : "0"], { stdio: "ignore", windowsHide: true });
  let hwnd = null;
  for (let i = 0; i < 100 && !hwnd; i++) {
    await sleep(100);
    hwnd = FindWindowW(null, title);
  }
  if (!hwnd) throw new Error("the test text box did not open");
  for (let i = 0; i < 20; i++) {
    altTap();
    SetForegroundWindow(hwnd);
    await sleep(150);
    if (foregroundTitle() === title) break;
  }
  for (let i = 0; i < 50 && !fs.existsSync(ready); i++) await sleep(100); // the text is selected and the window is settled
  // the Alt tap above puts the window in menu mode, which would swallow the next key: leave it with Esc
  keybd_event(0x1b, 0, 0, 0);
  keybd_event(0x1b, 0, 2, 0);
  await sleep(150);
  try { fs.unlinkSync(ready); } catch { /* none */ }
  if (foregroundTitle() !== title) {
    proc.kill();
    throw new Error(`the test text box could not be brought to the front (the front window is "${foregroundTitle()}")`);
  }
  return {
    title,
    /** the key events the box saw since it was ready: [{ms, kind: "D"|"U", vk}] */
    keys() {
      let text = "";
      try { text = fs.readFileSync(keyLog, "utf-8"); } catch { return []; }
      const all = text.split(/\r?\n/).filter(Boolean).map((l) => { const [ms, kind, vk] = l.split(" "); return { ms: parseFloat(ms), kind, vk: parseInt(vk, 10) }; });
      let from = 0;
      all.forEach((e, i) => { if (e.kind === "U" && e.vk === 27) from = i + 1; }); // after the Esc tap that leaves the menu mode
      return all.slice(from);
    },
    async close() {
      try { execFileSync("taskkill", ["/F", "/PID", String(proc.pid), "/T"], { stdio: "ignore" }); } catch { /* gone */ }
    },
  };
}

const VK = { F4: 0x73, F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77, F9: 0x78, Q: 0x51, CTRL: 0x11, ALT: 0x12, SHIFT: 0x10 };
/** a real key press (down, up) - the hotkeys of the program are system-wide, so they react to it */
export async function pressKey(name, mods = [], { holdMs = 0 } = {}) {
  for (const m of mods) keybd_event(VK[m], 0, 0, 0);
  keybd_event(VK[name], 0, 0, 0);
  await sleep(40);
  keybd_event(VK[name], 0, 2, 0);
  await sleep(holdMs); // (the modifiers stay down while the program reacts)
  for (const m of [...mods].reverse()) keybd_event(VK[m], 0, 2, 0);
}

/** a key that is HELD: the key-down comes again and again (the keyboard repeat) and the key goes up at the end */
export async function holdKey(name, { repeats = 8, intervalMs = 120 } = {}) {
  for (let i = 0; i < repeats; i++) {
    keybd_event(VK[name], 0, 0, 0);
    await sleep(intervalMs);
  }
  keybd_event(VK[name], 0, 2, 0);
}

const GetAsyncKeyState = user32.func("int16 __stdcall GetAsyncKeyState(int vk)");
/** the modifier keys that are down right now (Shift, Ctrl, Alt, Win) */
export function modifiersDown() {
  return [0x10, 0x11, 0x12, 0x5b, 0x5c].filter((vk) => GetAsyncKeyState(vk) < 0);
}

const SetCursorPos = user32.func("bool __stdcall SetCursorPos(int x, int y)");
/** move the mouse pointer (screen pixels) */
export function setCursor(x, y) {
  return SetCursorPos(x, y);
}

// ---- what windows exist: the OS's own list (EnumWindows), not Electron's
const EnumWindowsProc = koffi.proto("bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lparam)");
const EnumWindows = user32.func("bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lparam)");
const IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(void *h)");
const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32_t *pid)");
const GetClassNameW = user32.func("int __stdcall GetClassNameW(void *h, _Out_ uint16_t *buf, int n)");
const GetWindowRect = user32.func("bool __stdcall GetWindowRect(void *h, _Out_ int32_t *rect)");
const IsIconic = user32.func("bool __stdcall IsIconic(void *h)");
const text16 = (fn, h) => { const b = new Uint16Array(256); const n = fn(h, b, 256); return String.fromCharCode(...b.slice(0, n)); };

/** every visible top-level window of the given process ids: [{title, cls, x, y, w, h, minimized}] */
export function visibleWindowsOf(pids) {
  const want = new Set(pids);
  const out = [];
  const cb = koffi.register((h) => {
    if (!IsWindowVisible(h)) return true;
    const pid = [0];
    GetWindowThreadProcessId(h, pid);
    if (!want.has(pid[0])) return true;
    const r = [0, 0, 0, 0];
    GetWindowRect(h, r);
    out.push({ title: text16(GetWindowTextW, h), cls: text16(GetClassNameW, h), x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1], minimized: !!IsIconic(h) });
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
  return out;
}

/** titles of the visible top-level windows, top of the z-order first */
export function zOrderTitles() {
  const out = [];
  const cb = koffi.register((h) => {
    if (IsWindowVisible(h)) { const t = text16(GetWindowTextW, h); if (t) out.push(t); }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
  return out;
}

const GetWindowLongW = user32.func("int32 __stdcall GetWindowLongW(void *h, int idx)");
const WindowFromPoint = user32.func("void* __stdcall WindowFromPoint(int32 x, int32 y)");
const mouse_event = user32.func("void __stdcall mouse_event(uint32 flags, int32 dx, int32 dy, uint32 data, uintptr_t extra)");

/** the extended style bits of the window with this title (0 when there is none) */
export function exStyleOf(title) {
  const h = FindWindowW(null, title);
  return h ? GetWindowLongW(h, -20) >>> 0 : 0;
}
/** [x, y, w, h] of the window with this title, null when there is none */
export function rectOfTitle(title) {
  const h = FindWindowW(null, title);
  if (!h) return null;
  const r = [0, 0, 0, 0];
  GetWindowRect(h, r);
  return [r[0], r[1], r[2] - r[0], r[3] - r[1]];
}
/** does the window with this title answer a hit test at (x, y)? (click-through windows do not) */
export function titleAtPoint(x, y) {
  const h = WindowFromPoint(x, y);
  return h ? text16(GetWindowTextW, h) : "";
}
export function clickAt(x, y) {
  setCursor(x, y);
  mouse_event(0x0002, 0, 0, 0, 0);
  mouse_event(0x0004, 0, 0, 0, 0);
}

const RegisterHotKey = user32.func("bool __stdcall RegisterHotKey(void *h, int id, uint32 mods, uint32 vk)");
const UnregisterHotKey = user32.func("bool __stdcall UnregisterHotKey(void *h, int id)");
/** hold a hotkey like "another program" does; returns the release function (false when it is taken) */
export function holdHotkey(vk, id = 77) {
  if (!RegisterHotKey(null, id, 0x4000, vk)) return null;
  return () => UnregisterHotKey(null, id);
}
