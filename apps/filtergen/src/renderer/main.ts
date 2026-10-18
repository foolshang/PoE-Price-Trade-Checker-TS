/** The renderer of the Filter Generator: the filter page (packages/ui) with the desktop platform of @poe/desktop. */
import { runFilterPage } from "@poe/desktop/page";
import changelog from "../../CHANGELOG.md?raw";

void runFilterPage({
  title: "PoE1 & PoE2 Filter Generator (TypeScript)", shortName: "PoE Filter Generator", checkNeverSinkAtStart: true,
  about: { name: "PoE1 & PoE2 Filter Generator (TypeScript)", changelog, repoUrl: "https://github.com/foolshang/PoE-Filter-Generator", trayOption: true },
});
