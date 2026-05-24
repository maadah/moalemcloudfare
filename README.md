# 📝 المصحح الذكي - Smart Grader

تطبيق ويب لتصحيح أوراق الطلاب آلياً باستخدام نموذج **Kimi (Moonshot AI)** للذكاء الاصطناعي مع دعم رؤية الصور.

---

## 🚀 النشر على Cloudflare Pages (الطريقة الموصى بها)

### الخطوة 1: ارفع المشروع على GitHub

```bash
cd smart-grader
git init
git add .
git commit -m "Initial commit - Smart Grader with Kimi"
git branch -M main
git remote add origin https://github.com/USERNAME/smart-grader.git
git push -u origin main
```

> ⚠️ **مهم:** ملف `.env` و `.env.local` مستثناة في `.gitignore` — لن تُرفع المفاتيح إلى GitHub.

### الخطوة 2: اربط المشروع بـ Cloudflare Pages

1. اذهب إلى [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. اختر مستودع GitHub الخاص بك (`smart-grader`).
3. في إعدادات البناء (**Build settings**):

   | الحقل | القيمة |
   |---|---|
   | **Framework preset** | None (أو Vite) |
   | **Build command** | `npm run build` |
   | **Build output directory** | `dist` |
   | **Root directory** | (اتركه فارغاً) |

### الخطوة 3: أضف متغيرات البيئة (Environment Variables)

في **Settings → Environment variables → Production**، أضف هذه المتغيرات:

| اسم المتغير | القيمة | إلزامي؟ |
|---|---|---|
| `MOONSHOT_API_KEY` | مفتاحك من [platform.moonshot.ai](https://platform.moonshot.ai/console/api-keys) (يبدأ بـ `sk-`) | ✅ نعم |
| `VITE_FIREBASE_PROJECT_ID` | معرّف مشروع Firebase | ✅ نعم |
| `VITE_FIREBASE_APP_ID` | App ID من Firebase | ✅ نعم |
| `VITE_FIREBASE_API_KEY` | Firebase Web API Key | ✅ نعم |
| `VITE_FIREBASE_AUTH_DOMAIN` | مثل: `myapp.firebaseapp.com` | ✅ نعم |
| `VITE_FIREBASE_STORAGE_BUCKET` | مثل: `myapp.appspot.com` | ✅ نعم |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | رقم Sender ID | ✅ نعم |
| `VITE_FIREBASE_DATABASE_ID` | معرّف قاعدة البيانات (غالباً `(default)`) | ✅ نعم |
| `KIMI_API_KEY` | مفتاح Kimi احتياطي (لتدوير المفاتيح) | اختياري |
| `OPENROUTER_API_KEY` | بديل عن Moonshot المباشر (يبدأ بـ `sk-or-`) | اختياري |

> 💡 **ملاحظة:** المتغيرات التي تبدأ بـ `VITE_` تُضمَّن في كود الواجهة (frontend). أما `MOONSHOT_API_KEY` و `KIMI_API_KEY` فتبقى سرية في الخادم (Pages Functions).

### الخطوة 4: انشر

اضغط **Save and Deploy**. سيتم البناء والنشر تلقائياً خلال 1-2 دقيقة.

---

## 🔧 كيف يعمل النظام (Architecture)

```
المتصفح (React + Vite, مُقدَّم من Cloudflare Pages CDN)
       │
       │ POST /api/gemini/extract
       │ POST /api/gemini/grade
       │ GET  /api/gemini/test-connection
       ▼
Cloudflare Pages Functions  (مجلد functions/)
   - تقرأ MOONSHOT_API_KEY من Environment Variables
   - تستدعي Kimi API على api.moonshot.ai
       │
       │ POST https://api.moonshot.ai/v1/chat/completions
       │ Authorization: Bearer sk-...
       ▼
Kimi (Moonshot AI) — نموذج kimi-k2.6
   - يفهم الصور (Vision)
   - يستخرج الأسئلة ويصحح إجابات الطلاب
```

### المسارات (Routes)

| المسار | الطريقة | الوظيفة |
|---|---|---|
| `/api/health` | GET | فحص حالة الخادم |
| `/api/gemini/test-connection` | GET | اختبار اتصال مفاتيح API |
| `/api/gemini/extract` | POST | استخراج الأسئلة من صور ورقة واحدة |
| `/api/gemini/extract-dual` | POST | استخراج الأسئلة + الأجوبة النموذجية من ورقتين |
| `/api/gemini/grade` | POST | تصحيح ورقة طالب |
| `/api/gemini/grade-math-direct` | POST | تصحيح رياضيات مباشر |

> 📌 **سبب بقاء `/api/gemini/...`:** للحفاظ على التوافق مع كود الواجهة الموجود. التطبيق الآن يستخدم Kimi خلف الكواليس.

---

## 🛠️ التشغيل محلياً (Local Development)

### المتطلبات
- Node.js 18+ 
- npm

### الخطوات

```bash
# 1. ثبّت الحزم
npm install

# 2. أنشئ ملف .env.local وضع المفاتيح فيه
cp .env.example .env.local
# ثم حرّر .env.local وضع مفاتيحك الحقيقية

# 3. شغّل الواجهة فقط (بدون Functions)
npm run dev
```

> ⚠️ **ملاحظة:** `npm run dev` يشغّل Vite للواجهة فقط. لاختبار Pages Functions محلياً تحتاج Wrangler:

```bash
# ثبّت Wrangler عالمياً
npm install -g wrangler

# ابنِ المشروع أولاً
npm run build

# شغّل Pages محلياً مع Functions
wrangler pages dev dist --compatibility-date=2024-01-01
```

---

## 🎨 تخصيص نموذج Kimi

النموذج الافتراضي: **`kimi-k2.6`** (يدعم رؤية الصور، 256K context).

لتغيير النموذج، حرّر ملف `functions/_shared/kimi.ts`:

```ts
export const DEFAULT_KIMI_MODEL = "kimi-k2.6";  // غيّر هنا
```

النماذج المتاحة على Moonshot:
- `kimi-k2.6` ← **الموصى به** (الأحدث، رؤية ممتازة)
- `kimi-k2.5`
- `moonshot-v1-128k-vision-preview`

أو إذا كنت تستخدم OpenRouter:
- `moonshotai/kimi-k2`

---

## 🔄 التبديل بين Moonshot و OpenRouter

النظام يكتشف المزود تلقائياً من شكل المفتاح:
- مفتاح يبدأ بـ `sk-or-` → OpenRouter
- مفتاح يبدأ بـ `sk-` (أي شيء آخر) → Moonshot المباشر

---

## ❓ استكشاف الأخطاء

### "⚠️ لم يتم العثور على أي مفتاح Kimi/Moonshot API صالح"
- تأكد من إضافة `MOONSHOT_API_KEY` في **Settings → Environment variables → Production** على Cloudflare.
- المفتاح يجب أن يبدأ بـ `sk-`.
- بعد إضافة المتغير، **أعد النشر** (Re-deploy) لأن المتغيرات تُحقن وقت البناء/التشغيل.

### "⚠️ مفتاح Kimi/Moonshot API غير صالح"
- تحقق من المفتاح في [platform.moonshot.ai/console/api-keys](https://platform.moonshot.ai/console/api-keys).
- تأكد أن حسابك ليس مُعطّلاً وأن لديك رصيداً.

### الواجهة تعمل لكن `/api/...` يُعيد 404
- تأكد أن مجلد `functions/` موجود في جذر المستودع.
- في Cloudflare Pages: **Settings → Functions** يجب أن يكون مُفعّلاً (افتراضياً).

### "Module not found: '@google/genai'"
- شغّل `npm install` مرة أخرى. الحزمة أُزيلت بالكامل من `package.json`.

---

## 📂 بنية المشروع

```
smart-grader/
├── functions/                      ← Cloudflare Pages Functions
│   ├── _shared/
│   │   ├── kimi.ts                ← منطق استدعاء Kimi API
│   │   ├── exam-helpers.ts        ← أدوات JSON والأسئلة
│   │   └── grading.ts             ← منطق التصحيح (رياضيات + قياسي)
│   └── api/
│       ├── health.ts              ← GET /api/health
│       └── gemini/
│           ├── extract.ts         ← POST /api/gemini/extract
│           ├── extract-dual.ts    ← POST /api/gemini/extract-dual
│           ├── grade.ts           ← POST /api/gemini/grade
│           ├── grade-math-direct.ts
│           └── test-connection.ts ← GET /api/gemini/test-connection
├── src/
│   ├── App.tsx                    ← واجهة React الرئيسية
│   ├── main.tsx
│   ├── firebase.ts
│   ├── index.css
│   └── services/
│       └── geminiService.ts       ← (الاسم محفوظ للتوافق - يتصل الآن بـ Kimi)
├── public/
│   └── _redirects                 ← SPA fallback لـ Cloudflare
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.example
└── .gitignore
```

---

## 🔐 ملاحظات أمنية

1. **لا ترفع `.env` إلى GitHub أبداً.** ملف `.gitignore` يحميك.
2. مفتاح `MOONSHOT_API_KEY` يبقى في الخادم فقط (Pages Functions) — لن يصل للمتصفح.
3. متغيرات `VITE_FIREBASE_*` تظهر في كود الواجهة (وهذا طبيعي لـ Firebase Web). أمّن قواعد Firestore بدلاً من إخفاء المفاتيح.

---

تم النقل من Gemini إلى Kimi بنجاح. ✅
