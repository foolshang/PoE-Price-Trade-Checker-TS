/**
 * The few Win32 calls F5 needs, through koffi (no native build step): SendInput for Ctrl+C, and the check whether the window in
 * front runs with more rights than this program (Windows then drops our keystrokes: UIPI).
 */
import koffi from "koffi";

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_CONTROL = 0x11;
const VK_C = 0x43;
const ERROR_ACCESS_DENIED = 5;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TOKEN_ELEVATION = 20; // TokenElevation

interface Api {
  SendInput(n: number, inputs: unknown[], size: number): number;
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
  /** how many of the 4 key events Windows accepted */
  sent: number;
  /** true when Windows refused because the target runs with more rights (UIPI) */
  blocked: boolean;
}

/** Ctrl down, C down, C up, Ctrl up - the same four events the original sent with keybd_event. */
export function sendCtrlC(): SendResult {
  const a = load();
  const events = [key(VK_CONTROL, false), key(VK_C, false), key(VK_C, true), key(VK_CONTROL, true)];
  const sent = a.SendInput(events.length, events, inputSize);
  const err = sent < events.length ? koffi.errno() : 0;
  return { sent, blocked: sent < events.length && err === ERROR_ACCESS_DENIED };
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
