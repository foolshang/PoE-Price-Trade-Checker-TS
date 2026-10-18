/**
 * The tray icon (the original's tray.py): Show / Generate Now / Settings / Quit, a red dot on the icon while a message waits, and a
 * balloon that Windows may hide over a fullscreen game (so the message over the game is the channel that counts).
 * start() says whether the icon exists - when it does not, the program must not hide its window (there would be no way back).
 */
import { Menu, Tray, nativeImage } from "electron";
import type { NativeImage } from "electron";

export interface TrayHandlers {
  onShow(): void;
  onGenerate(): void;
  onSettings(): void;
  onQuit(): void;
}

const BADGE = { r: 220, g: 60, b: 60 };
const EDGE = { r: 20, g: 20, b: 20 };

/** `base` with a red dot at the bottom right (the "pending" look of the original). */
export function withBadge(base: NativeImage): NativeImage {
  const size = 32;
  const img = base.resize({ width: size, height: size });
  const buf = Buffer.from(img.toBitmap()); // BGRA
  const r = size * 0.22;
  const cx = size - r * 0.9;
  const cy = size * 0.9;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const c = d > r - 1.5 ? EDGE : BADGE;
      const i = (y * size + x) * 4;
      buf[i] = c.b;
      buf[i + 1] = c.g;
      buf[i + 2] = c.r;
      buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export class TrayIcon {
  private tray: Tray | null = null;
  private normal: NativeImage | null = null;
  private pending: NativeImage | null = null;

  constructor(private readonly h: TrayHandlers, private readonly iconPath: () => string | undefined, private readonly tip: string) {}

  /** false when the icon could not be made (never throws). `POE_CHECKER_NO_TRAY=1` forces that, for tests. */
  start(): boolean {
    try {
      if (process.env.POE_CHECKER_NO_TRAY === "1") throw new Error("disabled by POE_CHECKER_NO_TRAY");
      const file = this.iconPath();
      if (!file) throw new Error("no icon file");
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) throw new Error("icon file could not be read");
      this.normal = img;
      this.pending = withBadge(img);
      this.tray = new Tray(img);
      this.tray.setToolTip(this.tip);
      this.tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Show", click: () => this.h.onShow() },
        { label: "Generate Now", click: () => this.h.onGenerate() },
        { label: "Settings", click: () => this.h.onSettings() },
        { type: "separator" },
        { label: "Quit", click: () => this.h.onQuit() },
      ]));
      this.tray.on("click", () => this.h.onShow());
      return true;
    } catch (e) {
      this.tray?.destroy();
      this.tray = null;
      this.lastError = (e as Error).message;
      return false;
    }
  }

  lastError = "";
  /** the red dot is on (a message waits) */
  pendingState = false;

  get ok(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  stop(): void {
    try {
      this.tray?.destroy();
    } catch { /* closing anyway */ }
    this.tray = null;
  }

  setPending(on: boolean): void {
    this.pendingState = on;
    try {
      if (this.ok) this.tray!.setImage(on ? this.pending! : this.normal!);
    } catch { /* the badge is a nicety */ }
  }

  /** Best effort (Windows hides it under Focus Assist / over a fullscreen game). */
  notify(title: string, message: string): void {
    try {
      if (this.ok) this.tray!.displayBalloon({ title, content: message, iconType: "info" });
    } catch { /* never raises */ }
  }
}
