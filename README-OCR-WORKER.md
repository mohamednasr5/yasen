# 📄 Print Manager - OCR Worker

ميزة استخراج النصوص من المستندات باستخدام الذكاء الاصطناعي

## 🚀 المميزات

- **استخراج النصوص العربية والإنجليزية** بدقة عالية
- **دعم نماذج الرؤية (Vision)** عبر OpenRouter API
- **معالجة الصور** بتنسيقات متعددة (JPEG, PNG, WebP)
- **إرجاع البيانات** كنص عادي أو JSON منظم
- **تكامل مع R2** لتخزين الملفات (اختياري)

## 📋 المتطلبات

1. حساب على [Cloudflare](https://cloudflare.com)
2. حساب على [OpenRouter](https://openrouter.ai) مع API Key
3. R2 Bucket (اختياري - للتخزين)

## ⚙️ الإعداد

### 1. الحصول على مفتاح OpenRouter API

1. اذهب إلى [openrouter.ai/keys](https://openrouter.ai/keys)
2. سجّل الدخول (أو أنشئ حساب جديد)
3. أنشئ مفتاح API جديد
4. نسّخ المفتاح

### 2. إعداد Worker على Cloudflare

```bash
# تثبيت Wrangler CLI
npm install -g wrangler

# تسجيل الدخول
wrangler login

# إنشاء R2 Bucket (اختياري)
wrangler r2 bucket create orders

# إعداد مفتاح API
wrangler secret put OPENROUTER_API_KEY
# الصق المفتاح هنا واضغط Enter

# نشر Worker
wrangler deploy --config wrangler-ocr.toml
```

### 3. تهيئة المتغيرات البيئية

في لوحة تحكم Cloudflare:

1. اذهب إلى Workers & Pages
2. اختر Worker
3. Settings → Variables
4. أضف المتغيرات:
   - `OPENROUTER_API_KEY`: مفتاحك من OpenRouter

## 🔌 نقاط النهاية (Endpoints)

### POST `/ocr` - استخراج النص من صورة

**الطلب:**
```
POST /ocr
Content-Type: multipart/form-data

file: [صورة المستند]
type: ocr (اختياري)
```

**الاستجابة الناجحة:**
```json
{
  "success": true,
  "text": "النص المستخرج من الصورة...",
  "json": null,
  "language": "arabic",
  "confidence": "high",
  "model": "qwen/qwen-2.5-vl-7b-instruct",
  "processedAt": "2025-01-15T10:30:00.000Z"
}
```

### POST `/upload` - رفع ملف إلى R2

**الطلب:**
```
POST /upload
Content-Type: multipart/form-data

file: [الملف]
side: front/back (اختياري)
```

**الاستجابة:**
```json
{
  "success": true,
  "url": "https://pub-xxx.r2.dev/uploads/file.jpg",
  "key": "uploads/front_1234567890_abc123.jpg"
}
```

### GET `/health` - فحص حالة الخدمة

**الاستجابة:**
```json
{
  "status": "ok",
  "service": "OCR Worker",
  "endpoints": ["/ocr", "/upload", "/health"]
}
```

## 🤖 النموذج المستخدم

**Qwen2.5-VL-7B-Instruct**

- نموذج رؤية متعدد اللغات
- يدعم العربية والإنجليزية و+20 لغة أخرى
- دقة عالية في قراءة المستندات
- يدعم الجداول والمستندات المعقدة

## 💰 التكاليف

### OpenRouter Pricing
- Qwen2.5-VL-7B: ~$0.35 / 1M tokens (مدعوم)
- [عرض الأسعار الكامل](https://openrouter.ai/models/qwen/qwen-2.5-vl-7b-instruct)

### Cloudflare
- Workers: 100,000 طلب/يوم مجاناً
- R2 Storage: 10 GB مجانية شهرياً

## 🔧 الاستخدام في التطبيق

التطبيق يتصل تلقائياً بالـ Worker عبر:

```javascript
const workerUrl = 'https://orders.usastud42.workers.dev';

// استخراج النص
const response = await fetch(workerUrl + '/ocr', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result.text); // النص المستخرج
```

## 🛡️ الأمان

- يتم إرسال المفتاح عبر Environment Variables (not in code)
- CORS مفعّل للمتصفحات
- التحقق من نوع وحجم الملف
- حد أقصى 10MB للصور

## 🐛 استكشاف الأخطاء

### خطأ "API key not configured"
→ تأكد من إضافة `OPENROUTER_API_KEY` في متغيرات Worker

### خطأ "File too large"
→ الحد الأقصى 10MB - قلل جودة الصورة

### استجابة فارغة
→ تأكد من أن الصورة تحتوي على نص واضح

## 📞 الدعم

- [OpenRouter Documentation](https://openrouter.ai/docs)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Qwen2.5-VL Model Card](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)

---

**المطور**: المهندس محمد حماد  
**الإصدار**: 1.0.0  
**آخر تحديث**: 2025
