/**
 * The tray icon (the original's tray.py), for both programs: a menu given by the app, a red dot on the icon while something new waits,
 * and a balloon that Windows may hide over a fullscreen game. start() says whether the icon exists - when it does not, the program
 * must not hide its window (there would be no way back).
 */
import { Menu, Tray, nativeImage } from "electron";
import type { NativeImage } from "electron";

/** a menu line, or "-" for a separator */
export type TrayItem = { label: string; click: () => void } | "-";

export interface TrayOptions {
  items: TrayItem[];
  /** a click on the icon */
  onClick(): void;
  iconPath(): string | undefined;
  tip: string;
  /** an environment variable that, set to "1", makes the icon fail (tests) */
  disableEnv: string;
}

/** a red dot with a dark edge, 16 x 16: the overlay icon on the taskbar button (the "something new" mark) */
export function dotIcon(): NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > 7.2) continue;
      const col = d > 5.6 ? EDGE : BADGE;
      const i = (y * size + x) * 4;
      buf[i] = col.b;
      buf[i + 1] = col.g;
      buf[i + 2] = col.r;
      buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
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

  constructor(private readonly o: TrayOptions) {}

  /** false when the icon could not be made (never throws). The environment variable of the options forces that, for tests. */
  start(): boolean {
    try {
      if (process.env[this.o.disableEnv] === "1") throw new Error(`disabled by ${this.o.disableEnv}`);
      const file = this.o.iconPath();
      if (!file) throw new Error("no icon file");
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) throw new Error("icon file could not be read");
      this.normal = img;
      this.pending = withBadge(img);
      this.tray = new Tray(img);
      this.tray.setToolTip(this.o.tip);
      this.tray.setContextMenu(Menu.buildFromTemplate(this.o.items.map((i) => (i === "-" ? { type: "separator" as const } : { label: i.label, click: i.click }))));
      this.tray.on("click", () => this.o.onClick());
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
