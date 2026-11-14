/**
 * Economy Filter Generator - where the game's filter folder is: Documents/My Games resolution. The folder of the Documents library is given
 * by the caller (Electron: `app.getPath("documents")`, which honours OneDrive redirection like SHGetKnownFolderPath did); the file system is a port.
 * (Port of the part of poe_price_trade/filter_output.py the programs use. Writing the filter and copying the sounds happen in the page's delivery,
 * packages/ui/src/files.ts writeToFolder through the desktop host; the original's write_filter() / copy_sounds() are not here.)
 */
import { FsPort } from "./ports.ts";

/** The game's filter folder: the override when set, else <Documents>\My Games\Path of Exile[ 2]. */
export function gameFilterDir(fs: FsPort, documentsDir: string, game: string, override = ""): string {
  if (override) return override;
  const sub = game === "poe2" ? "Path of Exile 2" : "Path of Exile";
  return fs.join(documentsDir, "My Games", sub);
}
