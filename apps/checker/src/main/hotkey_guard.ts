/**
 * A hotkey that is HELD down comes in again and again (the keyboard repeats it): F5 held for 9 seconds ran the whole F5 37 times and sent
 * Ctrl+Alt+C to the game each time. The guard lets one press through and ignores the repeats until the key has really been let go.
 * Free of Electron and of Windows: the key state, the timer and the log are given.
 *
 * "Let go" needs BOTH: a look at the key that finds it up (GetAsyncKeyState) AND no press of this hotkey for QUIET_MS. The second part is
 * there because the first alone let a repeat through (rc.13, a real keyboard: the second run came 9 ms after the popup of the first, and the
 * log showed the key had been taken for up while it was still held - a key that a hotkey has taken is not always reported down, and the
 * copy keys this program sends itself interrupt the keyboard's repeat for a moment). Every repeat that arrives renews the quiet time, so a held
 * key is "still held" for as long as it repeats; the first repeat comes after the keyboard's repeat delay (250-1000 ms, usually 500).
 *
 * The key is watched only AFTER the action has finished (`finished`): a Node timer made while the action runs (right in the hotkey callback)
 * made Windows refuse the keyboard focus to the F5 popup (the end-to-end tests: the popup stayed behind the text box).
 */
export interface GuardDeps {
  /** is the key down right now (GetAsyncKeyState) */
  isDown(vk: number): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  /** one line for the log (optional) */
  log?(line: string): void;
}

export const POLL_MS = 25;
/** no press of the hotkey for this long, and the key seen up: it is free again (covers the usual keyboard repeat delay of 500 ms) */
export const QUIET_MS = 700;
/** a key that is never seen up again (a lost key-up) frees the hotkey after this long */
export const MAX_HOLD_MS = 30_000;

interface Held { vk: number | null; since: number; lastEventAt: number; ignored: number; timer: unknown }

export class RepeatGuard {
  private held = new Map<string, Held>();

  constructor(private deps: GuardDeps) {}

  /** true = this press is a new one (do the action, then call `finished`); false = the key is still held from the press before (ignore) */
  accept(id: string, vk: number | null): boolean {
    const now = this.deps.now();
    const h = this.held.get(id);
    if (h) {
      h.ignored++;
      this.deps.log?.(`hotkey ${id}: repeat ignored (+${now - h.lastEventAt} ms since the last press, key ${this.state(h.vk)}, ${h.ignored} so far)`);
      h.lastEventAt = now;
      return false;
    }
    this.held.set(id, { vk, since: now, lastEventAt: now, ignored: 0, timer: null });
    this.deps.log?.(`hotkey ${id}: new press (key ${this.state(vk)})`);
    return true;
  }

  /** the action of the press that `accept` let through is over: now watch the key */
  finished(id: string): void {
    const h = this.held.get(id);
    if (!h || h.timer !== null) return;
    if (h.vk === null) { this.held.delete(id); return; } // (a key whose state cannot be read is not guarded)
    const vk = h.vk;
    const poll = (): void => {
      if (this.held.get(id) !== h) return;
      const now = this.deps.now();
      const up = !this.deps.isDown(vk);
      const quiet = now - h.lastEventAt >= QUIET_MS;
      if ((up && quiet) || now - h.since > MAX_HOLD_MS) {
        this.deps.log?.(`hotkey ${id}: free again (key ${up ? "up" : "still down"}, quiet ${now - h.lastEventAt} ms, held ${now - h.since} ms, ${h.ignored} repeats ignored)`);
        this.held.delete(id);
      } else h.timer = this.deps.setTimer(poll, POLL_MS);
    };
    poll();
  }

  private state(vk: number | null): string {
    if (vk === null) return "unknown";
    try { return this.deps.isDown(vk) ? "down" : "up"; } catch { return "unreadable"; }
  }

  /** forget everything (the hotkeys were registered again) */
  reset(): void {
    for (const h of this.held.values()) if (h.timer !== null) this.deps.clearTimer(h.timer);
    this.held.clear();
  }
}
