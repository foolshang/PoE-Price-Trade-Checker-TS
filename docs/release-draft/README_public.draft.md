# PoE Filter Generator & Price/Trade Checker (PoE1 & PoE2)

> DRAFT of the public README (Thai). It replaces release/README_public.md of the original when part B is ordered. Not published.
> The long sections about the two tabs (NeverSink / Whitelist) are unchanged from the original's README and are kept as they are.

เครื่องมือสำหรับ Path of Exile 1 และ 2 สองโปรแกรม ในรุ่นเดียว:

- **PoE Filter Generator** — สร้าง **loot filter** (แท็บ **NeverSink** และ **Whitelist**) ใช้บนเว็บก็ได้
- **PoE Price & Trade Checker** — กด **F5** บน item ในเกม → เลือก mod ที่จะค้น → เปิดหน้า trade ให้ · กด **F4** เปิดตารางอ้างอิง mod ของ skill ·
  มีหน้า Filter Generator ในตัว และสร้าง filter ใหม่ให้เองเมื่อ NeverSink ออกเวอร์ชันใหม่

---

## โหลด

👉 **[ดาวน์โหลดรุ่นล่าสุด](https://github.com/foolshang/PoE-Filter-Generator/releases/latest)** (หน้า Releases)

| ไฟล์ | คืออะไร |
|---|---|
| `PoE-Filter-Generator-TS-Setup-<รุ่น>.exe` | ติดตั้งคลิกเดียว (ไม่ถามสิทธิ์ admin) — **อัปเดตตัวเองได้** |
| `PoE-Price-Trade-Checker-TS-Setup-<รุ่น>.exe` | เหมือนกัน สำหรับ Checker |
| `…-Portable-<รุ่น>.zip` | ไม่ต้องติดตั้ง แตก zip ที่ไหนก็ได้แล้วรัน — **อัปเดตตัวเองไม่ได้** (แจ้งเมื่อมีรุ่นใหม่ พร้อมลิงก์) |

ค่าที่ตั้งเก็บใน `%LOCALAPPDATA%\PoeFilterGenTS` (Filter Generator) และ `%LOCALAPPDATA%\PoePriceTradeTS` (Checker) ทั้งแบบติดตั้งและแบบ zip —
**ไม่เขียนอะไรในโฟลเดอร์ที่แตก zip** · ถอนการติดตั้งไม่ลบค่าที่ตั้ง

### ใช้บนเว็บ (ไม่ต้องโหลดอะไร)

👉 **[เปิดเวอร์ชันเว็บ](https://foolshang.github.io/PoE-Filter-Generator/)** — ฟังก์ชันเดียวกับ Filter Generator
(Chrome / Edge เขียนไฟล์ลงโฟลเดอร์เกมให้เลย · Firefox / Safari ใช้การดาวน์โหลด)

### ครั้งแรกที่รัน Windows อาจเตือน
ไฟล์ไม่ได้ sign ดิจิทัล → Windows SmartScreen จะขึ้น "Windows protected your PC" กด **More info → Run anyway** ครั้งเดียว

### อัปเดตอัตโนมัติ (แบบติดตั้ง)
โปรแกรมเช็ครุ่นใหม่ตอนเปิด (แล้วทุก 6 ชั่วโมง) โหลดเบื้องหลัง แล้วบอกที่แถบด้านบนว่า "มีรุ่นใหม่ ติดตั้งเมื่อปิดโปรแกรม" —
**ไม่ปิดโปรแกรมให้เองระหว่างเล่น** จะติดตั้งตอนที่คุณปิดโปรแกรม หรือกดปุ่ม **รีสตาร์ทเพื่ออัปเดต** เอง
รุ่นทดลอง (ชื่อรุ่นมี `-` เช่น `1.1.0-beta.1`) ไม่ถูกส่งให้ผู้ใช้รุ่นปกติ

---

## ย้ายมาจากโปรแกรมรุ่นเก่า (exe ที่เขียนด้วย Python)

- เปิดรุ่นใหม่ครั้งแรก โปรแกรมอ่านค่าจากโฟลเดอร์เดิม (`PoeFilterGen` / `PoePriceTrade`) มาให้ **ครั้งเดียว** และบอกใน Status ว่าค่าไหนนำเข้า ค่าไหนไม่นำเข้า
  (ค่าของโหมดราคา/OCR ที่รุ่นนี้ไม่มี) · **ไม่แก้ไฟล์เดิมเลย** ใช้โปรแกรมเก่าต่อคู่กันได้
- รุ่นเก่าอัปเดตตัวเองไม่ได้: โหลดรุ่นใหม่จากหน้า Releases แล้วติดตั้งทับได้เลย
  (exe เก่าโหลดได้จาก release เก่าบนหน้าเดียวกัน)
- **ปิดโปรแกรมเก่าก่อนเปิดรุ่นใหม่** — โปรแกรมเก่าจองปุ่ม F4 / F5 ไว้ รุ่นใหม่จะบอกใน Status ถ้าปุ่มถูกจอง

---

## PoE Price & Trade Checker

| ปุ่ม | ทำอะไร |
|---|---|
| **F5** (ชี้ item แล้วกด) | copy item → ถ้าเป็น Rare / Magic ขึ้นหน้าต่างเลือก mod (ใส่ min / max ได้) แล้วกด Enter เปิดหน้า trade · Unique เปิดหน้า trade ทันที |
| **F4** | ตารางอ้างอิง mod ของ skill (ค้นชื่อ skill → ช่วงเลเวล → mod ต่อ slot → passive) |
| **F8** | หน้า Settings: เกม / league / ปุ่มลัด / ปุ่มปิด / clipboard |
| **Ctrl+Alt+Q** | ปิดโปรแกรม |

- F5 รองรับ **เกมที่ตั้งภาษาเป็น English เท่านั้น**
- PoE2: ใช้ปุ่ม "แสดงรายละเอียดขั้นสูงของ item" ที่ตั้งในเกม (อ่านจาก `poe2_production_Config.ini` อย่างเดียว ไม่แก้ไฟล์) ถ้าอ่านไม่ได้ใช้ Alt
- F5 คืน clipboard เดิมของคุณหลัง copy (ปิดได้ใน Settings)
- ปิดหน้าต่างด้วยปุ่ม X = ซ่อนลง tray (เปลี่ยนเป็นปิดโปรแกรมได้ใน Settings) · ถ้า Windows สร้างไอคอน tray ไม่ได้ ปุ่ม X ปิดโปรแกรมจริง
- ปุ่มลัดที่ตั้งเองไม่ได้: ปุ่มที่ชนกับเกม (Ctrl+C / V / A / F, Ctrl+Enter, Home, Delete, Enter, ลูกศร) ปุ่มตัวอักษรเดี่ยวๆ และปุ่มที่ซ้ำกัน

### Filter Generator ในตัว Checker
ปุ่ม **Filter Generator** ในหน้าต่างหลัก — หน้าเดียวกับโปรแกรม Filter Generator (ค่าที่ตั้งแยกกัน)
ติ๊ก **regenerate อัตโนมัติ** ในแท็บ NeverSink แล้ว Checker จะเช็ค NeverSink ตอนเปิด (แล้วทุก 6 ชั่วโมง) และสร้าง filter ใหม่ให้เมื่อมีเวอร์ชันใหม่
พร้อมแจ้งเตือน 3 ทาง: ใน Status · ที่ tray · **ข้อความทับจอเกม** (มุมขวาล่าง ไม่รับคลิก ไม่แย่งโฟกัส)

---

## (ส่วนอื่นของ README เดิม)

แท็บ NeverSink / แท็บ Whitelist / เปิด filter เก่ามาแก้ / ต้องมีอะไร — คงตาม `release/README_public.md` ของโปรแกรมเดิม

## แก้ปัญหา

**Generate แล้วขึ้น error เขียนไฟล์ไม่ได้** — มักเป็น **Windows Defender "Controlled Folder Access"** บล็อกโปรแกรมใหม่ไม่ให้เขียนลง Documents / My Games:
1. Windows Security → **Virus & threat protection** → **Ransomware protection** → **Controlled folder access** →
   **Allow an app through Controlled folder access** → เพิ่มโปรแกรม (แบบติดตั้ง: `%LOCALAPPDATA%\Programs\PoE-Filter-Generator-TS\PoE-Filter-Generator-TS.exe`
   และ `…\PoE-Price-Trade-Checker-TS\PoE-Price-Trade-Checker-TS.exe` · แบบ zip: exe ในโฟลเดอร์ที่แตก)
2. หรือกด **Browse...** ที่ช่อง *Game folder override* แล้วเลือกโฟลเดอร์ filter ของเกมเอง

**F5 ไม่ทำงานในเกม** — ถ้าเกมรันแบบ Administrator Windows ไม่ให้โปรแกรมส่งปุ่มไปหาเกม: เปิดเกมแบบปกติ หรือรันโปรแกรมนี้แบบ Administrator เหมือนเกม

## หมายเหตุ

- ต่อยอดจาก **[NeverSink Filter](https://github.com/NeverSinkDev/NeverSink-Filter)** (เครดิต NeverSink)
- โปรแกรมนี้**ไม่มีส่วนเกี่ยวข้อง**กับ Grinding Gear Games
- filter ที่สร้างจะ**เขียนทับ**ไฟล์ชื่อเดียวกันในโฟลเดอร์ filter ของเกม
