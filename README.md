# PoE Stash Viewer — Setup Guide

Stack: **Firebase Hosting** (frontend) + **Firebase Functions** (proxy server) + **Firestore** (เก็บข้อมูล) + **GitHub Actions** (auto deploy)

---

## สิ่งที่ต้องมีก่อน

- [Node.js 20+](https://nodejs.org/) — ติดตั้งแล้ว
- [Git](https://git-scm.com/) — ติดตั้งแล้ว
- บัญชี [GitHub](https://github.com/)
- บัญชี [Google/Firebase](https://firebase.google.com/) (ฟรี ใช้ Gmail)

---

## PART 1 — สร้าง Firebase Project

### 1.1 สร้าง Project ใหม่

1. ไปที่ https://console.firebase.google.com
2. กด **"Add project"**
3. ตั้งชื่อ เช่น `poe-stash-viewer`
4. เลือก **ปิด Google Analytics** (ไม่จำเป็น) → กด **Create project**
5. รอสักครู่ → กด **Continue**

### 1.2 เปิด Firestore

1. เมนูซ้าย → **Build → Firestore Database**
2. กด **Create database**
3. เลือก **Start in production mode** → Next
4. เลือก location: **asia-southeast1 (Singapore)** → Enable

### 1.3 เปิด Authentication (สำหรับอนาคต)

1. เมนูซ้าย → **Build → Authentication**
2. กด **Get started**
3. เลือก **Email/Password** → Enable → Save

### 1.4 Upgrade เป็น Blaze Plan (จำเป็นสำหรับ Functions)

> Firebase Functions ต้องการ Blaze plan (pay-as-you-go)
> แต่มี free tier ใหญ่มาก: 2 ล้าน invocations/เดือน ฟรี

1. เมนูซ้าย ล่างสุด → กด **Upgrade** (หรือ Spark → Blaze)
2. ใส่ billing info (บัตร Visa/Mastercard) → ไม่เสียเงินจนกว่าจะเกิน free tier

---

## PART 2 — ติดตั้ง Firebase CLI

เปิด Terminal แล้วพิมพ์:

```bash
# ติดตั้ง Firebase CLI แบบ global
npm install -g firebase-tools

# Login ด้วย Google account
firebase login
# จะเปิด browser ให้ login → Allow
```

---

## PART 3 — สร้าง GitHub Repository

### 3.1 สร้าง Repo ใหม่

1. ไปที่ https://github.com/new
2. Repository name: `poe-stash-viewer`
3. เลือก **Private** (แนะนำ เพราะมี POESESSID)
4. กด **Create repository**

### 3.2 Push โค้ดขึ้น GitHub

เปิด Terminal ใน folder `poe-stash/`:

```bash
# เข้า folder โปรเจค
cd poe-stash

# Init git
git init
git add .
git commit -m "Initial commit"

# เชื่อม remote (แทน YOUR_USERNAME ด้วย GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/poe-stash-viewer.git
git branch -M main
git push -u origin main
```

---

## PART 4 — เชื่อม Firebase กับ Project

### 4.1 Init Firebase ใน folder

```bash
# ยังอยู่ใน folder poe-stash/
firebase use YOUR_FIREBASE_PROJECT_ID
# หรือถ้าไม่รู้ project id:
firebase projects:list
```

### 4.2 แก้ .firebaserc

เปิดไฟล์ `.firebaserc` แล้วแทน `YOUR_FIREBASE_PROJECT_ID` ด้วย Project ID จริง:

```json
{
  "projects": {
    "default": "poe-stash-viewer-xxxxx"
  }
}
```

> Project ID หาได้จาก Firebase Console → Project settings → Project ID

---

## PART 5 — ตั้งค่า GitHub Secrets (สำหรับ Auto Deploy)

### 5.1 สร้าง Service Account Key

1. Firebase Console → **Project settings** (gear icon)
2. แท็บ **Service accounts**
3. กด **Generate new private key** → **Generate key**
4. จะ download ไฟล์ JSON มา (เก็บไว้ชั่วคราว อย่า commit!)

### 5.2 เพิ่ม Secrets ใน GitHub

1. ไปที่ GitHub repo → **Settings → Secrets and variables → Actions**
2. กด **New repository secret** แล้วเพิ่ม 2 secrets:

**Secret 1:**
- Name: `FIREBASE_SERVICE_ACCOUNT`
- Value: เปิดไฟล์ JSON ที่ download มา → copy ทั้งหมด → paste

**Secret 2:**
- Name: `FIREBASE_PROJECT_ID`
- Value: Project ID เช่น `poe-stash-viewer-xxxxx`

3. ลบไฟล์ JSON service account ทิ้งได้แล้ว (อย่าเก็บไว้ใน folder)

---

## PART 6 — Deploy ครั้งแรก (มือ)

```bash
# ติดตั้ง dependencies ของ functions
cd functions
npm install
cd ..

# Deploy ทุกอย่าง (functions + hosting + firestore rules)
firebase deploy

# หรือ deploy แยก:
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

รอประมาณ 2-3 นาที แล้วจะได้ URL:
```
Hosting URL: https://poe-stash-viewer-xxxxx.web.app
```

---

## PART 7 — Auto Deploy ทุกครั้งที่ Push

หลังจาก setup secrets ครบแล้ว ทุกครั้งที่ push ไป branch `main`:

```bash
# แก้ไขโค้ด...
git add .
git commit -m "แก้ราคา cluster jewel"
git push
```

GitHub Actions จะ deploy ให้อัตโนมัติ (~3 นาที)
ดู progress ได้ที่ GitHub repo → **Actions** tab

---

## PART 8 — รัน Local (Development)

```bash
# ติดตั้ง dependencies
cd functions && npm install && cd ..

# รัน local emulator (จำลอง Firebase ใน local)
firebase emulators:start --only hosting,functions

# หรือรัน server.js ตรงๆ แบบเดิม (ง่ายกว่าตอน dev)
cd functions
node -e "
const express = require('express');
// ... หรือใช้ server.js เดิมได้เลย
"
```

---

## โครงสร้างไฟล์

```
poe-stash/
├── .github/
│   └── workflows/
│       └── deploy.yml          ← Auto deploy เมื่อ push main
├── functions/
│   ├── index.js                ← API proxy (server.js → Firebase Function)
│   └── package.json
├── public/
│   └── index.html              ← Frontend
├── .firebaserc                 ← Project ID
├── .gitignore
├── firebase.json               ← Routing: /api/* → Function, /* → Hosting
├── firestore.rules             ← Security rules
└── firestore.indexes.json
```

---

## Firestore — เก็บข้อมูล (Optional)

ถ้าต้องการเก็บ history ราคา หรือ saved stash snapshots ใช้ได้ผ่าน Firebase SDK:

```javascript
// ใน index.html เพิ่ม Firebase SDK
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.x.x/firebase-app.js';
import { getFirestore, doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.x.x/firebase-firestore.js';

const app = initializeApp({
  apiKey: "YOUR_API_KEY",           // Firebase Console → Project settings → Your apps
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
});
const db = getFirestore(app);

// Save snapshot
await setDoc(doc(db, 'users', userId, 'snapshots', Date.now().toString()), {
  total: wealthTotal,
  items: allItems,
  timestamp: new Date(),
});
```

---

## ปัญหาที่พบบ่อย

| ปัญหา | วิธีแก้ |
|-------|---------|
| `Error: Functions need Blaze plan` | Upgrade Firebase plan ตาม Part 1.4 |
| `Error: CORS` | ไฟล์ `firebase.json` rewrite `/api/**` ต้องครบ |
| `Function timeout` | เพิ่ม `timeoutSeconds` ใน `functions/index.js` |
| `Deploy failed: permission denied` | ตรวจสอบ `FIREBASE_SERVICE_ACCOUNT` secret ว่า JSON ครบ |
| Actions ไม่ run | ตรวจสอบ branch ชื่อ `main` (ไม่ใช่ `master`) |
