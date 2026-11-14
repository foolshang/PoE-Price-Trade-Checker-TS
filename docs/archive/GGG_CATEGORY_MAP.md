# GGG trade items -> whitelist categories (implemented in `packages/core/src/ggg_names.ts`)

`universe()` (`packages/core/src/filter_whitelist.ts`) has a 4th source: the names of GGG's `trade/data/items` and `trade2/data/items`, only for names the
three sources before it (hub prices, NeverSink value ladders, NeverSink named lists) do not have. Order: hub -> NeverSink tier -> NeverSink category blocks -> GGG (last).
The name is GGG's string, character for character; a rule only decides the category.

## What GGG gives

`result[] = { id, label, entries[] }`; an entry is `{ type }` (the BaseType) and, for uniques, `{ name, type }`. The group is coarse and has no sub-category: the PoE1 `currency`
group holds Currency, Essence, Fossil, Oil, Fragment, nets, artifacts ...; the PoE2 `currency` group holds Rune, Essence, Currency, Soul Core, Omen ... So a name rule is needed inside a group.

## The gap, live data of 2026-11-14 (not fixtures)

Live GGG payloads (PoE1 7,908 names, PoE2 4,364), live hub prices (main league), NeverSink 8.21.0a (PoE1) / 0.10.4a (PoE2), strictness 2. Universe without GGG: PoE1 1,043, PoE2 690
(the proposal's fixture run had 1,246 / 690: the fixture NeverSink file was older). Not in the universe, `badName` names left out:

| game / group | fixture run (proposal) | live | what they are (live) |
|---|---|---|---|
| poe1 `currency` | 290 | **432** | added by rule 42 (Artifact 16, Delirium Orb 10, Fragment 10, Resonator 4, Essence 1, Scarab 1), added as NEW 17 (Scrying Orb x15, Allflame Ember x2, Royal Visage), old with no rule 373 (Blessings, shards, nets, sextants, incubators, tattoos, scrolls, Vials ...) |
| poe1 `card` | 13 | **26** | all Divination Cards, by rule |
| poe1 `map` | 331 | **672** | Scarab 192 and Fragment 40 by rule, NEW 1 added (Fragment: a Mercenary Warrant), maps / waystones / tablets 320 (not items of the lists), old with no rule 118, NEW not added 1 (`AbyssalTemplar`, an internal id) |
| poe2 `currency` | 81 | **80** | Omen 8, Artifact 4, Soul Core 1, Fragment 1 by rule; old with no rule 66 (Legacy of ..., Rogue's Marker ...); NEW 0 |
| poe2 `map` | 25 | **45** | Fragment 3 (Calamity) by rule; waystones / tablets 26; old with no rule 16 (Barya, ...) |

Added in total (names no other source has): PoE1 **318** (card 26, Scarab 193, Fragment 51, Artifact 16, DeliriumOrb 10, Resonator 4, Essence 1, Currency 17), PoE2 **17** (Omen 8, Artifact 4, Fragment 4, SoulCore 1).
The full lists of what is NOT added: `docs/GGG_UNMATCHED_NAMES.md`.

## The table (group + name rule -> category). Everything else is not added, unless it is a NEW name (below)

| game | GGG group | name rule | category |
|---|---|---|---|
| poe1 | `card` | any | DivinationCard |
| poe1 | `currency`, `map` | contains the word `Scarab` | Scarab |
| poe1 | `currency`, `map` | starts `Splinter of`; ends ` Splinter`, `Breachstone`, `Emblem`, `Reliquary Key`, `'s Key`, ` Fragment`; starts `Sacrifice at` / `Mortal ` | Fragment |
| poe1 | `currency` | ends ` Oil` / ` Fossil` / ` Resonator` | Oil / Fossil / Resonator |
| poe1 | `currency` | contains `Essence of`, or exactly `Remnant of Corruption` | Essence |
| poe1 | `currency` | ends ` Delirium Orb` (or is `Delirium Orb`) | DeliriumOrb |
| poe1 | `currency` | ends ` Artifact` | Artifact |
| poe2 | `currency` | starts `Omen of` / `Soul Core`; ends ` Rune` or starts `Rune of`; `Essence` as a word or `Essence of`; ends ` Artifact` / `Catalyst` | Omen / SoulCore / Rune / Essence / Artifact / Catalyst |
| poe2 | `currency`, `map` | ends `Calamity Fragment`, contains `Reliquary Key` | Fragment |
| both | any | `badName()` ([DNT], INCOMPLETE, "not visible to players", ...) | never |

Not whitelist items, never added: gear, gems, jewels, flasks, monsters, heist, leaguestones, charts, tinctures, idols, corpses, grafts, wombgifts ... (groups the table does not name).
A rule gives a category only when it is a whitelist category of the game (`WHITELIST_CATEGORIES`): PoE1 has no Omen category, so `Omen of ...` of PoE1 gets no rule.
The rules were checked against the live hub: the 615 PoE1 / 242 PoE2 names that a rule and the first three sources both place agree, except 12 names NeverSink lists as plain currency (the first three sources win).

## Names no rule fits: old and new

- **Old** (in the snapshot shipped with the app, the baseline): not added.
- **New** (GGG has it live, the baseline does not): added to the main category of its group: PoE1 `currency` -> Currency, `card` -> DivinationCard, `map` -> Fragment; PoE2 `currency` -> Currency, `map` -> Fragment.
  Never for: a `map` name that is a map / waystone / tablet (`Map` as a word, `Waystone...`, `...Tablet`), an internal id (one word with an inner capital: `AbyssalTemplar`, `Crit1HShadowPhysSpell`), a `badName`.
- The snapshot **remembers** a new name's category (`assigned`): the next `names:refresh` keeps it (while GGG still has the name), so it does not vanish when the snapshot includes it.

## Snapshot and caches

- `apps/web/public/data/trade_names_<game>.json` (shipped by the web page and by both desktop apps) is format 2: `{ "format": 2, "groups": { <group>: [names] }, "assigned": { <name>: <category> } }`.
  The old form (a bare list of names) is still read: it gives the names for the real-name check, adds nothing, and is replaced by the next `names:refresh`.
- Desktop (`%LOCALAPPDATA%\...\cache\trade_items_<game>.json`, 7 days): written in format 2 (groups from GGG's payload, `assigned` empty). An old-form cache (names only) is used for the check until it is due, then replaced; it is never deleted when GGG cannot be reached.
  The baseline for "new" is always the shipped snapshot: live groups + shipped snapshot -> `addedNames()`. With no shipped snapshot only the rules apply; a shipped snapshot of the old form adds nothing.
- `names:refresh` keeps the rule "do not write a list that shrank by more than 20%" (counted on the union of names) and prints the names it newly assigned.
- The second name check (NeverSink names ∪ GGG names ∪ names of the lists) is unchanged; the names added from GGG are also passed to it explicitly, so every added name passes it.
- Golden / parity runs pass no GGG input (`gggAdded` is optional): output is the same as before.

## Tier and the filter text

- Start tier follows NeverSink only. A name only GGG has has no NeverSink tier: the Whitelist tab lists it with tier **D** (not shown) and **it is not written to the filter** until the player gives it a tier:
  an item tier, or a tier for its whole category (the category button sets every row of the category, GGG names included; a name the player set D is written as a hidden name).
- A filter made with untouched settings is therefore the same as before this change. A category tier (for example Scarab = A) now also covers the names GGG added (more lines in the filter).
- Generate logs (whitelist mode, only when GGG names were given): `ℹ ชื่อจาก GGG ที่เติมในรายการ <added> ชื่อ · เขียนลง filter <written> ชื่อ (<category> <n>, ...) · <unset> ชื่อยังไม่ได้ตั้ง tier (ไม่เขียน)`.
