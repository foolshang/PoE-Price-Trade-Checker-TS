# PoE2 item texts from Exiled-Exchange-2

The `*.txt` files here are the item texts (game data, as the game copies them with Ctrl+Alt+C) of the `TestItem` samples in

- repository: https://github.com/Kvan7/Exiled-Exchange-2 (MIT License, Copyright (c) 2020 Alexander Drozdov)
- file: `renderer/specs/Parser/items.ts`
- commit: `d95f53e11b40f0071491389834b9b54ca11b6288` (branch `dev`, read 2026-10-19)

Only the item texts were copied (one file per `export const <Name> = new TestItem(...)`, the file name is that name); none of the code of that
project is used. They are test data for `tests/parity/ee2_items.test.ts`: real PoE2 items with Sockets / Grants Skill / Note / Unidentified /
uncut gems / maps / charms, to check that nothing that is not a mod becomes a row of the F5 popup.

MIT License notice of the source repository: permission is granted, free of charge, to use, copy, modify and distribute the software and its
associated documentation files, subject to the inclusion of the copyright notice and this permission notice in all copies or substantial portions.
