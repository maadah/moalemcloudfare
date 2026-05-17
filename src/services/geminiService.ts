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
const GEMINI_FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

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
    status === 401 ||   // Unauthorized - مفتاح خاطئ
    status === 403 ||   // Forbidden - مفتاح محظور
    status === 429 ||   // Rate limit - تجاوز الحصة
    status === 503 ||   // Service unavailable
    message.includes('api key') ||
    message.includes('quota') ||
    message.includes('invalid key') ||
    message.includes('permission denied') ||
    message.includes('high demand') ||
    message.includes('unavailable') ||
    message.includes('model not found')
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

const cleanJson = (text: string): string => {
  // إزالة markdown backticks إن وجدت
  let cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // استخراج أكبر كتلة JSON صالحة (من أول { إلى آخر })
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
};

export async function extractExamFromDualImages(
  questionImages: string[],
  answerImages: string[]
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const qImagesData = await Promise.all(questionImages.map(async (base64) => {
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1800, 1800, 0.88);
    }));

    const aImagesData = await Promise.all(answerImages.map(async (base64) => {
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1800, 1800, 0.88);
    }));

    const prompt = `لديك مجموعتان من الصور:
- [صور الأسئلة]: ورقة الأسئلة الرسمية للامتحان.
- [الإجابات النموذجية]: الإجابة النموذجية المعدّة من المعلم.

المطلوب منك:
استخرج من صور الأسئلة بنية الامتحان كاملة: العنوان، والأسئلة، وفروعها، ودرجاتها.
ثم انقل الإجابة النموذجية لكل سؤال من صور الإجابات النموذجية.

قواعد الاستخراج الصارمة:
- انقل النصوص والأرقام كما هي بدون تفسير أو تغيير.
- حافظ على الأرقام العربية (٠-٩) كما تظهر.
- لا تجري أي عملية حسابية — إذا رأيت 85/5 اكتبها 85/5 وليس 17.
- لا تستنتج درجات الفروع بالقسمة — انقل فقط ما هو مكتوب صراحة.
- رتّب الأسئلة بنفس ترتيبها في الورقة.
- إذا كان للسؤال فروع فاجعلها subQuestions.
- إذا كان هناك عدد محدود من الفروع المطلوب الإجابة عنها، ضعه في requiredSubCount.

أرجع JSON فقط:
{
  "title": "عنوان الامتحان",
  "requiredQuestionsCount": 0,
  "questions": [
    {
      "id": "q1",
      "text": "نص السؤال",
      "answer": "الإجابة النموذجية كما هي",
      "grade": 0,
      "type": "text | true-false | multiple-choice | fill-in-the-blanks",
      "requiredSubCount": 0,
      "subQuestions": []
    }
  ]
}`;

    const parts: any[] = [];
    parts.push({ text: "[صور الأسئلة]:" });
    qImagesData.forEach((data) => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: "[الإجابات النموذجية]:" });
    aImagesData.forEach((data) => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await generateWithGeminiFallback({
      contents: { parts },
      config: { 
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: `أنت معلم عراقي خبير. مهمتك الوحيدة: استخراج بيانات الامتحان من الصور بدقة عالية.
قواعد صارمة:
- استخرج النص كما هو بدون تفسير أو تصحيح أو إضافة.
- حافظ على الأرقام العربية (٠-٩) كما هي.
- لا تجري أي عملية حسابية — انقل الأرقام والرموز كما تظهر في الصورة.
- إذا رأيت 85/5 في الصورة، اكتبها 85/5 وليس 17.
- اعتمد على الصور فقط كمصدر للبيانات.`
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
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1800, 1800, 0.88);
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
        temperature: 0,
        systemInstruction: `أنت معلم عراقي خبير. مهمتك الوحيدة: استخراج بيانات الامتحان من الصور بدقة عالية.
قواعد صارمة:
- استخرج النص كما هو بدون تفسير أو تصحيح أو إضافة.
- حافظ على الأرقام العربية (٠-٩) كما هي.
- لا تجري أي عملية حسابية — انقل الأرقام والرموز كما تظهر في الصورة.
- إذا رأيت 85/5 في الصورة، اكتبها 85/5 وليس 17.
- اعتمد على الصور فقط كمصدر للبيانات.`
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
    .trim();
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
  const studentNorm = normalizeMathText(g.studentAnswerNormalized || g.studentAnswer || '');
  const modelNorm = normalizeMathText(question.answer || '');

  const copiedRisk = looksLikeCopiedModel(g.studentAnswer, question.answer);

  // تحذير: درجة كاملة لكن الناتج النهائي لا يظهر في الإجابة النموذجية
  const suspiciousFullGrade = isFullGrade(Number(g.grade), maxGrade) &&
    finalNorm && modelNorm && !modelNorm.includes(finalNorm) && !finalNorm.includes(modelNorm);

  // تحذير: درجة كاملة لكن جواب الطالب المطبّع لا يتطابق مع الإجابة النموذجية المطبّعة
  const suspiciousAnswerMismatch = isFullGrade(Number(g.grade), maxGrade) &&
    studentNorm && modelNorm &&
    studentNorm.length > 1 && modelNorm.length > 1 &&
    !modelNorm.includes(studentNorm) && !studentNorm.includes(modelNorm) &&
    normalizeMathText(studentNorm) !== normalizeMathText(modelNorm);

  const notes: string[] = [];
  if (copiedRisk) notes.push('تنبيه آلي: جواب الطالب يشبه الإجابة النموذجية بشكل مريب، يحتاج مراجعة للتأكد أنه من الورقة.');
  if (suspiciousFullGrade) notes.push('تنبيه آلي: درجة كاملة لكن الناتج النهائي لا يتطابق مع النموذجي — راجع التصحيح.');
  if (suspiciousAnswerMismatch && !suspiciousFullGrade) notes.push('تنبيه آلي: جواب الطالب لا يتطابق مع الإجابة النموذجية لكن أُعطيت درجة كاملة — راجع.');

  return {
    needsReview: Boolean(g.needsReview || copiedRisk || suspiciousFullGrade || suspiciousAnswerMismatch),
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

    const prompt = `أنت محكّم دقيق لأوراق الامتحان. مهمتك: تصحيح ورقة الطالب من الصورة فقط.

═══════════════════════════════════════
 المبدأ الأساسي: الدليل قبل الدرجة
═══════════════════════════════════════
الدرجة الافتراضية لكل سؤال = صفر.
لا ترفع الدرجة إلا إذا رأيت دليلاً مرئياً واضحاً بخط الطالب في الصورة.
إذا شككت → ابقَ على الصفر + needsReview=true.
لا تمنح درجة بناءً على معرفتك بالإجابة الصحيحة.

═══════════════════════════════════════
 خطوات العمل لكل سؤال — بالترتيب
═══════════════════════════════════════
الخطوة 1 — المسح البصري (قبل أي حكم):
  حدد المنطقة في الصورة التي تخص هذا السؤال.
  اكتب في rawVisual وصفاً حرفياً لما تراه بالضبط:
  مثال: "أرى: ٣ × (-١٧) = -٤١ مكتوباً بالقلم الأحمر"
  أو:   "لا أرى أي كتابة تحت هذا السؤال"
  أو:   "أرى كتابة غير واضحة، يبدو أنها أرقام لكن لا أستطيع قراءتها"

الخطوة 2 — نقل جواب الطالب:
  studentAnswer = نقل حرفي لما وصفته في rawVisual فقط.
  ▸ إذا rawVisual = "لا أرى كتابة" → studentAnswer = "" و status = "unanswered" و grade = 0. توقف هنا.
  ▸ إذا rawVisual = "كتابة غير واضحة" → studentAnswer = ما تستطيع قراءته + [؟] للأجزاء الغامضة، needsReview = true.
  ▸ لا تنقل كلمة واحدة من modelAnswer إلى studentAnswer.
  ▸ إذا كتب الطالب إجابة خاطئة، انقلها خاطئة كما هي بالضبط.

الخطوة 3 — التحقق من المعادلات والأرقام (خاص بالمواد العلمية):
  بعد نقل studentAnswer، تحقق:
  ▸ هل الناتج الذي كتبه الطالب يتطابق رياضياً مع الناتج الصحيح؟
  ▸ مثال: الطالب كتب ٣ × (-١٧) = -٤١ → الناتج الصحيح -٥١ → إذن الطالب أخطأ → grade يجب أن يعكس الخطأ.
  ▸ لا تعتمد على شكل الخطوات، اعتمد على صحة الناتج النهائي الذي كتبه الطالب فعلاً.
  ▸ إذا النتيجة النهائية خاطئة → grade = 0 أو درجة جزئية حسب الخطوات، ليس الدرجة الكاملة.
  ▸ إذا النتيجة النهائية صحيحة لكن الخطوات ناقصة → درجة جزئية.

الخطوة 4 — التقييم والدرجة:
  قارن ما في studentAnswer بـ modelAnswer.
  ▸ في الأسئلة النظرية: قيّم المعنى والمفهوم، لا التطابق الحرفي.
  ▸ في الأسئلة الحسابية: الناتج النهائي الذي رأيته في الصورة هو الفيصل.
  ▸ درجة جزئية إذا الفكرة صحيحة لكن يوجد خطأ في التطبيق.
  ▸ feedback مختصر بالعربية يذكر سبب الدرجة وما الخطأ إن وجد.

═══════════════════════════════════════
 قواعد صارمة — لا استثناء
═══════════════════════════════════════
✗ ممنوع: نقل أي نص من modelAnswer إلى studentAnswer.
✗ ممنوع: إعطاء درجة كاملة لسؤال فيه ناتج خاطئ.
✗ ممنوع: اختراع جواب لسؤال فارغ في الصورة.
✗ ممنوع: نقل جواب سؤال لسؤال آخر.
✓ مطلوب: rawVisual لكل سؤال قبل studentAnswer.
✓ مطلوب: إذا confidence < 0.75 → needsReview = true تلقائياً.
✓ مطلوب: حافظ على أرقام الطالب كما هي (٤٨ وليس 48).

═══════════════════════════════════════
 قواعد بنية الورقة
═══════════════════════════════════════
- السؤال الرئيسي: س1، س١، س1/، س1:، سؤال 1.
- الفروع: أ، أ/، أ-، أ)، (أ)، ب، ج، د.
- النقاط: 1/، ١/، 1-، ١-، 1)، ١).
- إذا كان الجواب بعيداً عن موضع السؤال ولا يوجد label واضح يربطه به → unanswered + needsReview.

═══════════════════════════════════════
 قواعد حق الترك
═══════════════════════════════════════
- إذا كان السؤال يطلب عدداً محدداً من الفروع، صحح فقط ما أجاب عنه الطالب.
- الفروع الزائدة الفارغة → status = "skipped"، feedback = "حق الترك".
${skipInfo}

═══════════════════════════════════════
 بيانات الامتحان
═══════════════════════════════════════
المادة: ${subject}
عدد الأسئلة: ${flattenedQuestions.length}
الدرجة الكلية: ${totalExamGrade}
عدد الأسئلة المطلوبة: ${requiredQuestionsCount || 'الكل'}

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

═══════════════════════════════════════
 تحقق ذاتي إجباري قبل إخراج JSON
═══════════════════════════════════════
لكل سؤال قبل إضافته للـ JSON اسأل نفسك:
1) هل كتبت rawVisual أولاً؟
2) هل studentAnswer مأخوذ من rawVisual فقط وليس من modelAnswer؟
3) إذا كان الناتج الحسابي خاطئاً في الصورة، هل grade يعكس الخطأ؟
4) إذا كان studentAnswer فارغاً، هل grade = 0؟
5) إذا confidence < 0.75، هل needsReview = true؟
إذا أي إجابة "لا" → أصلح قبل الإخراج.

أرجع JSON فقط:
{
  "results": [
    {
      "studentName": "طالب غير معروف",
      "gradings": [
        {
          "questionId": "نفس id من قائمة الأسئلة",
          "questionKey": "نفس questionKey من قائمة الأسئلة",
          "displayLabel": "نفس displayLabel من قائمة الأسئلة",
          "rawVisual": "وصف حرفي لما تراه في الصورة لهذا السؤال تحديداً",
          "studentAnswer": "نقل حرفي من rawVisual فقط — لا تصحح ولا تعدّل",
          "studentAnswerNormalized": "نسخة موحدة للمقارنة فقط",
          "studentFinalResult": "آخر ناتج كتبه الطالب كما هو في الصورة",
          "studentFinalResultNormalized": "نسخة موحدة للمقارنة فقط",
          "grade": 0,
          "maxGrade": 0,
          "confidence": 0.0,
          "feedback": "تقييم مختصر بالعربية: سبب الدرجة وما الخطأ إن وجد",
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

    const parts: any[] = base64ImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await generateWithGeminiFallback({
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: `أنت محكّم دقيق لأوراق الامتحان. عملك يقوم على مبدأ واحد: الدليل المرئي أولاً، الدرجة ثانياً.

القاعدة الذهبية:
الدرجة الافتراضية = صفر لكل سؤال.
ارفع الدرجة فقط إذا رأيت دليلاً واضحاً بخط الطالب في الصورة يستحق الرفع.

التمييز الأساسي بين المصدرين:
▸ ورقة الطالب = الخط اليدوي الذي تراه في صورة الامتحان.
▸ modelAnswer = النص المُرسَل في البرومبت — مرجع للمقارنة فقط، لا تنقل منه أي كلمة إلى studentAnswer.

قواعد rawVisual — إجبارية:
لكل سؤال اكتب rawVisual أولاً قبل أي حكم.
rawVisual = وصف حرفي لما تراه في الصورة في موضع هذا السؤال.
إذا لم تكتب rawVisual واضحاً → لا تكتب studentAnswer ولا grade.

قواعد المعادلات الرياضية — حرجة:
▸ لا تحكم بصحة معادلة بناءً على معرفتك — احكم على الناتج الذي كتبه الطالب فعلاً.
▸ إذا كتب الطالب ناتجاً خاطئاً (مثل -٤١ بدل -٥١) → grade لا يكون كاملاً حتى لو الخطوات تبدو صحيحة.
▸ إذا الناتج النهائي صحيح لكن الخطوات غير واضحة → درجة جزئية + needsReview.
▸ إذا لم تتمكن من قراءة الناتج بوضوح → needsReview=true + confidence منخفضة.

ممنوع مطلقاً:
✗ نقل أي نص من modelAnswer إلى studentAnswer.
✗ إعطاء درجة كاملة لناتج خاطئ في الصورة.
✗ اختراع جواب لسؤال فارغ في الصورة.
✗ رفع confidence فوق 0.7 إذا الكتابة غير واضحة.`
      }
    });

    const data = JSON.parse(cleanJson(response.text || '{}'));

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
          const feedback = [g.feedback || '', copiedRisk ? 'تنبيه آلي: جواب الطالب يشبه الإجابة النموذجية بشكل مريب ويحتاج مراجعة.' : '', audit.note]
            .filter(Boolean)
            .join(' ');

          return {
            ...g,
            questionId: g.questionId || sourceQuestion?.id,
            questionKey: g.questionKey || sourceQuestion?.questionKey || sourceQuestion?.label,
            displayLabel: g.displayLabel || sourceQuestion?.displayLabel || sourceQuestion?.label,
            rawVisual: g.rawVisual || '',
            studentAnswerNormalized: g.studentAnswerNormalized || normalizeMathText(g.studentAnswer || ''),
            studentFinalResultNormalized: g.studentFinalResultNormalized || normalizeMathText(g.studentFinalResult || ''),
            maxGrade,
            grade,
            confidence: typeof g.confidence === 'number' ? g.confidence : undefined,
            isStudentAnswerCopiedFromModelRisk: copiedRisk,
            // إذا rawVisual يشير لعدم رؤية كتابة، تأكد grade = 0
            ...(g.rawVisual && /لا أرى|لا يوجد|فارغ|blank|empty/i.test(g.rawVisual) ? { grade: 0, status: 'unanswered' } : {}),
            needsReview: Boolean(g.needsReview || copiedRisk || audit.needsReview || (typeof g.confidence === 'number' && g.confidence < 0.75)),
            feedback
          };
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

