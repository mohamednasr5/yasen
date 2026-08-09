# 📦 ID Card R2 Upload Worker
## Cloudflare Worker لرفع صور البطاقات على R2

---

## 📁 محتويات الملف المضغوط

```
idcard-r2-worker.zip
├── worker-r2.js      ← كود الـ Worker الرئيسي
├── wrangler.toml     ← إعدادات النشر وربط R2
└── README-WORKER.md  ← هذا الملف (التعليمات)
```

---

## 🚀 طريقة النشر

### الطريقة الأولى: باستخدام Wrangler CLI (أسهل)

```bash
# 1. فك الضغط
unzip idcard-r2-worker.zip

# 2. ثبت Cloudflare Wrangler
npm install -g wrangler

# 3. سجّن دخولك في Cloudflare
wrangler login

# 4. أنشئ R2 Bucket (إذا لم يكن موجوداً)
wrangler r2 bucket create orders

# 5. فعّل الوصول العام للصور
wrangler r2 bucket allow-access orders --public

# 6. انشر الـ Worker
cd idcard-r2-worker
wrangler deploy
```

### الطريقة الثانية: من Cloudflare Dashboard

1. اذهب إلى [Cloudflare Dashboard](https://dash.cloudflare.com)
2. اختر **Workers & Pages** → **Create Application** → **Create Worker**
3. اسمِّه: `orders`
4. **الصق محتوى `worker-r2.js`** في المحرر
5. اضغط **Deploy**
6. بعد النشر، اذهب لـ **Settings** → **Bindings**
7. اضف **R2 Bucket Binding**:
   - Variable name: `R2_BUCKET`
   - Bucket: اختر `orders` (أو أنشئ واحد جديد)
8. اضغط **Deploy** مرة أخرى

---

## ⚙️ الإعدادات في wrangler.toml

```toml
name = "orders"
main = "worker-r2.js"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "orders"
```

---

## 🔗 نقاط النهاية (Endpoints)

| العملية | Method | URL |
|---------|--------|-----|
| رفع صورة | POST | `https://orders.usastud42.workers.dev/upload` |

### هيكل الطلب (Request):

```http
POST /upload HTTP/1.1
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="file"; filename="photo.jpg"
Content-Type: image/jpeg

<binary image data>
--boundary
Content-Disposition: form-data; name="side"

front
--boundary--
```

### الاستجابة الناجحة (Response):

```json
{
  "success": true,
  "url": "https://pub-edc4c80125a74d37b7f5fbdb576a4ecf.r2.dev/idcards/front_1704067200000_abc123.jpg",
  "filename": "idcards/front_1704067200000_abc123.jpg",
  "side": "front",
  "size": 2456789,
  "type": "image/jpeg",
  "timestamp": 1704067200000
}
```

### استجابة الخطأ:

```json
{
  "error": "Invalid file type: application/pdf. Only images are allowed."
}
```

---

## ✅ الميزات

- ✅ رفع صور (JPEG, PNG, WebP, GIF) فقط
- ✅ تحديد الحجم الأقصى: 10MB
- ✅ توليد أسماء فريدة تلقائياً
- ✅ دعم CORS للطلبات المتقاطعة
- ✅ رابط عام مباشر بعد الرفع
- ✅ تسجيل بيانات التعريف (metadata)

---

## 🔒 الأمان

- التحقق من نوع الملف (MIME type)
- تحديد الحجم الأقصى
- أسماء ملفات عشوائية (منع التعارض)
- CORS مُعدّ للمصادر الموثوقة فقط

---

## 🧪 الاختبار

```bash
# اختبار مع curl
curl -X POST https://orders.usastud42.workers.dev/upload \
  -F "file=@test-image.jpg" \
  -F "side=front"

# أو اختبار من المتصفح
# افتح Console في DevTools وألصق:
fetch('https://orders.usastud42.workers.dev/upload', {
  method: 'POST',
  body: (() => {
    const fd = new FormData();
    fd.append('file', document.querySelector('img').src);
    fd.append('side', 'front');
    return fd;
  })()
}).then(r => r.json()).then(console.log);
```

---

## 📊 بنية التخزين في R2

```
orders (Bucket)
└── idcards/
    ├── front_1704067200000_a1b2c3.jpg    ← وجه البطاقة
    ├── back_1704067201500_d4e5f6.jpg     ← ضهر البطاقة
    ├── front_1704070800000_g7h8i9.png
    └── back_1704070802000_j0k1l2.webp
```

---

## 🛠️ استكشاف الأخطاء وإصلاحها

| المشكلة | الحل |
|---------|------|
| `R2_BUCKET binding not configured` | تأكد من إضافة Binding في Settings |
| `405 Method not allowed` | استخدم POST وليس GET |
| `File too large` | الحد الأقصى 10MB - قلّل حجم الصورة |
| `Invalid file type` | يُسمح بالصور فقط (JPEG, PNG, WebP, GIF) |
| CORS error | تأكد من إعدادات CORS في الكود |

---

## 📞 الدعم

- **Worker URL**: https://orders.usastud42.workers.dev
- **R2 Public URL**: https://pub-edc4c80125a74d37b7f5fbdb576a4ecf.r2.dev
- **Bucket Name**: orders

---

## 📝 الترخيص

هذا الـ Worker جزء من مشروع **مدير الطباعة** - برمجة وتطوير: المهندس محمد حماد

---

© 2025 - جميع الحقوق محفوظة
