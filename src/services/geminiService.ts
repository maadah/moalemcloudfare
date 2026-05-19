import { GoogleGenAI, Type } from "@google/genai";

export interface Question {
  id: string;
  text: string;
  answer: string;
  grade: number;
  type: 'text' | 'true-false' | 'multiple-choice' | 'fill-in-the-blanks';
  options?: string[];
  subQuestions?: Question[];
  requiredSubCount?: number;
  subStyle?: 'numbers' | 'letters';
  questionImage?: string;
  answerImage?: string;
}

export interface GradingResult {
  questionId: string;
  studentAnswer: string;
  studentFinalResult?: string;
  studentAnswerNormalized?: string;
  studentFinalResultNormalized?: string;
  questionKey?: string;
  displayLabel?: string;
  status?: 'graded' | 'unanswered' | 'skipped';
  grade: number;
  maxGrade?: number;
  confidence?: number;
  needsReview?: boolean;
  isStudentAnswerCopiedFromModelRisk?: boolean;
  feedback: string;
  box?: [number, number, number, number];
  pageIndex?: number;
}

// ✅ الموديل الأساسي — يمكن تغييره من Netlify عبر VITE_GEMINI_MODEL
// عند 503 يتحول تلقائياً لموديل احتياطي أقل ضغطاً
const GEMINI_MODEL = (import.meta.env?.VITE_GEMINI_MODEL || 'gemini-2.5-flash').trim();
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-1.5-flash'];

// ✅ تحميل كل مفاتيح API المتاحة (مفتاحين + localStorage كاحتياط)
const getApiKeys = (): string[] => {
  // ملاحظة: متغيرات VITE_* تُحقن وقت البناء فقط.
  // في Netlify يجب عمل Clear cache and deploy بعد إضافة المفاتيح.
  const env = import.meta.env || {};

  const candidates = [
    env.VITE_GEMINI_API_KEY,
    env.VITE_GEMINI_API_KEY_2,
    typeof localStorage !== 'undefined' ? localStorage.getItem('GEMINI_API_KEY_FALLBACK') : '',
  ];

  const cleaned = candidates
    .filter((k): k is string =>
      typeof k === 'string' &&
      k.trim() !== '' &&
      k.trim().toLowerCase() !== 'undefined' &&
      k.trim().toLowerCase() !== 'null'
    )
    .map((k) => k.trim());

  console.log('Gemini env check:', {
    hasViteKey1: Boolean(env.VITE_GEMINI_API_KEY),
    hasViteKey2: Boolean(env.VITE_GEMINI_API_KEY_2),
    loadedCount: cleaned.length,
    model: GEMINI_MODEL,
  });

  return cleaned;
};

const getApiKeyErrorMessage = () => {
  const isNetlify = typeof window !== 'undefined' && window.location.hostname.includes('netlify.app');
  if (isNetlify) {
    return 'مفتاح API غير مضبوط. إذا كنت تستخدم Netlify، أضف VITE_GEMINI_API_KEY و VITE_GEMINI_API_KEY_2 ثم نفّذ Clear cache and deploy.';
  }
  return 'مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) في الأعلى وإدخال مفتاح Gemini API للمتابعة.';
};

// ✅ تحديد متى نبدّل المفتاح: فقط عند أخطاء المفتاح نفسه أو تجاوز الحصة
const isRetryableError = (error: any): boolean => {
  const status = error?.status || error?.httpStatus;
  const message = String(error?.message || '').toLowerCase();
  return (
    status === 401 ||   // Unauthorized
    status === 403 ||   // Forbidden
    status === 404 ||   // Model not found / no longer available
    status === 429 ||   // Rate limit
    status === 503 ||   // Service unavailable
    message.includes('api key') ||
    message.includes('quota') ||
    message.includes('invalid key') ||
    message.includes('permission denied') ||
    message.includes('high demand') ||
    message.includes('unavailable') ||
    message.includes('model not found') ||
    message.includes('no longer available') ||
    message.includes('not found')
  );
};

// ✅ تأخير بسيط قبل إعادة المحاولة
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ✅ Error class خاص يحمل نوع الخطأ — يستخدمه الـ UI لعرض رسائل مناسبة
export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly type: 'server_busy' | 'invalid_key' | 'quota_exceeded' | 'unknown',
    public readonly retriedModels?: string[]
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

// ✅ هل الخطأ بسبب ازدحام الخادم فقط (503) وليس مشكلة في المفتاح؟
const isServerBusyError = (error: any): boolean => {
  const status = error?.status || error?.httpStatus;
  const message = String(error?.message || '').toLowerCase();
  return (
    status === 503 ||
    message.includes('high demand') ||
    message.includes('unavailable') ||
    message.includes('overloaded')
  );
};

async function generateWithGeminiFallback(request: any) {
  const apiKeys = getApiKeys();

  if (apiKeys.length === 0) {
    throw new Error(getApiKeyErrorMessage());
  }

  // قائمة الموديلات بالترتيب: الأساسي أولاً ثم الاحتياطية
  const modelsToTry = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];

  let lastError: any = null;

  for (const model of modelsToTry) {
    // المرحلة 1: جرّب كل المفاتيح مع هذا الموديل
    for (let i = 0; i < apiKeys.length; i++) {
      try {
        const ai = new GoogleGenAI({ apiKey: apiKeys[i] });
        const result = await ai.models.generateContent({ ...request, model });
        if (model !== GEMINI_MODEL) {
          console.warn(`✅ نجح الموديل الاحتياطي: ${model}`);
        }
        return result;
      } catch (error: any) {
        lastError = error;
        console.warn(`⚠️ فشل [${model}] مفتاح ${i + 1}:`, error?.message || error);

        if (!isRetryableError(error)) {
          throw error; // خطأ في البيانات أو الكود — توقف فوراً
        }
      }
    }

    // المرحلة 2: إذا الخطأ ازدحام خادم — انتظر ثم أعد مع نفس الموديل مرة واحدة
    if (isServerBusyError(lastError)) {
      console.warn(`🔄 [${model}] خادم مشغول، انتظار 5 ثوانٍ قبل الموديل التالي...`);
      await sleep(5000);

      for (let i = 0; i < apiKeys.length; i++) {
        try {
          const ai = new GoogleGenAI({ apiKey: apiKeys[i] });
          return await ai.models.generateContent({ ...request, model });
        } catch (error: any) {
          lastError = error;
          if (!isRetryableError(error)) throw error;
        }
      }
    }

    // إذا وصلنا هنا والموديل الحالي فشل تماماً → جرّب الموديل التالي
    if (model !== modelsToTry[modelsToTry.length - 1]) {
      console.warn(`⏭️ التحول للموديل التالي بعد فشل: ${model}`);
    }
  }

  // تحديد نوع الخطأ النهائي لعرض رسالة مناسبة في الواجهة
  const lastStatus = lastError?.status || lastError?.httpStatus;
  const lastMsg = String(lastError?.message || '').toLowerCase();

  if (lastStatus === 503 || lastMsg.includes('high demand') || lastMsg.includes('unavailable')) {
    throw new GeminiError(
      'الخوادم مشغولة حالياً بسبب الطلب العالي. يرجى المحاولة مجدداً بعد لحظات.',
      'server_busy',
      modelsToTry
    );
  }

  if (lastStatus === 401 || lastStatus === 403 || lastMsg.includes('api key') || lastMsg.includes('invalid key')) {
    throw new GeminiError(
      'مفتاح API غير صالح أو محظور. يرجى التحقق من المفتاح في الإعدادات.',
      'invalid_key'
    );
  }

  if (lastStatus === 404 || lastMsg.includes('no longer available') || lastMsg.includes('model not found')) {
    throw new GeminiError(
      'الموديل المستخدم غير متاح. جاري التحويل للموديل الاحتياطي تلقائياً — حاول مجدداً.',
      'server_busy',
      modelsToTry
    );
  }

  if (lastStatus === 429 || lastMsg.includes('quota')) {
    throw new GeminiError(
      'تم تجاوز حصة الاستخدام لهذا المفتاح. يرجى الانتظار أو استخدام مفتاح آخر.',
      'quota_exceeded'
    );
  }

  throw new GeminiError(
    `فشلت جميع المحاولات. آخر خطأ: ${lastError?.message || lastError}`,
    'unknown'
  );
}

const cleanJson = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

export async function extractExamFromDualImages(
  questionImages: string[],
  answerImages: string[]
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const qImagesData = await Promise.all(questionImages.map(async (base64) => {
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1500, 1500, 0.7);
    }));

    const aImagesData = await Promise.all(answerImages.map(async (base64) => {
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1500, 1500, 0.7);
    }));

    const prompt = `أنت معلم خبير يقرأ ورقة طالب من الصورة ويصححها في نفس الطلب.

الفكرة الأساسية:
- نريد "نقل جواب الطالب كما هو" و "تقييمه" في نفس الوقت.
- لكن studentAnswer ليس مكان التصحيح ولا الإصلاح.
- التصحيح والتفسير يكونان فقط داخل feedback والدرجة.

المطلوب:
صحح ورقة الطالب كاملة مرة واحدة اعتماداً على:
1) صورة ورقة الطالب.
2) قائمة الأسئلة.
3) الأجوبة النموذجية.
4) الدرجة المحددة لكل سؤال.

قواعد نقل جواب الطالب — أهم جزء:
- studentAnswer = نقل مباشر لما كتبه الطالب فقط من الصورة.
- ممنوع إصلاح جواب الطالب داخل studentAnswer.
- ممنوع استبدال جواب الطالب بالجواب الصحيح.
- ممنوع نقل الإجابة النموذجية إلى studentAnswer.
- إذا كتب الطالب نتيجة خاطئة، اكتبها كما هي، ولا تصححها في studentAnswer.
- إذا كتب الطالب: ٢٧ + ١٤ = ٤١ فاكتبها كما هي، ولا تحولها إلى ٢٧ - ١٤ = ١٣.
- إذا كتب الطالب: ٣ × (-١٧) = -٤١ فاكتبها كما هي، ولا تحولها إلى -٥١.
- إذا لم تستطع قراءة رقم أو رمز، اكتب [?] واجعل needsReview=true.
- حافظ على شكل أرقام الطالب قدر الإمكان داخل studentAnswer: ٤٨ تبقى ٤٨ وليس 48.
- studentAnswerNormalized و studentFinalResultNormalized فقط للمقارنة، وليس للعرض.

قواعد مصدر القراءة:
- الصورة هي المصدر الأساسي لجواب الطالب.
- اقرأ الورقة مباشرة من الصورة، وليس من الإجابة النموذجية.
- لا تخترع جواباً إذا لم تجده في الصورة.
- لا تنقل جواب سؤال إلى سؤال آخر.
- إذا لم يجب الطالب على سؤال، اجعل studentAnswer = "" و status = "unanswered" و grade = 0.
- إذا كان له حق ترك، اجعل status = "skipped" و feedback = "حق الترك".

طريقة التصحيح العامة لكل المواد:
- افهم السؤال أولاً.
- قارن ما كتبه الطالب بفكرة الإجابة النموذجية.
- أعط درجة عادلة حسب مستوى جواب الطالب.
- feedback يشرح التقييم فقط، ولا يغيّر studentAnswer.

تمييز نوع السؤال أثناء التصحيح:
1) إذا كان السؤال نصياً أو مسألة فيها كلام ومعطيات:
   - اقرأ نص السؤال جيداً وافهم المطلوب.
   - لا تعتمد على الناتج النهائي وحده.
   - قيّم هل الطالب استخدم المعطيات الصحيحة وهل طريقته مناسبة.
   - إذا استخدم الطالب رقماً خطأ من نص السؤال، اذكر ذلك في feedback.

2) إذا كان السؤال مباشراً وليس مسألة نصية طويلة، مثل عملية حسابية أو معادلة أو اختيار أو تعريف قصير:
   - انظر إلى الجواب النهائي للطالب أولاً.
   - إذا كان الجواب النهائي يطابق الجواب النموذجي في المعنى أو القيمة، أعطه الدرجة المناسبة.
   - إذا كان الجواب النهائي لا يطابق، لا تجعله صحيحاً.
   - عند الخطأ، قارن خطوات الطالب مع الإجابة النموذجية لتعرف سبب الخطأ واكتبه في feedback.
   - لا تضع الحل الصحيح داخل studentAnswer، بل داخل feedback فقط إذا احتجت.

أمثلة لفهم القاعدة، ليست خاصة بالرياضيات فقط:
- إذا كان النموذجي يقول الناتج ١٣ والطالب كتب ٤١، فـ studentAnswer يجب أن يحتوي ٤١ كما كتبها الطالب، والfeedback يشرح سبب الخطأ.
- إذا كان النموذجي يقول -٥١ والطالب كتب -٤١، فـ studentAnswer يبقى -٤١، ولا تعتبره صحيحاً.
- إذا كانت المسألة النصية تتطلب استخدام ١٢ والطالب استخدم ١٠، اذكر أن الخطأ في فهم أو استخراج المعطى.
- إذا كان جواب الطالب صحيحاً لكن بصيغة مختلفة، أعطه الدرجة ولا تشترط التطابق الحرفي.

قواعد حدود السؤال:
- افهم بنية الورقة: سؤال رئيسي ← فرع ← نقطة.
- لا تعتبر الرقم المنفرد ١ أو ٢ أو ٣ سؤالاً رئيسياً إذا كان داخل فرع أو تحت عنوان فرع.
- السؤال الرئيسي غالباً يكون معه: س، سؤال، السؤال، مثل: س1، س١، س1/، س1:، س1)، سؤال 1.
- الفروع قد تكتب: أ، أ/، أ-، أ)، أ:، (أ)، وكذلك ب، ج، د.
- النقاط داخل الفرع قد تكتب: 1، ١، 1/، ١/، 1-، ١-، 1)، ١).
- جواب السؤال يجب أن يكون داخل حدوده أو يحمل label واضحاً يربطه به.
- إذا كتب الطالب جواباً في مكان آخر ومعه label واضح مثل س4/ب، اربطه بالسؤال الصحيح.
- إذا الجواب بعيد ولا يوجد label واضح، لا تخمّن؛ اجعله unanswered أو needsReview ولا تملأ studentAnswer.
- عند الشك بين "سؤال فارغ" و"جواب محتمل بعيد" اختر الأمان: unanswered + needsReview، لا تخترع إجابة.


اختبار أمان قبل إخراج JSON:
- لكل سؤال، اسأل نفسك: هل أرى كتابة الطالب لهذا السؤال في الصورة؟
- إذا الجواب لا: studentAnswer=""، status="unanswered"، grade=0.
- إذا كان studentAnswer يشبه الإجابة النموذجية لكنك لا ترى نفس الكتابة في ورقة الطالب، احذفه واجعله unanswered.
- إذا كتبت حلاً صحيحاً من عندك داخل studentAnswer، فهذا خطأ؛ احذفه.
- feedback هو المكان الوحيد للتصحيح وشرح الصواب، وليس studentAnswer.

قواعد حق الترك:
- إذا كان السؤال يطلب عدداً محدداً من الفروع فقط، صحح الفروع التي أجاب عنها الطالب ضمن المطلوب.
- لا تضع حق الترك على فرع أجاب عنه الطالب.
- الفروع الفارغة الزائدة عن المطلوب اجعلها skipped "حق الترك".
${skipInfo}

بيانات الامتحان:
المادة: ${subject}
عدد الأسئلة المطلوب تصحيحها: ${flattenedQuestions.length}
الدرجة الكلية: ${totalExamGrade}
عدد الأسئلة المطلوبة إن وجد: ${requiredQuestionsCount || 'All'}

الأسئلة والأجوبة النموذجية:
${JSON.stringify(flattenedQuestions.map((q: any) => ({
  id: q.id,
  questionKey: q.questionKey || q.label,
  displayLabel: q.displayLabel || q.label,
  text: q.text,
  modelAnswer: q.answer,
  maxGrade: q.grade,
  type: q.type
})), null, 2)}

قبل إخراج JSON راجع نفسك:
- هل studentAnswer من ورقة الطالب فقط؟
- هل لم تنسخ الإجابة النموذجية؟
- هل إذا كان جواب الطالب خاطئاً بقي خاطئاً داخل studentAnswer؟
- هل وضعت التصحيح في feedback وليس في studentAnswer؟

أرجع JSON فقط:
{
  "results": [
    {
      "studentName": "طالب غير معروف",
      "gradings": [
        {
          "questionId": "same id from questions",
          "questionKey": "same questionKey from questions",
          "displayLabel": "same displayLabel from questions",
          "studentAnswer": "نقل مباشر لما كتبه الطالب فقط، بدون إصلاح",
          "studentAnswerNormalized": "نسخة مطبعة للمقارنة فقط",
          "studentFinalResult": "آخر نتيجة كتبها الطالب كما هي",
          "studentFinalResultNormalized": "آخر نتيجة مطبعة للمقارنة فقط",
          "grade": 0,
          "maxGrade": 0,
          "confidence": 0.0,
          "feedback": "تقييم مختصر وسبب الدرجة",
          "status": "graded | unanswered | skipped",
          "needsReview": false,
          "isStudentAnswerCopiedFromModelRisk": false,
          "box": [0, 0, 0, 0],
          "pageIndex": 0
        }
      ]
    }
  ]
}`;

    const parts: any[] = [];
    parts.push({ text: "QUESTIONS IMAGES:" });
    qImagesData.forEach((data) => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: "MODEL ANSWERS IMAGES:" });
    aImagesData.forEach((data) => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await generateWithGeminiFallback({
      contents: { parts },
      config: { 
        responseMimeType: "application/json",
        temperature: 0.1,
        systemInstruction: "You are an expert Iraqi teacher. Extract exam data precisely into JSON. Ensure all numbers, symbols, and mathematical expressions are captured exactly as shown."
      }
    });

    const data = JSON.parse(cleanJson(response.text || '{}'));

    if (data && Array.isArray(data.questions)) {
      data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
    }
    return data || { title: "", questions: [] };
  } catch (error) {
    console.error("Extraction error:", error);
    throw error;
  }
}

export async function extractExamFromImages(base64Images: string[]): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const imagesData = await Promise.all(base64Images.map(async (base64) => {
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1500, 1500, 0.7);
    }));

    const prompt = `Extract questions from this Iraqi exam paper. 
    Output a JSON object with:
    - title: String
    - requiredQuestionsCount: Number
    - questions: Array of objects with {text, grade, answer (leave empty if not found), type}.
    
    CRITICAL: 
    - Preserve Arabic digits (٠-٩). 
    - Nest sub-questions properly.
    - GRADE EXTRACTION: Strictly copy original grades. DO NOT invent or divide grades for sub-questions.
    - IMPORTANT: Clean the 'text' field by removing redundant identifiers (like "س1:", "أ-", "1-") at the beginning of the text IF they are already represented by the structure.
    - If a question has sub-questions, the parent 'text' should be the general instruction only.`;

    const parts: any[] = imagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await generateWithGeminiFallback({
      contents: { parts },
      config: { 
        responseMimeType: "application/json",
        temperature: 0.1,
        systemInstruction: "You are an expert Iraqi teacher. Extract exam data into JSON with high precision. Capture all mathematical formulas and Arabic digits correctly. DO NOT perform arithmetic yourself during extraction; strictly copy exactly what is written on the page or provided in the input. If you see 85/5, DO NOT calculate 17 or 18, just write the expression or the result exactly as it appears."
      }
    });

    const data = JSON.parse(cleanJson(response.text || '{}'));

    if (data && Array.isArray(data.questions)) {
      data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
    }
    return data || { title: "", questions: [] };
  } catch (error) {
    console.error("Extraction error:", error);
    throw error;
  }
}


// ─────────────────────────────────────────────────────────────
// Math grading helpers
// الهدف: لا نعتمد على مقارنة نصية خام، لأن الطالب قد يكتب ٤٨ والمودل يرجع 48.
// studentAnswer يبقى كما كتبه الطالب للعرض، أما الحقول normalized فللمقارنة فقط.
// ─────────────────────────────────────────────────────────────
const arabicIndicDigits = '٠١٢٣٤٥٦٧٨٩';
const easternArabicDigits = '۰۱۲۳۴۵۶۷۸۹';

function normalizeMathText(value: any): string {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(arabicIndicDigits.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabicDigits.indexOf(d)))
    .replace(/[×xX]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/[=＝]/g, '=')
    .replace(/[٫,]/g, '.')
    .replace(/\s+/g, '')
    // تطبيع الاتجاه: إذا بدأت بالناتج (مثل "٢/٧=") اعكسها
    // نستخرج الناتج النهائي بغض النظر عن الاتجاه
    .trim();
}

// استخراج الناتج النهائي من المعادلة بغض النظر عن اتجاه الكتابة
function extractFinalResult(expr: string): string {
  if (!expr) return '';
  const normalized = normalizeMathText(expr);
  const parts = normalized.split('=');
  if (parts.length < 2) return normalized;
  // الناتج إما في أول جزء أو آخر جزء حسب اتجاه الكتابة
  const first = parts[0].trim();
  const last = parts[parts.length - 1].trim();
  // إذا الجزء الأول أقصر → على الأرجح هو الناتج (RTL: النتيجة = المعادلة)
  // إذا الجزء الأخير أقصر → على الأرجح هو الناتج (LTR: المعادلة = النتيجة)
  return last.length <= first.length ? last : first.length < last.length ? first : last;
}



// ─────────────────────────────────────────────────────────────
// Label / hierarchy helpers
// الهدف: منع خلط الرقم الداخلي ٣ مع سؤال رئيسي س٣، وفهم صيغ كتابة الطالب:
// س1/ ، س1: ، سؤال 1 ، أ/ ، أ- ، ١) ... إلخ.
// هذه الدوال تساعد الـ prompt بخريطة aliases، ولا تعتمد وحدها على OCR.
// ─────────────────────────────────────────────────────────────
function toAsciiDigits(value: any): string {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(arabicIndicDigits.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabicDigits.indexOf(d)));
}

function normalizeLabelToken(value: any): string {
  return toAsciiDigits(value)
    .replace(/[ـ\s]+/g, '')
    .replace(/[\(\)\[\]{}:：؛;,.،]/g, '')
    .replace(/[\\|]/g, '/')
    .replace(/[\-–—]+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^سؤال/i, 'س')
    .replace(/^السؤال/i, 'س')
    .trim();
}

function uniqueStrings(items: any[]): string[] {
  return Array.from(new Set(items.map((x) => String(x || '').trim()).filter(Boolean)));
}

function makeQuestionAliases(num: string): string[] {
  const n = toAsciiDigits(num);
  const arabicN = n.replace(/[0-9]/g, (d) => arabicIndicDigits[Number(d)]);
  return uniqueStrings([
    `س${n}`, `س ${n}`, `س/${n}`, `س${n}/`, `س${n}:`, `س${n})`, `(س${n})`,
    `س${arabicN}`, `س ${arabicN}`, `س/${arabicN}`, `س${arabicN}/`, `س${arabicN}:`, `س${arabicN})`, `(س${arabicN})`,
    `سؤال ${n}`, `السؤال ${n}`, `سؤال ${arabicN}`, `السؤال ${arabicN}`
  ]);
}

function makeBranchAliases(letter: string): string[] {
  const l = String(letter || '').trim();
  if (!l) return [];
  return uniqueStrings([
    l, `${l}/`, `${l}-`, `${l})`, `${l}:`, `(${l})`, `فرع ${l}`, `الفرع ${l}`,
  ]);
}

function makePointAliases(num: string): string[] {
  const n = toAsciiDigits(num);
  const arabicN = n.replace(/[0-9]/g, (d) => arabicIndicDigits[Number(d)]);
  return uniqueStrings([
    n, `${n}/`, `${n}-`, `${n})`, `(${n})`, `${n}:`,
    arabicN, `${arabicN}/`, `${arabicN}-`, `${arabicN})`, `(${arabicN})`, `${arabicN}:`,
  ]);
}

function buildLabelAliases(label: string, text: string): string[] {
  const source = `${label || ''} ${text || ''}`;
  const aliases: string[] = [label, normalizeLabelToken(label)];

  const qMatches = Array.from(source.matchAll(/(?:س\s*\/?\s*|سؤال\s*|السؤال\s*)([0-9٠-٩۰-۹]+)/g));
  qMatches.forEach((m) => aliases.push(...makeQuestionAliases(m[1])));

  const branchMatches = Array.from(source.matchAll(/(?:^|[\/\s\-–—\(\[])([أابجدهـهو])(?:[\/\s\-–—\)\]:：]|$)/g));
  branchMatches.forEach((m) => aliases.push(...makeBranchAliases(m[1])));

  const pointMatches = Array.from(source.matchAll(/(?:^|[\/\s\-–—\(\[])([0-9٠-٩۰-۹]+)(?:[\/\s\-–—\)\]:：]|$)/g));
  pointMatches.forEach((m) => aliases.push(...makePointAliases(m[1])));

  return uniqueStrings(aliases).slice(0, 40);
}

function looksLikeCopiedModel(studentAnswer: any, modelAnswer: any): boolean {
  const s = normalizeMathText(studentAnswer);
  const m = normalizeMathText(modelAnswer);
  if (!s || !m || s.length < 4 || m.length < 4) return false;
  return s === m || (s.length > 12 && m.includes(s));
}

function clampGrade(value: any, maxGrade: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(n, Number(maxGrade) || 0));
}

function isFullGrade(grade: number, maxGrade: number): boolean {
  return maxGrade > 0 && grade >= maxGrade;
}

function buildMathAuditNote(g: any, question: any, maxGrade: number): { needsReview: boolean; note: string } {
  if (!question) return { needsReview: Boolean(g.needsReview), note: '' };
  const finalNorm = normalizeMathText(g.studentFinalResultNormalized || g.studentFinalResult || '');
  const modelNorm = normalizeMathText(question.answer || '');

  const copiedRisk = looksLikeCopiedModel(g.studentAnswer, question.answer);
  const suspiciousFullGrade = isFullGrade(Number(g.grade), maxGrade) && finalNorm && modelNorm && !modelNorm.includes(finalNorm);

  const notes: string[] = [];
  if (copiedRisk) notes.push('تنبيه آلي: جواب الطالب يشبه الإجابة النموذجية بشكل مريب، يحتاج مراجعة للتأكد أنه من الورقة.');
  if (suspiciousFullGrade) notes.push('تنبيه آلي: تم إعطاء درجة كاملة رغم أن الناتج النهائي لا يظهر داخل الإجابة النموذجية بعد التطبيع، راجع التصحيح.');

  return {
    needsReview: Boolean(g.needsReview || copiedRisk || suspiciousFullGrade),
    note: notes.join(' ')
  };
}

function guessQuestionMode(q: Question, subject: string): 'direct_math' | 'word_problem' | 'theory' {
  const text = `${q.text || ''} ${q.answer || ''}`;
  const isMathSubject = subject.includes('رياضيات') || subject.toLowerCase().includes('math');
  if (!isMathSubject) return 'theory';
  const hasWords = /(إذا|بلغت|درجة|سرعة|مسافة|زمن|معدل|ينخفض|يزداد|اشترى|باع|عمر|محيط|مساحة|حجم|احسب|أوجد|فأصبحت|الساعة|درجة الحرارة)/.test(text);
  const mathSymbols = /[=+\-−–—×÷*\/^²√]/.test(text) || /[٠-٩0-9]/.test(text);
  if (hasWords && mathSymbols) return 'word_problem';
  if (mathSymbols) return 'direct_math';
  return 'theory';
}

export async function gradeStudentPaper(
  imageUrls: string[],
  questions: Question[],
  totalExamGrade: number,
  requiredQuestionsCount: number,
  subject: string = "عام",
  onProgress?: (current: number, total: number, phase: 'compressing' | 'grading') => void
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  try {
    if (onProgress) onProgress(0, imageUrls.length, 'compressing');

    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      // جودة أعلى لأن التصحيح المباشر من الصورة يعتمد على قراءة الخط والرموز.
      const compressed = await compressImage(imageUrls[i], 2400, 2400, 0.92);
      base64ImagesData.push(compressed);
      if (onProgress) onProgress(i + 1, imageUrls.length, 'compressing');
    }

    const flattenedQuestions: any[] = [];
    const flatten = (qs: Question[], parentText: string = "", path: string = "") => {
      qs.forEach((q, index) => {
        let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
        if (label.length > 15 || label.length === 0) label = `سؤال ${index + 1}`;
        const fullPath = path ? `${path} / ${label}` : label;
        const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;

        if (!q.subQuestions || q.subQuestions.length === 0) {
          flattenedQuestions.push({
            id: q.id,
            label: fullPath,
            questionKey: fullPath,
            displayLabel: fullPath,
            text: combinedText,
            answer: q.answer,
            grade: q.grade,
            type: q.type
          });
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(questions);

    if (onProgress) onProgress(0, 100, 'grading');

    // ─── حساب حق الترك بشكل صحيح ───────────────────────────────────────────
    const parentGroups: Record<string, { requiredCount: number; subIds: string[] }> = {};
    flattenedQuestions.forEach((fq: any) => {
      if (fq.id && fq.id.includes('_')) {
        const parentId = fq.id.split('_').slice(0, -1).join('_');
        if (!parentGroups[parentId]) {
          const findRequired = (qs: Question[], targetId: string): number | null => {
            for (const q of qs) {
              if (q.id === targetId) return q.requiredSubCount ?? null;
              if (q.subQuestions) {
                const r = findRequired(q.subQuestions, targetId);
                if (r !== null) return r;
              }
            }
            return null;
          };
          const req = findRequired(questions, parentId);
          parentGroups[parentId] = { requiredCount: req ?? 0, subIds: [] };
        }
        parentGroups[parentId].subIds.push(fq.id);
      }
    });

    const skipCandidates: Record<string, { parentId: string; totalSubs: number; requiredCount: number }> = {};
    Object.entries(parentGroups).forEach(([parentId, { requiredCount, subIds }]) => {
      if (requiredCount > 0 && requiredCount < subIds.length) {
        subIds.forEach(sid => {
          skipCandidates[sid] = { parentId, totalSubs: subIds.length, requiredCount };
        });
      }
    });

    const skipInfo = Object.keys(skipCandidates).length > 0
      ? `\n\nمعلومات حق الترك:\n${JSON.stringify(skipCandidates, null, 2)}`
      : '';

    if (onProgress) onProgress(10, 100, 'grading');

    // ═══════════════════════════════════════════════════════════
    // صورة مكبّرة للقراءة الدقيقة
    // ═══════════════════════════════════════════════════════════
    const base64ImagesEnlarged: string[] = [];
    for (const url of imageUrls) {
      const enlarged = await compressImage(url, 3200, 3200, 0.95);
      base64ImagesEnlarged.push(enlarged);
    }

    if (onProgress) onProgress(20, 100, 'grading');

    // ═══════════════════════════════════════════════════════════
    // الطلب الأول: قراءة عمياء — بدون modelAnswer
    // النموذج لا يعرف الإجابات الصحيحة → لا يستطيع الاختراع
    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
    // بناء دليل التنسيق — يخفي الناتج النهائي فقط
    // النموذج يرى شكل المعادلة لكن لا يرى الرقم الأخير
    // ═══════════════════════════════════════════════════════════
    const hideLastResult = (answer: string, mode: string): string => {
      if (!answer) return '';
      if (mode === 'theory') return answer.substring(0, 50) + '...';

      // ابحث عن آخر = وما بعده واستبدله بـ ■■■
      // هذا يخفي الناتج النهائي مع إبقاء كل الخطوات ظاهرة
      const lastEqIndex = answer.lastIndexOf('=');
      if (lastEqIndex === -1) {
        // لا يوجد = → أخفِ آخر رقم/كلمة
        return answer.replace(/[\d٠-٩]+\s*$/, '■■■').replace(/\S+\s*$/, '■■■');
      }
      const beforeLast = answer.substring(0, lastEqIndex + 1);
      return `${beforeLast} ■■■`;
    };

    const readingPrompt = `أنت قارئ ورقة امتحان ذكي. مهمتك: نقل ما كتبه الطالب بدقة عالية.

لديك دليل التنسيق لكل سؤال — يُريك شكل الإجابة المتوقعة بدون ناتجها النهائي (■■■).
استخدم دليل التنسيق لـ:
▸ معرفة نوع المعادلة (ضرب؟ قسمة؟ جمع؟)
▸ معرفة عدد الخطوات
▸ تمييز الحروف العربية من الأرقام (ح، ع، م)
▸ معرفة أين يقع الناتج النهائي في المعادلة
لكن: ■■■ يعني أنك لا تعرف الناتج الصحيح — انقل ما تراه في الصورة.

الأسئلة مع دليل التنسيق:
${JSON.stringify(flattenedQuestions.map((q: any) => ({
  id: q.id,
  displayLabel: q.displayLabel || q.label,
  text: q.text,
  answerType: guessQuestionMode(q, subject),
  formatGuide: hideLastResult(q.answer, guessQuestionMode(q, subject))
})), null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
المبدأ الأساسي
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ما تراه في الصورة هو الحقيقة الوحيدة.
لا توجد إجابة صحيحة أو خاطئة بالنسبة لك — فقط ما هو مكتوب.
انقل كل رقم وإشارة كما هو بدون تغيير.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قاعدة الناتج النهائي
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
الكتابة العربية من اليمين لليسار.
الناتج = آخر رقم بعد آخر = في المعادلة.
إذا امتدت على سطرين → الناتج في بداية السطر الثاني.
اتبع سلسلة = من البداية حتى نهايتها.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قواعد تنسيق الورقة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ رقم الفرع: (١ أو ١) أو ١/ في بداية أو نهاية السطر
▸ سطر واحد قد يحتوي فرعين متجاورين
▸ علامة - الطويلة = سهم ← (ليست ناقص)
▸ الإجابة قد تمتد على أكثر من سطر

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قاعدة الفراغ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
إذا لم تجد كتابة الطالب للسؤال → studentAnswer="" و isEmpty=true.
لا تخمّن. إذا شككت → فارغ.

أرجع JSON فقط:
{
  "readings": [
    {
      "questionId": "نفس id",
      "studentAnswer": "ما كتبه الطالب حرفياً — فارغ إذا لم يجد",
      "studentFinalResult": "آخر ناتج في المعادلة كما كتبه الطالب — فارغ إذا لم يجد",
      "isEmpty": false,
      "confidence": 0.95
    }
  ]
}`;

    const readingParts: any[] = [
      ...base64ImagesEnlarged.map((d: string) => ({ inlineData: { data: d, mimeType: "image/jpeg" } })),
      { text: readingPrompt }
    ];

    let readings: any[] = [];
    try {
      const readingResponse = await generateWithGeminiFallback({
        contents: { parts: readingParts },
        config: {
          responseMimeType: "application/json",
          temperature: 0,
          systemInstruction: `أنت قارئ ورقة امتحان ذكي.
لديك دليل التنسيق (formatGuide) لكل سؤال — يُريك شكل المعادلة بدون ناتجها النهائي (■■■).
استخدم formatGuide لفهم التنسيق وتمييز الرموز، لكن الناتج الذي تكتبه يجب أن يأتي من الصورة فقط.
■■■ يعني: لا تعرف الناتج الصحيح → انقل ما تراه في الصورة بدون تغيير.

القاعدة الأولى: ما تراه في الصورة هو الحقيقة — انقله كما هو حتى لو بدا خاطئاً.
القاعدة الثانية: الناتج = آخر رقم بعد آخر = في المعادلة كاملة.
القاعدة الثالثة: إذا لم تر كتابة → studentAnswer="" و isEmpty=true. لا استثناء.`
        }
      });
      const readData = JSON.parse(cleanJson(readingResponse.text || '{}'));
      readings = readData.readings || [];
    } catch {
      readings = [];
    }

    if (onProgress) onProgress(55, 100, 'grading');

    // بناء مدخلات التصحيح من نتائج القراءة
    const readingMap = new Map(readings.map((r: any) => [String(r.questionId), r]));
    const gradingInput = flattenedQuestions.map((q: any) => {
      const r = readingMap.get(String(q.id));
      const isEmpty = !r || r.isEmpty === true || !(r.studentAnswer || '').trim();
      return {
        id: q.id,
        questionKey: q.questionKey || q.label,
        displayLabel: q.displayLabel || q.label,
        text: q.text,
        modelAnswer: q.answer,
        maxGrade: q.grade,
        type: q.type,
        answerType: guessQuestionMode(q, subject),
        studentAnswer: isEmpty ? '' : (r?.studentAnswer || ''),
        studentFinalResult: isEmpty ? '' : (r?.studentFinalResult || ''),
        isEmpty,
        readingConfidence: r?.confidence ?? 0
      };
    });

    // ═══════════════════════════════════════════════════════════
    // الطلب الثاني: تصحيح نصي — بدون صورة
    // النموذج يقارن نصاً بنص فقط → موثوق ومستقر
    // ═══════════════════════════════════════════════════════════
    const scoringPrompt = `أنت مصحح امتحانات خبير. صحّح بناءً على النصوص فقط.

المادة: ${subject} | الدرجة الكلية: ${totalExamGrade}
عدد الأسئلة المطلوبة: ${requiredQuestionsCount || 'الكل'}
${skipInfo}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
تنبيه مهم — اتجاه الكتابة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
جواب الطالب قد يكون مستخرجاً من اليسار لليمين بينما الإجابة النموذجية من اليمين لليسار.
عند المقارنة: تجاهل اتجاه الكتابة تماماً — قارن القيم الرياضية فقط.
مثال: "٢/٣ × ١/٢ × ٦/٧ = ٢/٧" يساوي "٢/٧ = ٤٢ ÷ ٣" رياضياً رغم اختلاف الاتجاه.

إجابات الطالب مع الإجابات النموذجية:
${JSON.stringify(gradingInput, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قواعد التصحيح
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▌ isEmpty=true أو studentAnswer فارغ:
  → grade=0، status="unanswered"، feedback="لم يكتب الطالب إجابة."

▌ حسابي (direct_math):
  قارن studentFinalResult بالناتج الصحيح في modelAnswer رياضياً (بغض النظر عن الاتجاه).
  تطابقا → grade كاملة.
  اختلفا + الطريقة صحيحة → درجة جزئية (50-70%).
  الطريقة خاطئة → grade = 0.

▌ مسألة نصية (word_problem):
  قيّم المعطيات والطريقة والفهم. الفكرة جزئية → درجة جزئية.

▌ نظري (theory):
  قيّم المعنى والمفهوم، لا التطابق الحرفي.

لا تعدّل studentAnswer أو studentFinalResult.
feedback مختصر بالعربية.

أرجع JSON فقط:
{
  "results": [{
    "studentName": "طالب غير معروف",
    "gradings": [{
      "questionId": "نفس id",
      "questionKey": "نفس questionKey",
      "displayLabel": "نفس displayLabel",
      "studentAnswer": "من gradingInput — لا تعدّل",
      "studentAnswerNormalized": "",
      "studentFinalResult": "من gradingInput — لا تعدّل",
      "studentFinalResultNormalized": "",
      "grade": 0,
      "maxGrade": 0,
      "confidence": 0.95,
      "feedback": "تقييم مختصر",
      "status": "graded | unanswered | skipped",
      "needsReview": false,
      "isStudentAnswerCopiedFromModelRisk": false,
      "box": [0,0,0,0],
      "pageIndex": 0
    }]
  }]
}`;

    const response = await generateWithGeminiFallback({
      contents: { parts: [{ text: scoringPrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: `أنت مصحح امتحانات. تعمل على نصوص فقط — لا صور.
إذا isEmpty=true أو studentAnswer فارغ → grade=0 و status="unanswered" بدون نقاش.
لا تعدّل studentAnswer أو studentFinalResult أبداً — انقلهما كما وردا.
feedback مختصر بالعربية فقط.`
      }
    });

    const data = JSON.parse(cleanJson(response.text || '{}'));
    const allGradingsRaw: any[] = data.results?.[0]?.gradings || data.gradings || [];

    if (onProgress) onProgress(100, 100, 'grading');

    const results = data.results || (data.gradings ? [{ studentName: data.studentName || 'طالب غير معروف', gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    return {
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => {
          const sourceQuestion = flattenedQuestions.find(fq => fq.id === g.questionId);
          const maxGrade = Number(g.maxGrade ?? sourceQuestion?.grade ?? 0) || 0;
          const grade = clampGrade(g.grade, maxGrade);
          const copiedRisk = Boolean(g.isStudentAnswerCopiedFromModelRisk || looksLikeCopiedModel(g.studentAnswer, sourceQuestion?.answer));
          const audit = buildMathAuditNote(g, sourceQuestion, maxGrade);
          const feedback = (g.feedback || '').trim();

          return {
            ...g,
            questionId: g.questionId || sourceQuestion?.id,
            questionKey: g.questionKey || sourceQuestion?.questionKey || sourceQuestion?.label,
            displayLabel: g.displayLabel || sourceQuestion?.displayLabel || sourceQuestion?.label,
            studentAnswerNormalized: g.studentAnswerNormalized || normalizeMathText(g.studentAnswer || ''),
            studentFinalResultNormalized: g.studentFinalResultNormalized || normalizeMathText(g.studentFinalResult || ''),
            maxGrade,
            grade,
            confidence: typeof g.confidence === 'number' ? g.confidence : undefined,
            isStudentAnswerCopiedFromModelRisk: copiedRisk,
            needsReview: Boolean(g.needsReview || copiedRisk || audit.needsReview),
            feedback
          };
        });

        // ── تصحيح منطق حق الترك بناءً على الإجابات الفعلية ──
        // لكل مجموعة فروع فيها حق ترك:
        // - إذا أجاب الطالب على أكثر من المطلوب → آخر الفروع المُجابة = حق الترك
        // - إذا أجاب على المطلوب أو أقل → لا حق ترك (الفارغة = unanswered)
        Object.entries(parentGroups).forEach(([parentId, { requiredCount, subIds }]) => {
          if (requiredCount <= 0 || requiredCount >= subIds.length) return;

          const byId = new Map(gradingsWithMax.map((g: any) => [String(g.questionId), g]));
          const subGradings = subIds.map(sid => byId.get(sid)).filter(Boolean);

          // الفروع التي أجاب عنها الطالب فعلاً (لها studentAnswer غير فارغ)
          const answered = subGradings.filter((g: any) =>
            g.studentAnswer && g.studentAnswer.trim() && g.status !== 'unanswered'
          );

          if (answered.length > requiredCount) {
            // أجاب على أكثر من المطلوب → آخر الفروع المُجابة = حق ترك
            const lastAnswered = answered[answered.length - 1];
            lastAnswered.status = 'skipped';
            lastAnswered.grade = 0;
            lastAnswered.feedback = 'حق الترك';
          }
          // إذا أجاب على المطلوب أو أقل → لا نغير شيئاً، الفارغة تبقى unanswered
        });

        // تأكد أن كل سؤال موجود مرة واحدة على الأقل، حتى لو لم يرجعه النموذج.
        const byId = new Map<string, any>();
        gradingsWithMax.forEach((g: any) => {
          if (g.questionId) byId.set(String(g.questionId), g);
        });

        const completeGradings = flattenedQuestions.map((fq: any) => {
          const existing = byId.get(String(fq.id));
          if (existing) return existing;
          return {
            questionId: fq.id,
            questionKey: fq.questionKey || fq.label,
            displayLabel: fq.displayLabel || fq.label,
            studentAnswer: '',
            studentAnswerNormalized: '',
            studentFinalResult: '',
            studentFinalResultNormalized: '',
            grade: 0,
            maxGrade: Number(fq.grade) || 0,
            confidence: 0,
            feedback: 'لم يجب أو لم يتم العثور على إجابة واضحة.',
            status: 'unanswered',
            needsReview: false,
            isStudentAnswerCopiedFromModelRisk: false,
            box: [0, 0, 0, 0],
            pageIndex: 0
          };
        });

        const computedTotal = completeGradings.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);

        return {
          ...r,
          gradings: completeGradings,
          totalGrade: computedTotal
        };
      })
    };
  } catch (error: any) {
    console.error("Grading error:", error);
    throw error;
  }
}

async function compressImage(url: string, maxWidth = 1800, maxHeight = 1800, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
      } else {
        if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not get canvas context'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = () => reject(new Error('فشل في تحميل الصورة لمعالجتها'));
  });
}

function fixInlineSubQuestions(q: any, parentId?: string, level: number = 1): any {
  const id = q.id || `${parentId || 'q'}_${Math.random().toString(36).substr(2, 4)}`;
  if (q.subQuestions && q.subQuestions.length > 0) {
    return {
      ...q,
      id,
      subQuestions: q.subQuestions.map((sq: any, i: number) => fixInlineSubQuestions(sq, `${id}_${i}`, level + 1))
    };
  }
  return { ...q, id };
}
