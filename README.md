# Pen Store
เปิดร้านเกม itch.io บน **Windows / Linux / Android**

## Build
1. สร้าง repo ใหม่บน GitHub แล้วอัปโหลดไฟล์ทั้งหมด (รวมโฟลเดอร์ .github)
2. แท็บ Actions -> Build Pen Store -> Run workflow -> รอเสร็จ ได้ 3 ไฟล์ (Artifacts / Releases):
   - `PenStore.exe` — Windows
   - `PenStore.AppImage` — Linux (`chmod +x PenStore.AppImage && ./PenStore.AppImage`)
   - `PenStore.apk` — Android (เปิดติดตั้งจากไฟล์ ต้องอนุญาต "ติดตั้งจากแหล่งที่ไม่รู้จัก")

ทดสอบในเครื่อง (Win/Linux): `npm install && npm start` (กด F12 ดู error)

## การรองรับ
| | Windows | Linux | Android |
|---|---|---|---|
| เกมเว็บ HTML5 (เล่น/ติดตั้งออฟไลน์) | ✓ | ✓ | ✓ |
| เกมโหลดไฟล์ | .exe | ไฟล์ Linux (ELF/.sh/.AppImage) | ✗ |

- เกมเว็บ "ติดตั้ง": เล่นครั้งแรกแอปจะเก็บไฟล์เกมที่โหลดไว้ในเครื่อง ครั้งต่อไปเล่นออฟไลน์ได้ (เล่นให้ผ่านทุกส่วนที่ต้องการก่อน 1 รอบ)
- Linux: เลือกโหลดเฉพาะไฟล์ที่มีป้ายแพลตฟอร์ม LINUX (เกมที่มีแค่ Windows จะเล่นไม่ได้)
- ค้นหา: พิมพ์ชื่อเกม Enter | `#horror` = ค้นตามแท็ก
- ข้อมูล Desktop: โฟลเดอร์ `PenStore-Data` ข้างไฟล์โปรแกรม | Android: ในที่เก็บข้อมูลแอป
