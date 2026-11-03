# PoE Stash Viewer

ดู Stash ของ Path of Exile พร้อมประเมินราคาจาก poe.ninja

| ส่วน | อยู่ที่ | deploy |
|---|---|---|
| Frontend | `public/index.html` | Firebase Hosting (GitHub Actions เมื่อ push เข้า `main`) |
| API proxy | `functions/index.js` (Express) | Render — `https://poe-stash-api.onrender.com` |

> ไม่ได้ใช้ Firebase Functions แม้โฟลเดอร์ชื่อ `functions/` — เป็น Express ธรรมดารันบน Render
> `firestore.rules` ยังไม่มีโค้ดส่วนไหนใช้ (deny ทั้งหมดนอกจาก `users/{uid}`)

## Endpoints

| Path | หน้าที่ |
|---|---|
| `GET /api/tabs?accountName&league&sessid` | รายชื่อแท็บ stash |
| `GET /api/stash?accountName&league&tabIndex&tabType&tabId&sessid` | ไอเทมในแท็บ |
| `GET /api/ninja-prices?league` | ราคารวม (exchange overview + stash overview) |
| `GET /api/scarab-prices?league` | ราคา Scarab (ดึง details ทีละตัว) |
| `GET /api/debug-item?...&search` | debug ดู raw item |

## ข้อควรรู้เรื่อง poe.ninja
- ราคา currency/oil/essence/tattoo ฯลฯ มาจาก `poe1/api/economy/exchange/current/overview` — `lines[]` มี `id`+`primaryValue`, `items[]` มี `id`+`name`+`image` จับคู่กันด้วย `id`
- `api/data/currencyoverview` และ `api/data/itemoverview` เลิกใช้แล้ว (404)
- เปลี่ยน league: แก้ค่า default `Allflame` ใน `functions/index.js` และ dropdown ใน `public/index.html`

## POESESSID
คัดลอกจากคุกกี้ `POESESSID` ของ pathofexile.com ใส่ในช่อง POESESSID ของหน้าเว็บ ถ้าได้ 403 แปลว่าหมดอายุ ให้ก๊อปค่าใหม่

## รันในเครื่อง
```bash
cd functions && npm install && node index.js   # API ที่ :3000
```
แล้วเปิด `public/index.html` (แก้ `API_BASE` เป็น `http://localhost:3000` ชั่วคราว)

## Deploy
- Frontend: push เข้า `main` → GitHub Action ใช้ secrets `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`
- API: Render เชื่อม repo นี้ start command `node functions/index.js`
