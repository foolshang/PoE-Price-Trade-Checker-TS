/**
 * A hotkey that is HELD down comes in again and again (the keyboard repeats it, about every 30-200 ms): F5 held for 9 seconds ran the whole
 * F5 37 times and sent Ctrl+Alt+C to the game each time. The guard lets one press through and ignores the repeats until the key has been let
 * go. Free of Electron and of Windows: the key state and the timer are given.
 *
 * The key is watched only AFTER the action has finished (`finished`): a Node timer that is created while the action runs (right in the
 * hotkey callback) made Windows refuse the keyboard focus to the F5 popup (found by the end-to-end tests: the popup stayed behind the text box).
 * Until then every repeat is ignored without looking at the key.
 */
export interface GuardDeps {
  /** is the key down right now (GetAsyncKeyState) */
  isDown(vk: number): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export const POLL_MS = 25;
/** a key that is never seen up again (a lost key-up) frees the hotkey after this long */
export const MAX_HOLD_MS = 30_000;

interface Held { vk: number | null; since: number; timer: unknown }

export class RepeatGuard {
  private held = new Map<string, Held>();

  constructor(private deps: GuardDeps) {}

  /** true = this press is a new one (do the action, then call `finished`); false = the key is still down from the press before (ignore) */
  accept(id: string, vk: number | null): boolean {
    if (this.held.has(id)) return false;
    this.held.set(id, { vk, since: this.deps.now(), timer: null });
    return true;
  }

  /** the action of the press that `accept` let through is over: now watch the key until it is up */
  finished(id: string): void {
    const h = this.held.get(id);
    if (!h || h.timer !== null) return;
    if (h.vk === null) { this.held.delete(id); return; } // (a key whose state cannot be read is not guarded)
    const vk = h.vk;
    const poll = (): void => {
      if (this.held.get(id) !== h) return;
      if (!this.deps.isDown(vk) || this.deps.now() - h.since > MAX_HOLD_MS) this.held.delete(id);
      else h.timer = this.deps.setTimer(poll, POLL_MS);
    };
    poll();
  }

  /** forget everything (the hotkeys were registered again) */
  reset(): void {
    for (const h of this.held.values()) if (h.timer !== null) this.deps.clearTimer(h.timer);
    this.held.clear();
  }
}
