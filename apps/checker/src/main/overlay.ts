/**
 * The message over the game (the original's PriceOverlay.show_message, used for the NeverSink-update notice): Windows hides the tray
 * balloon over a fullscreen game, a window of our own on top of it is the channel that gets through. It must never disturb the game:
 * transparent, takes no clicks (setIgnoreMouseEvents), cannot be focused (focusable: false), shown without activating it.
 * Where: the bottom right of the main screen, 640 px from the right edge and 80 px from the bottom, like the original.
 */
import { BrowserWindow, screen } from "electron";

export const OK_COLOR = "#88DD88";
export const WARN_COLOR = "#DDCC66";
const SHOW_MS = 8000;

export class MessageOverlay {
  private win: BrowserWindow | null = null;
  private token = 0;
  private pendingShow: { text: string; color: string; ms: number } | null = null;
  private loaded: Promise<void> | null = null;
  private ms = SHOW_MS;

  constructor(private readonly o: { preload: string; url: string; iconPath?: string; log: (m: string) => void }) {}

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: 640, height: 28, x: 0, y: 0, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
      title: "PoE Checker overlay", icon: this.o.iconPath,
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: false },
    });
    win.setAlwaysOnTop(true, "screen-saver"); // above a borderless game window too
    win.setIgnoreMouseEvents(true); // every click goes to the game below
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    this.loaded = win.loadURL(this.o.url).then(() => undefined, (e) => this.o.log(`overlay page failed to load: ${(e as Error).message}`));
    return win;
  }

  /** Show `text` for `ms` (default 8 s); a newer message replaces it. */
  async show(text: string, color: string, ms = SHOW_MS): Promise<void> {
    const token = ++this.token;
    this.ms = ms;
    if (!this.window) this.win = this.create();
    const win = this.win!;
    await this.loaded;
    if (token !== this.token || win.isDestroyed()) return;
    this.pendingShow = { text, color, ms };
    win.webContents.send("overlay:show", text, color);
  }

  /** The page drew the label: size the window to it, put it at the bottom right and show it without taking the focus. */
  onReady(size: { width: number; height: number }): void {
    const win = this.window;
    const p = this.pendingShow;
    if (!win || !p || !(size.width > 0) || !(size.height > 0)) return;
    const token = this.token;
    const disp = screen.getPrimaryDisplay();
    const scale = disp.scaleFactor || 1;
    const w = Math.ceil(size.width) + 2;
    const h = Math.ceil(size.height) + 2;
    // 640 px from the right edge (physical pixels in the original), 80 px up from the bottom; shifted left when the text is longer
    const x = Math.max(disp.bounds.x, disp.bounds.x + Math.min(disp.bounds.width - Math.round(640 / scale), disp.bounds.width - w - 8));
    const y = disp.bounds.y + disp.bounds.height - Math.round(80 / scale) - Math.floor(h / 2);
    win.setBounds({ x, y, width: w, height: h });
    win.showInactive();
    win.setAlwaysOnTop(true, "screen-saver");
    this.pendingShow = null;
    setTimeout(() => {
      if (token === this.token) this.hide();
    }, p.ms).unref?.();
  }

  hide(): void {
    this.token++;
    const win = this.window;
    if (win?.isVisible()) win.hide();
  }

  destroy(): void {
    this.token++;
    const win = this.window;
    this.win = null;
    if (win) win.destroy();
  }
}
