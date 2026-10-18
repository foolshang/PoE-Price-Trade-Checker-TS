/**
 * The few Win32 calls F5 needs, through koffi (no native build step): SendInput for the copy chord (Ctrl [+ the advanced key] + C), which
 * keys are held down right now, and the check whether the window in front runs with more rights than this program (Windows then drops
 * our keystrokes: UIPI).
 */
import koffi from "koffi";

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_C = 0x43;
const MODIFIERS = [0x10, 0x11, 0x12, 0x5b, 0x5c]; // Shift, Ctrl, Alt, left / right Win
const RELEASE_DELAY_MS = 10; // the modifiers are let go a little after C: the game has been seen to drop a release that comes at once
const ERROR_ACCESS_DENIED = 5;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TOKEN_ELEVATION = 20; // TokenElevation

interface Api {
  SendInput(n: number, inputs: unknown[], size: number): number;
  GetAsyncKeyState(vk: number): number;
  GetForegroundWindow(): unknown;
  GetWindowThreadProcessId(hwnd: unknown, pid: Buffer): number;
  OpenProcess(access: number, inherit: boolean, pid: number): unknown;
  OpenProcessToken(proc: unknown, access: number, out: unknown[]): boolean;
  GetTokenInformation(token: unknown, cls: number, buf: Buffer, len: number, ret: Buffer): boolean;
  GetCurrentProcess(): unknown;
  CloseHandle(h: unknown): boolean;
}

let api: Api | null = null;
let inputSize = 0;

function load(): Api {
  if (api) return api;
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const KEYBDINPUT = koffi.struct("KEYBDINPUT", { wVk: "uint16", wScan: "uint16", dwFlags: "uint32", time: "uint32", dwExtraInfo: "uintptr_t" });
  // INPUT = { DWORD type; union { MOUSEINPUT (32 bytes on x64) | KEYBDINPUT | HARDWAREINPUT } }: 40 bytes
  const INPUT = koffi.struct("INPUT", { type: "uint32", ki: KEYBDINPUT, pad: koffi.array("uint8", 8) });
  inputSize = koffi.sizeof(INPUT);
  const HANDLE = koffi.pointer("HANDLE", koffi.opaque());
  api = {
    SendInput: user32.func("uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)") as Api["SendInput"],
    GetAsyncKeyState: user32.func("int16 __stdcall GetAsyncKeyState(int vk)") as Api["GetAsyncKeyState"],
    GetForegroundWindow: user32.func("HANDLE __stdcall GetForegroundWindow()") as Api["GetForegroundWindow"],
    GetWindowThreadProcessId: user32.func("uint32 __stdcall GetWindowThreadProcessId(HANDLE hwnd, _Out_ uint32 *pid)") as unknown as Api["GetWindowThreadProcessId"],
    OpenProcess: kernel32.func("HANDLE __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)") as Api["OpenProcess"],
    OpenProcessToken: advapi32.func("bool __stdcall OpenProcessToken(HANDLE proc, uint32 access, _Out_ HANDLE *token)") as unknown as Api["OpenProcessToken"],
    GetTokenInformation: advapi32.func("bool __stdcall GetTokenInformation(HANDLE token, int cls, _Out_ uint8_t *buf, uint32 len, _Out_ uint32 *ret)") as unknown as Api["GetTokenInformation"],
    GetCurrentProcess: kernel32.func("HANDLE __stdcall GetCurrentProcess()") as Api["GetCurrentProcess"],
    CloseHandle: kernel32.func("bool __stdcall CloseHandle(HANDLE h)") as Api["CloseHandle"],
  };
  void HANDLE;
  return api;
}

const key = (vk: number, up: boolean) => ({
  type: INPUT_KEYBOARD, ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 }, pad: new Array(8).fill(0),
});

export interface SendResult {
  /** how many key events Windows accepted of how many were sent */
  sent: number;
  total: number;
  /** true when Windows refused because the target runs with more rights (UIPI) */
  blocked: boolean;
}

/** The modifier keys that are physically down right now (virtual-key codes). */
export function heldModifiers(): number[] {
  const a = load();
  return MODIFIERS.filter((vk) => a.GetAsyncKeyState(vk) < 0);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Press `chord` (virtual-key codes, in order) together with C: chord down, C down, C up, a short wait, chord up in reverse.
 *  - a chord key the player is already holding (the hotkey was pressed with it) is not pressed or released again;
 *  - another modifier the player is holding (Shift in Shift+F5) is released first, so the game does not see Shift+Ctrl+C.
 */
export async function sendCopyChord(chord: number[]): Promise<SendResult> {
  const a = load();
  const held = new Set(heldModifiers());
  const stray = [...held].filter((vk) => !chord.includes(vk));
  const press = chord.filter((vk) => !held.has(vk));
  let sent = 0, total = 0, denied = false;
  const run = (events: ReturnType<typeof key>[]): void => {
    if (!events.length) return;
    const n = a.SendInput(events.length, events, inputSize);
    sent += n;
    total += events.length;
    if (n < events.length && koffi.errno() === ERROR_ACCESS_DENIED) denied = true;
  };
  run([...stray.map((vk) => key(vk, true)), ...press.map((vk) => key(vk, false)), key(VK_C, false), key(VK_C, true)]);
  await sleep(RELEASE_DELAY_MS);
  run([...press].reverse().map((vk) => key(vk, true)));
  return { sent, total, blocked: sent < total && denied };
}

export interface WindowFacts {
  visible: boolean;
  minimized: boolean;
  /** title of the window that has the keyboard focus now ("" = none / another program's without a title) */
  foreground: string;
  /** visible windows above this one in the z-order that overlap it (titles), nearest first */
  covering: string[];
}

let facts: { fg: () => bigint; visible: (h: bigint) => boolean; iconic: (h: bigint) => boolean; prev: (h: bigint, cmd: number) => bigint; title: (h: bigint, buf: Uint16Array, n: number) => number; rect: (h: bigint, r: number[]) => boolean; cloaked: (h: bigint, attr: number, out: number[], size: number) => number; isWindow: (h: bigint) => boolean; setForeground: (h: bigint) => boolean } | null = null;

/** What Windows itself says about one of our windows (`hwnd` = BrowserWindow.getNativeWindowHandle()): shown? covered by what? who has the focus? */
function loadFacts(): NonNullable<typeof facts> {
  if (!facts) {
    const user32 = koffi.load("user32.dll");
    facts = {
      fg: user32.func("uintptr_t __stdcall GetForegroundWindow()") as never,
      visible: user32.func("bool __stdcall IsWindowVisible(uintptr_t h)") as never,
      iconic: user32.func("bool __stdcall IsIconic(uintptr_t h)") as never,
      prev: user32.func("uintptr_t __stdcall GetWindow(uintptr_t h, uint32 cmd)") as never,
      title: user32.func("int __stdcall GetWindowTextW(uintptr_t h, _Out_ uint16_t *buf, int n)") as never,
      rect: user32.func("bool __stdcall GetWindowRect(uintptr_t h, _Out_ int32_t *r)") as never,
      isWindow: user32.func("bool __stdcall IsWindow(uintptr_t h)") as never,
      setForeground: user32.func("bool __stdcall SetForegroundWindow(uintptr_t h)") as never,
      cloaked: koffi.load("dwmapi.dll").func("int __stdcall DwmGetWindowAttribute(uintptr_t h, uint32 attr, _Out_ uint32_t *v, uint32 size)") as never,
    };
  }
  return facts;
}

/** The window that has the keyboard focus right now (0n = none). */
export function foregroundWindow(): bigint {
  return loadFacts().fg();
}

/** Give the keyboard focus back to `h` (a window of another program, remembered earlier); false when it is gone or Windows refuses. */
export function focusWindow(h: bigint): boolean {
  const f = loadFacts();
  return !!h && !!f.isWindow(h) && !!f.setForeground(h);
}

export function windowFacts(hwndBuf: Buffer): WindowFacts {
  const f = loadFacts();
  const h = hwndBuf.readBigUInt64LE(0);
  const titleOf = (w: bigint): string => {
    const b = new Uint16Array(128);
    const n = f.title(w, b, 128);
    return String.fromCharCode(...b.slice(0, n));
  };
  const rectOf = (w: bigint): number[] => {
    const r = [0, 0, 0, 0];
    f.rect(w, r);
    return r;
  };
  const isCloaked = (w: bigint): boolean => {
    const out = [0];
    return f.cloaked(w, 14, out, 4) === 0 && out[0] !== 0; // DWMWA_CLOAKED
  };
  const mine = rectOf(h);
  const covering: string[] = [];
  let w = f.prev(h, 3); // GW_HWNDPREV: the window above
  for (let i = 0; w && i < 400 && covering.length < 6; i++, w = f.prev(w, 3)) {
    if (!f.visible(w) || isCloaked(w)) continue; // (Windows keeps cloaked shell windows - Start, hidden UWP apps - "visible" in the list)
    const r = rectOf(w);
    const overlaps = r[0] < mine[2] && r[2] > mine[0] && r[1] < mine[3] && r[3] > mine[1];
    if (overlaps && r[2] > r[0] && r[3] > r[1]) covering.push(titleOf(w) || "(no title)");
  }
  return { visible: !!f.visible(h), minimized: !!f.iconic(h), foreground: titleOf(f.fg()), covering };
}

function elevationOf(proc: unknown): boolean | null {
  const a = load();
  const token = [null as unknown];
  if (!a.OpenProcessToken(proc, TOKEN_QUERY, token)) return null;
  try {
    const buf = Buffer.alloc(4);
    const ret = Buffer.alloc(4);
    if (!a.GetTokenInformation(token[0], TOKEN_ELEVATION, buf, 4, ret)) return null;
    return buf.readUInt32LE(0) !== 0;
  } finally {
    a.CloseHandle(token[0]);
  }
}

/** Is this program running elevated (Administrator)? null = could not tell. */
export function selfElevated(): boolean | null {
  return elevationOf(load().GetCurrentProcess());
}

/** Does the window in front run elevated? null = could not tell (no window, or Windows would not say). */
export function foregroundElevated(): boolean | null {
  const a = load();
  const hwnd = a.GetForegroundWindow();
  if (!hwnd) return null;
  const pid = [0];
  a.GetWindowThreadProcessId(hwnd, pid as unknown as Buffer);
  if (!pid[0]) return null;
  const proc = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
  if (!proc) return null;
  try {
    return elevationOf(proc);
  } finally {
    a.CloseHandle(proc);
  }
}
