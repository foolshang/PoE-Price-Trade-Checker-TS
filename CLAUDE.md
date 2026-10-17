# PoE Price & Trade Checker (TypeScript) — CLAUDE.md

โปรเจกต์นี้ = เขียนใหม่ด้วย TypeScript + Electron โดยแปลงจากของเดิม (Python)
`D:\Projects\PoE_Price-Trade_Checker` ทีละไฟล์ ใช้โค้ด + เทสต์เดิมเป็นต้นแบบ (ไม่ใช่เริ่มจากศูนย์)

อ่านก่อนเริ่มทุก session: ไฟล์นี้ + `history.md` + `docs/PLAN.md` (แผนเฟสและสถานะ) + `docs/CONVERSION.md`
(ตารางแปลงไฟล์) ตอบ Winai เป็นภาษาไทย / code, comment, commit message, เอกสารใน `docs/` เป็นภาษาอังกฤษ
(ไฟล์นี้เป็นข้อยกเว้น: ไทยตามที่ Winai สั่ง)

## ขอบเขต

- ของเดิม (Python) ใช้งานต่อจนของใหม่ครบ — ของเดิมแก้แค่บั๊ก ไม่เพิ่มฟีเจอร์ ฟีเจอร์ใหม่ (เช่น regex)
  ทำที่นี่
- **ห้ามแก้ไฟล์ใดๆ ใน `D:\Projects\PoE_Price-Trade_Checker` และ repo `foolshang/PoE-Price-Trade-Checker`
  / `foolshang/PoE-Filter-Generator`** จนกว่า Winai สั่งเป็นรายครั้ง (อ่านอย่างเดียว; รัน Python เดิมเพื่อสร้าง
  golden ได้ แต่ห้ามเขียนอะไรลงโฟลเดอร์นั้น)
- 3 ตัวใช้ core ชุดเดียวกัน: `apps/checker` (Electron: F4 skill reference + F5 trade + หน้าตั้ง filter),
  `apps/filtergen` (Electron: Filter Generator แยกสำหรับคนทั่วไป), `apps/web` (GitHub Pages, ใช้ core TS ตรงๆ
  ไม่ใช้ Pyodide)
- **F4 โหมดราคา (OCR) ไม่รวมในโปรแกรมใหม่** (อยู่ใน repo เดิม: `poe_price_trade/ocr/`, `capture.py`, `scan.py`,
  `motion.py`, `matcher.py`, `normalizer.py`, `repository.py`, `overlay.py`, hover loop ใน `app.py`) — F4 ใหม่ =
  โหมด skill_ref (`skill_ref.py`, `skill_ref_window.py` ของเดิม)
- Title bar ช่วงใช้คู่ของเดิม: Checker = `PoE Price & Trade Checker (TypeScript) vX.Y.Z`,
  Filter Generator = `PoE1 & PoE2 Filter Generator (TypeScript) vX.Y.Z`

## ข้อมูลภายนอก (ใช้ต่อแบบเดิม ไม่เปลี่ยน)

- ราคา/ข้อมูลเมตา: **poe-data-hub เท่านั้น** (`https://storage.googleapis.com/poe-data-hub`) ห้ามยิง poe.ninja /
  poe2scout ตรง schema ตัวจริงอยู่ที่ `D:\Projects\Poe_Hub\SPEC.md` (8.1 prices, 8.1a events, 8.1b index.json,
  8.1c hardcore, 8.2 meta) ห้ามเดา; hub อัปเดตทุก 20 นาที cache TTL 5 นาที
- Standard / Hardcore Standard ไม่มีราคา (ตั้งใจ) League dropdown = main challenge + HC variant + event ที่เปิดอยู่
- NeverSink base filter: GitHub (tag/raw) + cache — เหมือน `neversink_source.py`
- ชื่อไอเท็มจริง: GGG `trade(2)/data/items`, stat id: `trade(2)/data/stats` + snapshot `trade_names_*.json`
- `mod_meta.json` (tier/money badge, build จาก RePoE ด้วย `tools/build_mod_meta.py` ของเดิม) ไม่เกี่ยวกับ hub
- F5 ไม่ใช้ข้อมูลราคาเลย (สร้าง trade URL จาก `ParsedItem` + stat id)

## กฎการทำงาน (ยกจากของเดิม + ที่ Winai สั่ง)

1. **เทสเองก่อนส่งทุกครั้ง** (vitest + parity + Playwright/รัน exe จริงเท่าที่ทำได้) แล้วรายงานแยกสองหัวข้อเสมอ:
   **"เทสแล้วผ่าน"** (ระบุว่าเทสอะไร กี่ตัว ผลจริง) กับ **"ต้องให้ Winai เทส"** (เช่น ในเกมจริง hotkey ทับเกม
   fullscreen, เสียงใน filter, ไฟล์ filter ในโฟลเดอร์เกม) ห้ามอ้างว่าผ่านถ้าไม่ได้รันจริง
2. **ห้าม commit / push / tag ก่อน Winai ยืนยัน** ลำดับ: แก้ → เทส → build exe → Winai เทสในเกมกับ exe →
   ค่อย commit/push → **tag เฉพาะเมื่อ Winai สั่ง** (tag = CI ปล่อย release จริง) ขั้นตอนใน plan ไม่ override กฎนี้
   (ข้อยกเว้นเดียว: รอบ "เฟส 0" ที่ Winai ให้ commit โครงเริ่มต้นได้ ห้าม tag)
3. **หลังทุก build (กฎถาวร ไม่ต้องรอ Winai):** ปิด exe ตัวเก่าที่รันอยู่ (checker และ filtergen) → แทนที่ใน
   `dist/` → เปิดตัวใหม่ → ยืนยันจาก title bar / startup log ว่าเป็นเวอร์ชันใหม่ ห้ามทิ้ง build ไว้โฟลเดอร์ข้าง
   (`dist_new/`) เพราะ exe เก่าล็อก `dist/` ก่อนให้ Winai เทส `tasklist` เช็ค process เก่าค้าง (single-instance lock
   ทำให้เทสโค้ดเก่าโดยไม่รู้ตัวได้ง่าย)
4. **bump version ทุก build** (แหล่งเดียว: root `package.json` → ฝังใน core/apps) CI ปฏิเสธ tag ที่ไม่ตรง version
5. **Debug อาการที่ Winai รายงาน:** ยืนยันก่อนว่ารันโค้ดปัจจุบันบนดิสก์ (เทียบ version + build timestamp ใน
   title bar / log กับซอร์ส) ก่อนตั้งสมมติฐานเรื่องตรรกะ โปรเจกต์นี้ต้องพิมพ์ version + build timestamp ลง log
   ตอนเริ่มเสมอ (ไม่ขึ้นกับระดับ log)
6. **Parity กับของเดิม:** ฟังก์ชันที่แปลงจาก Python ต้องให้ผลตรงของเดิมทุก byte บน input เดียวกัน (filter ทั้งไฟล์,
   settings หลังแก้, ข้อความที่แสดง) golden มาจากการรัน Python เดิม ห้ามแก้ golden ให้เทสผ่าน — ถ้าต่างต้องแก้
   โค้ด TS หรือบันทึกความต่างเป็นเจตนาใน `docs/` + `history.md` และให้ Winai ตัดสิน
7. **อัปเดต `docs/PLAN.md` (ตารางสถานะ) และ `history.md` ทุกครั้งที่จบงานหนึ่งก้อน** — entry ใหม่ไว้บนสุดของ
   `history.md` (วันที่ — สรุป — ไฟล์ที่แตะ — สถานะ/ปัญหาค้าง)
8. ไฟล์ local-only (`dist/`, `dist_new/`, `release-out/`, `.parity-cache/`, `node_modules/`) อยู่ใน `.gitignore`
   ไม่ commit

## ความเข้ากันได้กับของเดิม (ต้องรักษา)

- อ่าน `%LOCALAPPDATA%\PoePriceTrade\config.json` เดิม (merge เฉพาะ key ที่รู้จัก, `utf-8-sig`, dict-default merge
  key-by-key) รวม `filter_gen` และ cache/ไฟล์ rules เดิมในโฟลเดอร์นั้น ไม่ทำลายถ้า Winai รันของเดิมคู่กัน
- เปิดไฟล์ `.filter` ที่ของเดิมสร้างและมีค่าฝัง (`# poe-checker-config:`) กลับมาแก้ได้ + อ่าน v1/v2 เก่า
  (`wl_import`)
- ไฟล์เสียง/โฟลเดอร์เกม (`Documents\My Games\Path of Exile[ 2]`) ใช้ต่อ — กติกา copy เสียงเดิม (ชื่อเดิม,
  `#`/`;` → `_`, ห้ามเขียนทับเงียบๆ)
- `session.dpapi` (POESESSID) ไม่ใช้ในของใหม่ (ของเดิมก็ไม่ใช้แล้ว)

## สไตล์คำสั่ง shell

- ห้ามต่อ `cd` กับ redirect ในคำสั่งเดียว ใช้ `git -C <path>` แทน `cd <path> && git ...` และเลี่ยง `2>/dev/null`
  คู่กับ `cd`
- Windows + Git Bash/PowerShell: path ของ Winai มีช่องว่างน้อย แต่ quote เสมอ
