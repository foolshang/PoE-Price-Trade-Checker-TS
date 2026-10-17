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

export async function openTextBox(file, title) {
  const ready = path.join(os.tmpdir(), `pfg-box-${process.pid}-${Date.now()}.ready`);
  const keyLog = ready.replace(/\.ready$/, ".keys");
  const proc = spawn("powershell", ["-NoProfile", "-STA", "-File", path.join(import.meta.dirname, "textbox.ps1"), file, title, ready, keyLog], { stdio: "ignore", windowsHide: true });
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

const VK = { F4: 0x73, F5: 0x74, Q: 0x51, CTRL: 0x11, ALT: 0x12, SHIFT: 0x10 };
/** a real key press (down, up) - the hotkeys of the program are system-wide, so they react to it */
export async function pressKey(name, mods = [], { holdMs = 0 } = {}) {
  for (const m of mods) keybd_event(VK[m], 0, 0, 0);
  keybd_event(VK[name], 0, 0, 0);
  await sleep(40);
  keybd_event(VK[name], 0, 2, 0);
  await sleep(holdMs); // (the modifiers stay down while the program reacts)
  for (const m of [...mods].reverse()) keybd_event(VK[m], 0, 2, 0);
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
