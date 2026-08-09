# 🖨️ مدير الطباعة - Print Manager

**تطبيق ويب متكامل لإدارة المستندات والطباعة مع دعم OCR**

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ المميزات الرئيسية

### 📁 إدارة الملفات
- رفع PDF, Word, Excel, الصور
- عرض ومعاينة المستندات
- تنظيم قائمة الطباعة

### 🖨️ الطباعة المتقدمة
- **A4, A5, Letter, Legal, B5**
- اتجاه عمودي/أفقي
- N-up (1، 2، 4 صفحات في ورقة)
- طباعة ثنائية الوجه (Duplex)
- نسخ متعددة (1-99)
- هوامش قابلة للتعديل
- جودة الطباعة (مسودة - عالية)

### 🆔 تصوير البطاقات / الهوية
- كاميرا خلفية عالية الدقة
- تصوير الوجه والظهر
- رفع تلقائي على Cloudflare R2
- وضعان للطباعة:
  - **متراكب**: وجه فوق + ظهر أسفل
  - **وجه وظهر**: صفحتين منفصلين

### 🔍 استخراج النصوص (OCR) ⭐ جديد
- تصوير أي مستند فورياً
- معالجة بـ **Qwen2.5-VL-7B** (ذكاء اصطناعي)
- دعم **العربية والإنجليزية** و+20 لغة
- **تحويل النص إلى PDF** قابل للطباعة
- **طباعة مباشرة** من التطبيق
- نسخ النص للحافظة

### ☁️ السحابة والمزامرة (Firebase) ⭐ جديد
- **حفظ مهام الطباعة** في السحابة
- **مزامنة نتائج OCR** بين الأجهزة
- **حفظ المستندات** وبياناتها التعريفية
- **تسجيل دخول** (بريد إلكتروني / مجهول)
- **مزامنة فورية** (Real-time)
- **إعدادات مستخدم** محفوظة في السحابة

### 📱 PWA (Progressive Web App)
- يعمل بدون إنترنت بعد التثبيت
- شاشة كاملة على الهاتف
- إشعارات وتحديثات

---

## 🚀 التشغيل السريع

### الطريقة 1: فتح مباشر
```bash
# فقط افتح الملف في المتصفح
open index.html
# أو انقر مرتين على index.html
```

### الطريقة 2: سيرفر محلي
```bash
# Python 3
python3 -m http.server 8080

# ثم افتح: http://localhost:8080

# Node.js
npx serve .
```

---

## 📋 المتطلبات

- **المتصفح**: Chrome, Firefox, Safari, Edge (حدث)
- **الكاميرا**: لتصوير البطاقات والمستندات (اختياري)
- **إنترنت**: لميزة OCR فقط (API خارجي)

---

## ⚙️ الإعداد المتقدم

### 1. رفع البطاقات على R2 (Cloudflare)

```bash
# تثبيت Wrangler
npm install -g wrangler

# تسجيل الدخول
wrangler login

# نشر Worker
wrangler deploy --config wrangler.toml
```

**ملفات Worker:**
- `worker-r2.js` - API رفع الصور
- `wrangler.toml` - إعدادات النشر

### 2. تفعيل OCR (OpenRouter)

**الحصول على مفتاح API:**
1. اذهب إلى [openrouter.ai/keys](https://openrouter.ai/keys)
2. سجّل وأنشئ مفتاح جديد

**النشر:**
```bash
# إضافة المفتاح
wrangler secret put OPENROUTER_API_KEY
# الصق المفتاح واضغط Enter

# نشر Worker
wrangler deploy --config wrangler-ocr.toml
```

**ملفات Worker:**
- `worker-ocr.js` - API استخراج النصوص
- `wrangler-ocr.toml` - إعدادات النشر
- `README-OCR-WORKER.md` - توضيح مفصل

### 3. Firebase Realtime Database (السحابة)

**إنشاء مشروع Firebase:**
1. اذهب إلى [console.firebase.google.com](https://console.firebase.google.com)
2. أنشئ مشروع جديد أو اختر مشروع موجود
3. فعّل **Realtime Database** من القائمة

**الحصول على إعدادات المشروع:**
1. اذهب إلى **إعدادات المشروع** > **عام**
2. انسخ: `API Key`, `Auth Domain`, `Project ID`, etc.

**تحديث الإعدادات في الكود:**
```javascript
// في ملف app.js - ابحث عن firebaseConfig
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",           // ← استبدلها
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

**نشر قواعد قاعدة البيانات:**
```bash
# تثبيت Firebase CLI
npm install -g firebase-tools

# تسجيل الدخول
firebase login

# نشر القواعد
firebase deploy --only database:rules
```

**قواعد الأمان (`database.rules.json`):**
```json
{
  "rules": {
    "users": { "$uid": { ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" } },
    "printJobs": { ".read": true, ".write": "auth != null" },
    "ocrResults": { "$uid": { ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" } },
    "documents": { "$uid": { ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" } }
  }
}
```

---

## 🎯 الأقسام

```
┌──────────────────────────────────────────────┐
│  📁 الملفات   |  👁 العرض  |  🖨 طباعة     │
├──────────────────────────────────────────────┤
│  🆔 البطاقة  |  🔍 OCR   |  ☁️ سحابة    │
├──────────────────────────────────────────────┤
│  ⭐ متقدم                                    │
└──────────────────────────────────────────────┘
```

| القسم | الوظيفة |
|-------|---------|
| **📁 الملفات** | رفع وإدارة المستندات |
| **👁 العرض** | معاينة PDF والصور |
| **🖨 الطباعة** | إعدادات الطابعة وصف الطباعة |
| **🆔 البطاقة** | تصوير الهوية + R2 |
| **🔍 OCR** | استخراج النصوص + PDF |
| **☁️ سحابة** | Firebase - المزامرة والحفظ |
| **⭐ متقدم** | اتصال OTG مباشر |

---

## 🛠️ التقنيات

| التقنية | الاستخدام |
|---------|----------|
| HTML5/CSS3 | الواجهة العربية RTL |
| JavaScript ES6+ | المنطق والتفاعل |
| Service Worker | PWA والتخزين المؤقت |
| PDF.js | عرض ملفات PDF |
| jsPDF | إنشاء PDF من النصوص |
| Mammoth.js | تحويل Word |
| SheetJS | تحويل Excel |
| Cloudflare Workers | Backend API |
| OpenRouter API | الذكاء الاصطناعي (OCR) |
| **Firebase Realtime Database** | **السحابة والمزامرة** |
| **Firebase Authentication** | **تسجيل الدخول** |

---

## 📊 هيكل المشروع

```
print-manager/
│
├── 📄 index.html          ← الواجهة الرئيسية
├── 📄 app.js              ← المنطق البرمجي (مع Firebase)
├── 📄 sw.js               ← Service Worker
├── 📄 manifest.json       ← PWA Manifest
│
├── ⚙️ Workers (Cloudflare):
│   ├── worker-r2.js       ← رفع الصور
│   ├── worker-ocr.js      ← OCR API
│   ├── wrangler.toml      ← إعدادات R2
│   └── wrangler-ocr.toml  ← إعدادات OCR
│
├── 🔥 Firebase:
│   ├── firebase.json       ← إعدادات النشر
│   ├── .firebaserc         ← إعدادات المشروع
│   └── database.rules.json ← قواعد قاعدة البيانات
│
├── 📚 التوثيق:
│   ├── README-WORKER.md      ← دليل R2
│   └── README-OCR-WORKER.md  ← دليل OCR
│
└── 🖼️ icons/               ← أيقونات PWA
    ├── icon-192.png
    └── icon-512.png
```

---

## 📝 الترخيص

MIT License - حرية الاستخدام والتعديل والتوزيع

---

## 👨‍💻 المطور

**المهندس محمد حماد**

[واتساب](https://wa.me/201279934735) | [فيسبوك](https://www.facebook.com/en.mohamed.nasr)

---

**© 2025 مدير الطباعة - جميع الحقوق محفوظة**
