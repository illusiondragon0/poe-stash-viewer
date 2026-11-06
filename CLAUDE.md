# PoE Stash Viewer — context สำหรับ Claude

เว็บดู Stash ของ Path of Exile 1 พร้อมประเมินราคาจาก poe.ninja ใช้คนเดียว (เจ้าของ: illusiondragon0) เขียนเป็นภาษาไทยเป็นหลัก

- Repo: https://github.com/illusiondragon0/poe-stash-viewer (branch `main`, push ตรงเข้า main ได้ เจ้าของอนุญาตแล้ว)
- เว็บจริง: https://poe-stash-52b30.web.app/ (Firebase Hosting, project `poe-stash-52b30`)
- API จริง: https://poe-stash-api.onrender.com (Render, Free instance, หลับเมื่อไม่มีคนใช้ — ครั้งแรกหลังว่างช้า 50 วินาทีขึ้นไป)
- League ปัจจุบัน: `Allflame` (default ใน server และ dropdown ในหน้าเว็บ)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `public/index.html` | Frontend ไฟล์เดียว (HTML+CSS+JS) ~1,300 บรรทัด ไม่มี build step |
| `public/favicon.svg` | ไอคอนแท็บ: ตาราง 3×3 มีช่องทอง 1 ช่อง |
| `functions/index.js` | Express proxy (ชื่อโฟลเดอร์ `functions/` แต่ **ไม่ใช่ Firebase Functions** รันบน Render ด้วย `node functions/index.js`) |
| `functions/package.json`, `package-lock.json` | express + node-fetch (Node 20+ มี fetch ในตัว ตัด node-fetch ได้ถ้าต้องการ) |
| `package.json` (root) | ให้ Render ใช้ `npm start` → `node functions/index.js` |
| `.github/workflows/deploy.yml` | Deploy เฉพาะ Hosting ทุก push เข้า main (ดูหัวข้อ Deploy) |
| `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc` | ยังเหลืออยู่ แต่ **ไม่มีโค้ดส่วนไหนใช้ Firestore** |
| `README.md` | คู่มือสั้น (เขียนใหม่แล้ว ตรงกับของจริง) |

ลบไปแล้ว: `railway.json` (เคยลองใช้ Railway ตอนนี้ใช้ Render)

## Deploy

- **Frontend:** push เข้า `main` → GitHub Action "Deploy to Firebase Hosting" (~30 วินาที) ใช้ secrets `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID` workflow มี step "Stamp version" แทน `__VERSION__` ใน `index.html` ด้วย `วันที่-sha7ตัว` ขึ้นที่แถบบนข้างโลโก้ (ใช้เช็คว่าเว็บเป็นเวอร์ชันไหน)
- **API:** Render auto-deploy จาก `main` เหมือนกัน (~50 วินาที)
- **Firebase cache:** `max-age=3600` ผู้ใช้ต้อง Ctrl+Shift+R หลัง deploy
- **เคยพังและแก้แล้ว:** Action ล้ม 403 (`serviceusage.services.get`) เพราะ service account ขาด role ตอนนี้ `firebase-adminsdk-fbsvc@poe-stash-52b30.iam.gserviceaccount.com` มี **Service Usage Consumer** แล้ว ถ้า 403 โผล่อีก ให้ตรวจ role ที่ IAM ก่อน (ครั้งแรกหลังเพิ่ม role ต้องรอสักพัก/รัน rerun)
- เช็คผล deploy: `gh run list --repo illusiondragon0/poe-stash-viewer --limit 3` และ `curl -s -H "Cache-Control: no-cache" https://poe-stash-52b30.web.app/ | grep appVersion`

## API server (`functions/index.js`)

| Endpoint | หมายเหตุ |
|---|---|
| `GET /api/tabs?accountName&league&sessid` | รายชื่อแท็บ stash ส่ง POESESSID เป็น cookie ไป pathofexile.com |
| `GET /api/stash?accountName&league&tabIndex&tabType&tabId&sessid` | ไอเทมในแท็บ MapStash ลองหลาย URL (tabIndex/id ± type) และดึง items จาก `mapLayout` ถ้า items ว่าง |
| `GET /api/ninja-prices?league` | ราคารวม คืน `{prices, stashItems, stashNames, clusterMap, divinePrice, mirrorDivine}` ใช้เวลา ~5 วินาที **ไม่มี cache** (ข้อเสนอที่ยังไม่ได้ทำ: cache ต่อ league 10–15 นาที) |
| `GET /api/scarab-prices?league` | ราคา Scarab (ดึง details ทีละตัว batch 20) |
| `GET /api/debug-item?...` | ดู raw item (debug ควรลบ/ป้องกันถ้าเปิดสาธารณะ) |

- CORS เปิด `*` และ expose header `Retry-After`
- Error จาก PoE ส่ง status จริงกลับ (เดิมแปลงเป็น 404) พร้อม `Retry-After`

### กฎราคา (สำคัญ)
poe.ninja เลิกใช้ `api/data/currencyoverview` และ `api/data/itemoverview` (404) ใช้ API ใหม่แทน:

1. **Exchange types** — `GET https://poe.ninja/poe1/api/economy/exchange/current/overview?league=X&type=T` คืน `lines[]` (`id`, `primaryValue` = chaos) คู่กับ `items[]` (`id`, `name`, `image`, `detailsId`) จับคู่ด้วย `id` ฟังก์ชันเดียว `fetchCurrencyType(type)` ใช้กับ:
   `Currency, Fragment, Oil, Essence, DeliriumOrb, DivinationCard, Artifact, Fossil, Resonator, Omen, AllflameEmber, Runegraft, DjinnCoin, Tattoo, Astrolabe, Ducat, EnshroudingCrystal`
   - ไอคอน = `https://web.poecdn.com` + `image`. DivinationCard ไม่มี image ใน API (หน้าเว็บ fallback ใช้ไอคอนจาก stash item เอง)
   - เก็บ key เป็นชื่อ lowercase, อีกชุดตัด apostrophe, และ `id` แทน `-` ด้วยช่องว่าง
   - Chaos Orb ฮาร์ดโค้ด 1c ถ้าไม่มี
2. **Stash types** — `GET .../economy/stash/current/item/overview?league&type=T` คืน `lines[]` พร้อม `name, chaosValue, icon, variant, links, gemLevel, ...` ใช้กับ `fetchStashItemType` (Unique*, SkillGem, Map, BlightedMap, ValdoMap, ฯลฯ → `stashItems`/`stashNames`) และ `fetchItemOnly` (Invitation, Vial, Beast, Wombgift, Corpse, ScryingOrb → `priceMap` ตามชื่อ) `fetchClusterJewels` แยกต่างหาก
3. **Scarab** — `/api/scarab-prices` + ฮาร์ดโค้ดรายชื่อ scarab ที่ id ไม่ตรงชื่อ
4. **Mirror** — details endpoint `exchange/current/details?...&type=Currency&id=mirror-of-kalandra` ดู pair `divine`
- ประเภทที่ poe.ninja **ไม่มีข้อมูล** (ไม่ใช่บั๊ก): Incubator, Memory, ImbuedGem, DjinnCoin (ว่างใน Allflame), Temple (API 500), BaseType/Flask (ไม่ได้ทำ — ต้อง match ilvl/influence, BaseType 8,894 รายการ)
- **หน้า poe.ninja แสดงราคาแบบ "Adaptive":** ค่ามากแสดงเป็น Divine (เช่น House of Mirrors "156" = 156 divine = 63,422c) อย่าเอาไปเทียบกับ chaos ตรงๆ ค่าใน API/โค้ดเรา (chaos) ตรงกับ poe.ninja แล้ว (ตรวจแล้ว ต่าง 1–3% จากเวลา)
- ของที่ poe.ninja ไม่ลิสต์ราคา (div card ราคาต่ำ ~40 ใบ, fossil 3 ตัว, magic/normal flask, rare, magic map) จะไม่มีราคา แล้วหน้าเว็บแสดงช่อง Price ว่า "ไม่มีราคาใน poe ninja"

### ข้อควรระวังของ PoE API
- ใช้ `POESESSID` (cookie) กับ `character-window/get-stash-items` ไม่ใช่ OAuth เจ้าของเลือก **ไม่ทำ OAuth** (ต้องขอ client_id จาก GGG)
- **429 rate limit:** เกิดง่ายเมื่อโหลดหลายแท็บรวด Frontend มี `fetchGGG()` — เจอ 429 รอตาม `Retry-After` (5–60 วินาที มีตัวนับถอยหลังที่แถบสถานะ) ลองใหม่ได้ 3 ครั้ง และเว้น 1 วินาทีระหว่างแท็บ
- **403** = POESESSID หมดอายุ ต้องก๊อปใหม่เอง (ห้ามกรอกแทนผู้ใช้)
- POESESSID ส่งผ่าน query string ไป Render (ความเสี่ยงที่ยังไม่แก้: ควรย้ายเป็น header/POST)

## Frontend (`public/index.html`)

- State ระดับบนสุด: `ninjaMap, stashNames, stashItems, clusterMap, scarabMap, tabsData, checkedTabs, allItems, divinePrice, mirrorDivine, realPrices`
- ฟังก์ชันหลัก: `init()` (โหลดแท็บ + ราคา), `loadSelected()`, `getPriceForItem()` (ลำดับ: Inscribed Ultimatum → Cluster Jewel → Blighted Map → Map → Gem → Unique → Scarab → ninjaMap), `processItems()` (จัดกลุ่ม stack ต่อแท็บ), `renderTable()`, `updateWealth()`, `fetchGGG()`
- แถบ breakdown บน header แสดงเฉพาะ **Divine Orb และ Chaos Orb** (รวมทุกแท็บ)
- ช่อง Price ที่ไม่มีราคา: `'ไม่มีราคาใน poe ninja'`; Total ที่ไม่มี: `—`
- คอลัมน์ Real Price/Calc/Qty: ผู้ใช้กรอกราคาจริง รองรับรูปแบบ `5` หรือ `1/3` (`computeRealPrice`)
- เก็บแท็บที่เลือกไว้ใน localStorage key `poe_tabs_<account>`
- **ห้ามเปลี่ยน id/class ที่ JS ใช้** (`tabList, wealthVal, wealthDiv, breakdownList, selectedTotal, btnLoad, btnExport, ninjaBadge, statusText, progressFill, ...`)
- ปุ่ม `btnLoad`/`btnExport` สลับ `style.display` เป็น `inline-flex`

### ดีไซน์ (ปรับตาม skill unslop ของ heydamir — https://github.com/heydamir/unslop, CC BY 4.0)
- ถ้าเผยแพร่ต่อ ควรให้เครดิต Damir Sokolovsky (@heydamir) (ยังไม่ได้ใส่ในหน้าเว็บ)
- Graphite ramp: `--bg-deep #0f0f10`, `--bg #141415`, `--card #19191b`, `--raised #232325`, hairline = text 8%; text `#ededed / #a1a1a6 / #85858b`
- Accent ทองเดียว `--accent #d1ae6b` (ยอด Total wealth, ช่องที่เลือก, ลูกศร sort); ปุ่มหลักสีขาวนวล `#ededed` ตัวอักษรเข้ม; positive `#4cc38a`, negative `#e5484d`
- สีชื่อไอเทมตาม rarity คงไว้ (สื่อความหมาย)
- ฟอนต์: IBM Plex Sans Thai (ข้อความ) + IBM Plex Mono (ตัวเลข, tabular) น้ำหนัก 400–600 ไม่มี uppercase/emoji/gradient/glow
- ไอคอนเป็น SVG แบบ lucide (class `svg.i`, stroke 1.5, 16px); easing เดียว `cubic-bezier(0.22,1,0.36,1)`; spacing บนกริด 4px; sidebar 240px; topbar 64px
- badge poe.ninja มีจุดสีสถานะ (signature)

## ทดสอบในเครื่อง

- รัน API: `cd functions && npm install && PORT=3111 node index.js` แล้ว `curl "localhost:3111/api/ninja-prices?league=Allflame"` (ควรได้ ~1,000+ รายการ, divine ≈ 400c, ใช้เวลา ~5 วินาที)
- ดูหน้าเว็บ: `cd public && python -m http.server 8765` แล้วเปิด http://127.0.0.1:8765/ (ไฟล์ `file://` รัน script ไม่ได้ในเบราว์เซอร์พรีวิว) หน้าเว็บเรียก API จริงบน Render (`API_BASE`) ถ้าจะชี้เครื่องตัวเองให้แก้ชั่วคราว
- ทดสอบ UI โดยไม่ต้องมี POESESSID: ฉีดข้อมูลจำลองด้วย JS (`tabsData=[…]; renderSidebar(); allItems=[{name,base,typeLine,qty,rarity,tab,chaosEach,totalChaos,icon,links,corrupted}]; renderTable(); updateWealth();`)
- ไฟล์ใน repo เป็น LF; บน Windows git เตือน "LF will be replaced by CRLF" ปกติ ถ้าแพตช์ด้วยสคริปต์ให้ `.replace(/\r\n/g,'\n')` ก่อน

## ประวัติการทำงานล่าสุด (พ.ย. 2026)

1. รีวิว repo: พบ README ไม่ตรง (Firebase Functions/Firestore ไม่ได้ใช้), config ซ้ำ (Railway), `app.listen` กลางไฟล์, ไม่มี cache ราคา, POESESSID ใน query string
2. แก้ `fetchCurrencyType` ให้ใช้ `items[]`+`lines[]` (currency ขึ้น `[no price]` เพราะ endpoint เก่าตาย) และขยายไปทุก exchange type, เพิ่ม Ducat/EnshroudingCrystal, เปลี่ยน `fetchItemOnly` ไป stash overview
3. ตรวจเทียบกับ poe.ninja และ stash จริง (22 แท็บ 503 รายการ): ไม่มีราคาผิด เหลือ 90 รายการที่ poe.ninja ไม่มีราคาเอง
4. จัดการ 429, แก้ GitHub Action 403 (เพิ่ม role), ใส่เลขเวอร์ชัน, ปรับแถบ breakdown, ข้อความ "ไม่มีราคาใน poe ninja", รีดีไซน์ UI, เพิ่ม favicon

## งานที่ยังค้าง / ไอเดีย

- Cache `/api/ninja-prices` และ `/api/scarab-prices` ใน memory ต่อ league (10–15 นาที) — ลดโหลดและเวลารอ
- ย้าย POESESSID จาก query string เป็น header/POST; ปิดหรือป้องกัน `/api/debug-item`; จำกัด CORS ให้เหลือโดเมนเว็บ
- ราคา Base Type / Flask / Temple (ต้องหา endpoint/ตรรกะ match)
- ซ่อน Magic/Normal flask ออกจากรายการ "ไม่มีราคา" หรือใส่ราคา 0 ให้ div card/fossil ที่ ninja ไม่ลิสต์ (เสนอแล้ว ผู้ใช้ยังไม่เลือก)
- ใส่เครดิต unslop ในหน้าเว็บ (CC BY 4.0) ถ้าจะแชร์
- ล้างของที่ไม่ใช้: `firestore.*`, `.firebaserc` บางส่วน, `node-fetch`, ลบ `fetchItemOnly` ชื่อเก่าให้สื่อความหมาย
- ฝั่ง API ยังไม่มีเลขเวอร์ชัน

## ข้อตกลงกับเจ้าของโปรเจกต์

- ตอบภาษาไทย สั้นและตรง รายงานตามจริง (ถ้าไม่ได้ทดสอบ ให้บอกว่าไม่ได้ทดสอบ)
- push เข้า `main` ได้เลย แต่ **ไม่กรอก POESESSID/รหัสผ่านแทนผู้ใช้** ให้ผู้ใช้กรอกเอง; ไม่กด Authorize OAuth แทน
- หลัง push ให้ตรวจว่า Action สำเร็จและเว็บจริงเป็นเวอร์ชันใหม่ (เลขเวอร์ชันข้างโลโก้) และเตือนให้ Ctrl+Shift+R
- Commit message ปิดท้ายด้วย `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- ระวังยิง GGG ซ้ำ (429): อย่าโหลดทุกแท็บซ้ำๆ ตอนทดสอบ
