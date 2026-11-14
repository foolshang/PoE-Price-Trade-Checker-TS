# GGG trade items -> whitelist categories (proposal, nothing implemented yet)

Goal: `universe()` (`packages/core/src/filter_whitelist.ts`) gets a 4th source - the names of GGG's `trade/data/items` and `trade2/data/items` - only for
names the three sources (hub prices, NeverSink value ladders, NeverSink named lists) do not have, so the lists do not depend on somebody selling the item.

## What GGG gives (fixtures `tests/parity/fixtures/gitems_*.json.gz`, the real payloads)

`result[] = { id, label, entries[] }`; an entry is `{ type }` (the BaseType) and, for uniques, `{ name, type }`. **The group is coarse and has no sub-category**:
the PoE1 `currency` group (769 types) holds Currency, Essence, Fossil, Oil, Fragment, Scarab-like items, nets, artifacts ...; the PoE2 `currency` group (616)
holds Rune, Essence, Currency, Soul Core, Omen ... So a group cannot be mapped to one category; a name rule is needed inside the group.

Observed (types of a group that the hub already knows, by the hub's category):

| game / GGG group | types | hub category of the types (count) | not in the hub |
|---|---|---|---|
| poe1 `currency` | 769 | Essence 100, Currency 91, Fossil 17, Oil 16, Fragment 8 | 521 |
| poe1 `card` | 467 | DivinationCard 219 | 248 |
| poe1 `map` | 519 | Fragment 44, Map 3 | 472 |
| poe1 `gem` / `weapon` / `armour` / `accessory` / `jewel` / `flask` | - | SkillGem / BaseType (not whitelist categories) | - |
| poe1 `leaguestone` `monster` `heistequipment` `heistmission` `logbook` `sanctum` `tincture` `corpse` `idol` `graft` `wombgift` `enshrouded` `chart` | - | none in the hub (named lists or not whitelist items) | all |
| poe2 `currency` | 616 | Rune 146, Essence 82, Currency 53, Soul Core 50, Omen 37 | 93 |
| poe2 `gem` | 905 | LineageGem 75, UncutGem 42 | 785 (skill / support gems) |
| poe2 `map` | 63 | Fragment 15, PrecursorTablet 8, Omen 2, Expedition 1, Catalyst 1 | 26 |
| poe2 `accessory` `armour` `weapon` `flask` `jewel` `sanctum` `wombgift` | - | none are whitelist categories | - |

## What is still missing from the universe today (live hub + NeverSink fixtures), in the groups that hold whitelist categories

| group | not in the universe | by name rule |
|---|---|---|
| poe1 `currency` | 290 | no rule 209 (Blessings of the Breach lords, crab claws ...), Orb/Shard-like 34 (Delirium Orb kinds, Exalted Shard), Artifact 16, Net 11, Splinter 8, Omen 4, Resonator 4, Sextant/Compass 3, Incubator 1 |
| poe1 `map` | 331 | Maps 231 (not whitelist items), Scarab 65, Key / Breachstone / Emblem 33, Tablet 1 |
| poe1 `card` | 13 | all Divination Cards |
| poe2 `currency` | 81 | no rule 65 (Legacy of ... , Rogue's Marker ...), Omen 8, Artifact 4, **[DNT] 2 (must stay out: `badName`)**, other 2 |
| poe2 `map` | 25 | Waystone (Tier n) 16 (own category, not a hub item), Barya 6, Calamity Fragment 3 |

## Proposed table (group + name rule -> our category); everything else is NOT added

| game | GGG group | name rule | category |
|---|---|---|---|
| poe1 | `card` | any | DivinationCard |
| poe1 | `currency` | ends with ` Oil` | Oil |
| poe1 | `currency` | ends with ` Fossil` | Fossil |
| poe1 | `currency` | ends with ` Resonator` | Resonator |
| poe1 | `currency` | contains `Essence of`, or starts `Remnant of Corruption` | Essence |
| poe1 | `currency`, `map` | ends with ` Scarab` | Scarab |
| poe1 | `currency` | ends with ` Delirium Orb` | DeliriumOrb |
| poe1 | `currency` | ends with ` Artifact` | Artifact |
| poe1 | `currency`, `map` | `Splinter of`, `Breachstone`, `Emblem`, `Reliquary Key`, `... Fragment` | Fragment |
| poe1 | `currency` | everything else (shards, nets, sextants, blessings ...) | **not added** (needs a decision: Currency?) |
| poe2 | `currency` | ends with ` Rune` / `Soul Core` / starts `Omen of` / `Essence` / ` Artifact` | Rune / SoulCore / Omen / Essence / Artifact |
| poe2 | `currency`, `map` | `... Fragment` (Calamity), `Reliquary Key` | Fragment |
| poe2 | `gem` | `Uncut ...` / `Lineage` names | UncutGem is excluded from the whitelist (HUB_EXCLUDED); LineageGem only |
| poe2 | `map` | `Waystone (Tier n)` | **not added** (own tab) |
| both | any | `badName()` true ([DNT], INCOMPLETE, "not visible to players") | never |

Groups that are gear, gems, maps, monsters, leaguestones, heist, charts, tinctures, idols, corpses, grafts, wombgifts: not whitelist categories - not added.

## Open points before any code

1. The shipped snapshot of the web page (`apps/web/public/data/trade_names_<game>.json`) holds **names only**; the desktop reads GGG live (names only). The group has to travel with the
   name (a new snapshot shape, `names:refresh` and `tradeNames.namesFromPayload` change, the desktop 7-day cache too).
2. The rule table is name based: a new GGG naming pattern is not classified (it is simply not added, which is today's behaviour) - say whether that is acceptable.
3. Output change: a category tier ("whole category = A") now also covers the added names, so a filter made with the same settings gets more lines. The Python original has no such source: the goldens stay
   as they are only when the golden runners pass no GGG groups (the new input is optional).
4. Decide the `currency` leftovers (Blessings, shards, nets, sextants: ~200 names in PoE1, ~65 in PoE2): not added (proposal) or category Currency.
