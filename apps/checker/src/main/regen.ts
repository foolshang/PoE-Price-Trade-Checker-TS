/**
 * The NeverSink update check (the original's _poll_neversink_update): 45 seconds after the start, then every 6 hours. When the tier
 * filter of this game was built from an older NeverSink release and the player asked for it (`auto_regen_neversink`), it is generated
 * again; either way the player is told - in the Status, in the tray and over the game (a fullscreen game hides the tray balloon).
 * The generate itself is the filter page's own (sounds, game folder, byte-identical filter), asked by `regenerate`.
 */
import type { filterService } from "@poe/core";

export const FIRST_CHECK_MS = 45_000;
export const CHECK_EVERY_MS = 6 * 3600 * 1000;

export interface WatcherDeps {
  game: () => string;
  /** null = nothing to do */
  check: (game: string) => Promise<{ old: string; new: string; auto: boolean } | null>;
  /** generate the tier filter again (the newest base); true = a filter was written */
  regenerate: () => Promise<boolean>;
  message: typeof filterService.neversinkUpdateMessage;
  notify: (message: string, regenerated: boolean) => void;
  debug: (text: string) => void;
  warn: (text: string) => void;
}

export class NeverSinkWatcher {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running: Promise<void> | null = null;

  constructor(private readonly d: WatcherDeps, private readonly firstMs = FIRST_CHECK_MS, private readonly everyMs = CHECK_EVERY_MS) {}

  start(): void {
    this.stopped = false;
    this.arm(this.firstMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runOnce(), ms);
    this.timer.unref?.();
  }

  /** One check now (the timer calls this; so do the tests). Never throws; the next check is always scheduled. */
  runOnce(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const gv = this.d.game();
        const info = await this.d.check(gv);
        if (info) {
          const regenerated = info.auto ? await this.d.regenerate() : false;
          this.d.debug(`neversink update gv=${gv} ${info.old} -> ${info.new} regenerated=${regenerated}`);
          this.d.notify(this.d.message(info, regenerated), regenerated);
        }
      } catch (e) {
        this.d.warn(`NeverSink update check failed: ${(e as Error).stack ?? e}`);
      } finally {
        this.running = null;
        this.arm(this.everyMs);
      }
    })();
    return this.running;
  }
}
