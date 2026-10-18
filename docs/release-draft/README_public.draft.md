# PoE Filter Generator (PoE1 & PoE2)

> DRAFT of the public README (Thai). It replaces release/README_public.md of the original when part B is ordered. Not published.
> The Checker is NOT mentioned or linked here (Winai's answer to B0): its releases live in the Releases of the Checker's own repo and the
> program finds them by itself. The long sections about the two tabs (NeverSink / Whitelist) are unchanged from the original's README.

สร้าง **loot filter** สำหรับ Path of Exile 1 และ 2 (แท็บ **NeverSink** และ **Whitelist**) ใช้บนเว็บก็ได้

---

## โหลด

👉 **[ดาวน์โหลดรุ่นล่าสุด](https://github.com/foolshang/PoE-Filter-Generator/releases/latest)** (หน้า Releases)

| ไฟล์ | คืออะไร |
|---|---|
| `PoE-Filter-Generator-TS-Setup-<รุ่น>.exe` | ติดตั้งคลิกเดียว (ไม่ถามสิทธิ์ admin) — **อัปเดตตัวเองได้** |
| `PoE-Filter-Generator-TS-Portable-<รุ่น>.zip` | ไม่ต้องติดตั้ง แตก zip ที่ไหนก็ได้แล้วรัน — **อัปเดตตัวเองไม่ได้** (แจ้งเมื่อมีรุ่นใหม่ พร้อมลิงก์) |

ค่าที่ตั้งเก็บใน `%LOCALAPPDATA%\PoeFilterGenTS` ทั้งแบบติดตั้งและแบบ zip — **ไม่เขียนอะไรในโฟลเดอร์ที่แตก zip** · ถอนการติดตั้งไม่ลบค่าที่ตั้ง

### ใช้บนเว็บ (ไม่ต้องโหลดอะไร)

👉 **[เปิดเวอร์ชันเว็บ](https://foolshang.github.io/PoE-Filter-Generator/)** — ฟังก์ชันเดียวกับโปรแกรม
(Chrome / Edge เขียนไฟล์ลงโฟลเดอร์เกมให้เลย · Firefox / Safari ใช้การดาวน์โหลด)

### ครั้งแรกที่รัน Windows อาจเตือน
ไฟล์ไม่ได้ sign ดิจิทัล → Windows SmartScreen จะขึ้น "Windows protected your PC" กด **More info → Run anyway** ครั้งเดียว

### อัปเดตอัตโนมัติ (แบบติดตั้ง)
โปรแกรมเช็ครุ่นใหม่ตอนเปิด (แล้วทุก 6 ชั่วโมง) โหลดเบื้องหลัง แล้วบอกที่แถบด้านบนว่า "มีรุ่นใหม่ ติดตั้งเมื่อปิดโปรแกรม" —
**ไม่ปิดโปรแกรมให้เองระหว่างใช้งาน** จะติดตั้งตอนที่คุณปิดโปรแกรม หรือกดปุ่ม **รีสตาร์ทเพื่ออัปเดต** เอง
รุ่นทดลอง (ชื่อรุ่นมี `-` เช่น `1.1.0-beta.1`) ไม่ถูกส่งให้ผู้ใช้รุ่นปกติ

### ปุ่ม X และ About
- กด **X** = โปรแกรมลงไปอยู่ใน tray (ไอคอนข้างนาฬิกา) โปรแกรมยังทำงานอยู่ — คลิกไอคอนเพื่อเปิดหน้าต่าง หรือเลือก "ออก" เพื่อปิดจริง
  (เปลี่ยนให้ X ปิดโปรแกรมจริงได้ที่ปุ่ม **About**; ถ้า Windows สร้างไอคอน tray ไม่ได้ ปุ่ม X ปิดโปรแกรมจริง)
- ปุ่ม **About** บอกเวอร์ชัน ประวัติการอัปเดตทุกรุ่น และลิงก์ GitHub

---

## ย้ายมาจากโปรแกรมรุ่นเก่า (exe ที่เขียนด้วย Python)

- เปิดรุ่นใหม่ครั้งแรก โปรแกรมอ่านค่าจากโฟลเดอร์เดิม (`PoeFilterGen`) มาให้ **ครั้งเดียว** และบอกใน Status ว่าค่าไหนนำเข้า ค่าไหนไม่นำเข้า
  · **ไม่แก้ไฟล์เดิมเลย** ใช้โปรแกรมเก่าต่อคู่กันได้
- รุ่นเก่าอัปเดตตัวเองไม่ได้: โหลดรุ่นใหม่จากหน้า Releases แล้วติดตั้งทับได้เลย
  (exe เก่าโหลดได้จาก release เก่าบนหน้าเดียวกัน)

---

## (ส่วนอื่นของ README เดิม)

แท็บ NeverSink / แท็บ Whitelist / เปิด filter เก่ามาแก้ / ต้องมีอะไร — คงตาม `release/README_public.md` ของโปรแกรมเดิม

## แก้ปัญหา

**Generate แล้วขึ้น error เขียนไฟล์ไม่ได้** — มักเป็น **Windows Defender "Controlled Folder Access"** บล็อกโปรแกรมใหม่ไม่ให้เขียนลง Documents / My Games:
1. Windows Security → **Virus & threat protection** → **Ransomware protection** → **Controlled folder access** →
   **Allow an app through Controlled folder access** → เพิ่มโปรแกรม (แบบติดตั้ง: `%LOCALAPPDATA%\Programs\PoE-Filter-Generator-TS\PoE-Filter-Generator-TS.exe`
   · แบบ zip: exe ในโฟลเดอร์ที่แตก)
2. หรือกด **Browse...** ที่ช่อง *Game folder override* แล้วเลือกโฟลเดอร์ filter ของเกมเอง

## หมายเหตุ

- ต่อยอดจาก **[NeverSink Filter](https://github.com/NeverSinkDev/NeverSink-Filter)** (เครดิต NeverSink)
- โปรแกรมนี้**ไม่มีส่วนเกี่ยวข้อง**กับ Grinding Gear Games
- filter ที่สร้างจะ**เขียนทับ**ไฟล์ชื่อเดียวกันในโฟลเดอร์ filter ของเกม
