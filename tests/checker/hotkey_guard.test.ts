import { describe, expect, it } from "vitest";
import { hotkeyVk } from "../../apps/checker/src/main/hotkeys.ts";
import { MAX_HOLD_MS, POLL_MS, QUIET_MS, RepeatGuard } from "../../apps/checker/src/main/hotkey_guard.ts";

/** a clock and a timer the test drives by hand */
function rig() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const down = new Set<number>();
  const guard = new RepeatGuard({
    isDown: (vk) => down.has(vk),
    setTimer: (fn, ms) => { const t = { at: now + ms, fn, id: nextId++ }; timers.push(t); return t.id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    now: () => now,
  });
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  return { guard, down, advance, timers };
}

describe("a held hotkey runs once", () => {
  it("while the action runs and while the key is still down the repeats are refused; after the key goes up (and it is quiet) the next press runs", () => {
    const { guard, down, advance } = rig();
    const F5 = 0x74;
    down.add(F5);
    expect(guard.accept("trade", F5)).toBe(true);
    for (let i = 0; i < 5; i++) { advance(100); expect(guard.accept("trade", F5), `repeat while the action runs ${i}`).toBe(false); }
    guard.finished("trade"); // the action is over: the key is watched from now on
    for (let i = 0; i < 40; i++) { advance(200); expect(guard.accept("trade", F5), `repeat ${i}`).toBe(false); } // 8 seconds of repeats
    down.delete(F5);
    advance(QUIET_MS + POLL_MS + 1);
    expect(guard.accept("trade", F5)).toBe(true);
  });

  it("the real case of rc.13: the key is taken for UP at the end of the action while it is still held, and a repeat comes 9 ms later - it is refused", () => {
    const { guard, down, advance } = rig();
    const F5 = 0x74;
    expect(guard.accept("trade", F5)).toBe(true); // (the state of the key is NOT down: a hotkey took it)
    advance(366); // the action: 366 ms
    guard.finished("trade"); // looks at the key: "up" - but the last press was only 366 ms ago
    advance(9);
    expect(guard.accept("trade", F5), "the repeat 9 ms after the action").toBe(false);
    for (let i = 0; i < 20; i++) { advance(150); expect(guard.accept("trade", F5), `later repeat ${i}`).toBe(false); } // each repeat renews the quiet time
    advance(QUIET_MS + POLL_MS + 1); // the repeats stop (the key is up)
    expect(guard.accept("trade", F5)).toBe(true);
    void down;
  });

  it("a repeat that comes just as the action ends, from either side, is refused; so is one right after the key was seen up", () => {
    const { guard, down, advance } = rig();
    const F5 = 0x74;
    down.add(F5);
    expect(guard.accept("trade", F5)).toBe(true);
    advance(300);
    guard.finished("trade");
    expect(guard.accept("trade", F5)).toBe(false); // (the same moment)
    down.delete(F5);
    advance(POLL_MS * 2); // seen up, but the last repeat was a moment ago
    expect(guard.accept("trade", F5)).toBe(false);
  });

  it("a tap is free again after the quiet time; another hotkey is not affected", () => {
    const { guard, down, advance } = rig();
    down.add(0x74);
    expect(guard.accept("trade", 0x74)).toBe(true);
    expect(guard.accept("scan", 0x73)).toBe(true); // F4 while F5 is held
    down.clear();
    advance(300); // (the action took 300 ms; the key was up long before)
    guard.finished("trade");
    expect(guard.accept("trade", 0x74), "not yet: the quiet time").toBe(false);
    advance(QUIET_MS + POLL_MS + 1);
    expect(guard.accept("trade", 0x74)).toBe(true);
  });

  it("nothing is watched while the action runs (no timer is made in the hotkey callback)", () => {
    const { guard, timers } = rig();
    expect(guard.accept("trade", 0x74)).toBe(true);
    expect(timers.length).toBe(0);
  });

  it("a lost key-up frees the hotkey after a while; an unknown key is not guarded; reset forgets", () => {
    const { guard, down, advance } = rig();
    down.add(0x74);
    expect(guard.accept("trade", 0x74)).toBe(true);
    guard.finished("trade");
    expect(guard.accept("trade", 0x74)).toBe(false);
    advance(MAX_HOLD_MS + POLL_MS * 2);
    expect(guard.accept("trade", 0x74)).toBe(true);
    expect(guard.accept("x", null)).toBe(true);
    guard.finished("x");
    expect(guard.accept("x", null)).toBe(true);
    guard.reset();
    expect(guard.accept("trade", 0x74)).toBe(true);
  });

  it("every press and every decision is in the log: the state of the key, the time since the last press, how many repeats were ignored", () => {
    const lines: string[] = [];
    const down = new Set<number>([0x74]);
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    const guard = new RepeatGuard({
      isDown: (vk) => down.has(vk), setTimer: (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; }, clearTimer: () => {}, now: () => now, log: (l) => lines.push(l),
    });
    guard.accept("trade", 0x74);
    now = 200; guard.accept("trade", 0x74);
    now = 400; guard.finished("trade");
    down.clear();
    now = 400 + QUIET_MS + 10;
    for (const t of timers.splice(0)) t.fn();
    expect(lines).toEqual([
      "hotkey trade: new press (key down)",
      "hotkey trade: repeat ignored (+200 ms since the last press, key down, 1 so far)",
      `hotkey trade: free again (key up, quiet ${400 + QUIET_MS + 10 - 200} ms, held ${400 + QUIET_MS + 10} ms, 1 repeats ignored)`,
    ]);
  });
});

describe("the virtual key of a hotkey", () => {
  it.each([["F4", 0x73], ["F5", 0x74], ["F8", 0x77], ["F24", 0x87], ["Q", 0x51], ["5", 0x35], ["Insert", 0x2d], ["PageDown", 0x22], ["Esc", 0x1b], ["Space", 0x20]])("%s", (key, vk) => {
    expect(hotkeyVk(key)).toBe(vk);
  });
  it("an unknown key has none", () => {
    expect(hotkeyVk("Nope")).toBeNull();
  });
});
