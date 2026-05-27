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
  grade: number;
  feedback: string;
  box?: [number, number, number, number];
  pageIndex?: number;
}

const getApiKey = () => {
  const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
  if (viteKey && viteKey !== 'undefined' && viteKey !== '') return viteKey.trim();
  try {
    const envKey = process.env?.GEMINI_API_KEY || (process.env as any)?.VITE_GEMINI_API_KEY;
    if (envKey && envKey !== 'undefined' && envKey !== '') return envKey.trim();
  } catch (e) {}
  return (localStorage.getItem('GEMINI_API_KEY_FALLBACK') || '').trim();
};

const getApiKeyErrorMessage = () => {
  const isNetlify = window.location.hostname.includes('netlify.app');
  const isCloudflare = window.location.hostname.includes('.pages.dev');
  if (isCloudflare) return 'مفتاح API غير مضبوط. تأكد من إضافة VITE_GEMINI_API_KEY في Cloudflare Pages → Settings → Environment Variables ثم أعد النشر.';
  if (isNetlify) return 'مفتاح API غير مضبوط. تأكد من إضافة VITE_GEMINI_API_KEY في إعدادات البيئة. يمكنك أيضاً إدخاله يدوياً من أيقونة الإعدادات (⚙️).';
  return 'مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) وإدخال مفتاح Gemini API للمتابعة.';
};

// ─────────────────────────────────────────────────────────────────────────────
// Friendly error messages — hides raw API errors and key values from users
// ─────────────────────────────────────────────────────────────────────────────
const friendlyError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const safe = raw
    .replace(/AIza[A-Za-z0-9_\-]{30,}/g, 'AIza***')
    .replace(/api[_-]?key[:\s'"]+[A-Za-z0-9_\-]{10,}/gi, 'api_key:***')
    .replace(/sk-[A-Za-z0-9_\-]{20,}/g, 'sk-***');
  let code: number | null = null;
  try {
    const m = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (m) code = JSON.parse(m[0])?.error?.code ?? null;
  } catch {}
  if (raw.includes('suspended') || raw.includes('Permission denied'))
    return '🚫 مفتاح API موقوف. افتح الإعدادات (⚙️) وأدخل مفتاحاً جديداً.';
  if (code === 503 || raw.includes('high demand') || raw.includes('UNAVAILABLE'))
    return '🔄 الخادم مشغول حالياً. انتظر دقيقة أو دقيقتين ثم أعد المحاولة.';
  if (code === 429 || raw.includes('quota') || raw.includes('rate limit') || raw.includes('RESOURCE_EXHAUSTED'))
    return '⏳ تم تجاوز حد الاستخدام. انتظر بضع دقائق ثم أعد المحاولة.';
  if (code === 401 || raw.includes('UNAUTHENTICATED') || raw.includes('Unauthorized'))
    return '🔑 مفتاح API غير صحيح. افتح الإعدادات (⚙️) وتأكد من المفتاح.';
  if (code === 403 || raw.includes('Forbidden'))
    return '⛔ المفتاح لا يملك صلاحية استخدام هذا النموذج.';
  if (code === 400 || raw.includes('INVALID_ARGUMENT'))
    return '⚠️ خطأ في البيانات. تأكد من وضوح الصور وأعد المحاولة.';
  if (code === 500 || raw.includes('INTERNAL'))
    return '🛠️ خطأ داخلي في الخادم. أعد المحاولة بعد لحظات.';
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError'))
    return '🌐 انقطع الاتصال بالإنترنت. تحقق من اتصالك وأعد المحاولة.';
  if (raw.includes('JSON') || raw.includes('SyntaxError'))
    return '📄 فشل في قراءة النتيجة. أعد المحاولة أو قلّل عدد الصور.';
  if (raw.includes('timeout') || raw.includes('AbortError'))
    return '⌛ انتهت مهلة الطلب. قلّل عدد الصور وأعد المحاولة.';
  console.error('[geminiService] error:', safe);
  return '❌ حدث خطأ غير متوقع. أعد المحاولة أو تحقق من إعدادات مفتاح API.';
};

const cleanJson = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

export async function extractExamFromDualImages(
  questionImages: string[],
  answerImages: string[]
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    const qImagesData = await Promise.all(questionImages.map(async (base64) => {
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1500, 1500, 0.7);
    }));
    const aImagesData = await Promise.all(answerImages.map(async (base64) => {
      return await compressImage(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`, 1500, 1500, 0.7);
    }));

    const prompt = `Analyze these Iraqi exam questions and their model answers. Match them.
    Output a JSON object with:
    - title: String (exam subject)
    - requiredQuestionsCount: Number (if specified, e.g. "Answer 5 only")
    - questions: Array of objects with {text, grade, answer, type, options, subQuestions: []}
    
    CRITICAL: 
    - Preserve Arabic digits (٠-٩).
    - For sub-questions (e.g. branch A, B, or numbers 1, 2), nest them inside the parent question.
    - GRADE EXTRACTION: Strictly copy the grade written on the paper. DO NOT divide the parent grade among sub-questions yourself. If sub-questions don't have individual grades on the paper, leave their 'grade' field null or empty.
    - IMPORTANT: Clean the 'text' field by removing redundant identifiers (like "س1:", "أ-", "1-") at the beginning of the text IF they are already represented by the structure.
    - If a question has sub-questions, the parent 'text' should be the general instruction only. 
    - If images are text-only, extract the full text.`;

    const parts: any[] = [];
    parts.push({ text: "QUESTIONS IMAGES:" });
    qImagesData.forEach((data) => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: "MODEL ANSWERS IMAGES:" });
    aImagesData.forEach((data) => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
    throw new Error(friendlyError(error));
  }
}

export async function extractExamFromImages(base64Images: string[]): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

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

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
    throw new Error(friendlyError(error));
  }
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
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    if (onProgress) onProgress(0, imageUrls.length, 'compressing');
    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      base64ImagesData.push(await compressImage(imageUrls[i], 2000, 2000, 0.85));
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
          flattenedQuestions.push({ id: q.id, label: fullPath, text: combinedText, answer: q.answer, grade: q.grade, type: q.type });
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(questions);

    if (onProgress) onProgress(0, 100, 'grading');
    const isMath = subject.includes('رياضيات') || subject.toLowerCase().includes('math');

    const prompt = `You are a result comparator and error locator working on a student's handwritten exam image.
    You do NOT solve equations. You do NOT fix student answers. You only READ and COMPARE.

    Subject: ${subject}.
    Questions and expected answers: ${JSON.stringify(flattenedQuestions)}.
    Total Max Grade: ${totalExamGrade}.
    Required Questions Count: ${requiredQuestionsCount || 'All'}.

    For each question, follow these steps:

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 1 — READ STUDENT'S FINAL VALUE FROM IMAGE
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Look at the image. Find where the student wrote their answer for this question.
    Read ONLY the last number written, or the boxed/circled value.
    Copy it as raw ink — digit by digit. Store as STUDENT_FINAL.
    
    ⛔ DO NOT compute. DO NOT verify. DO NOT alter. Just read.
    ⛔ If student wrote -13, store -13. Not -15. Not anything else.
    ⛔ If student wrote 28, store 28. Not 25. Not anything else.

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 2 — READ MODEL ANSWER FINAL VALUE FROM JSON
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Read the 'answer' field from the JSON for this question.
    Extract ONLY the final numeric result. Store as MODEL_FINAL.
    
    ⛔ DO NOT compute. Just read the value.

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 3 — COMPARE AS TEXT STRINGS
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Compare STUDENT_FINAL and MODEL_FINAL character by character.

    ✅ Identical → full grade. studentAnswer = STUDENT_FINAL. Go to OUTPUT.
    ❌ Different → go to Step 4.

    ${isMath ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 4 — LOCATE WHERE STUDENT'S WORK DIVERGED (only if Step 3 failed)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Read the student's full written work from the image — all steps, as raw ink.
    studentAnswer = copy everything written, digit by digit exactly as on paper.

    ⛔ While reading steps: you are a camera. Copy shapes. Do not interpret.
    ⛔ If student wrote 3×-5=-13, copy "3×-5=-13". Do NOT change to -15.

    Now compare student's written steps VISUALLY against model answer steps:

    CHECK 1 — OPERATION ORDER:
    What is the FIRST operation in the model answer?
    What is the FIRST operation the student performed?
    Are they the same? If not → ORDER_OF_OPERATIONS error → grade = 0.

    CHECK 2 — SIGNS between numbers (+, −, ×, ÷, √):
    Compare each sign/operator the student wrote vs the model answer.
    Find the first sign that differs.
    Example: model has × but student wrote +, or model has − but student wrote +.
    → SIGN_ERROR → partial grade based on correct steps before this.

    CHECK 3 — NUMERIC RESULTS per operation:
    For each operation, compare the number the student wrote as result vs model answer.
    Example: model answer shows 3×5=15, student wrote 3×5=13.
    The sign × is correct, but the result 13 ≠ 15.
    → ARITHMETIC_ERROR → deduct 1 mark max for single error.

    CHECK 4 — WRONG METHOD:
    Student used completely different formula or approach.
    → Grade based on validity of their approach.

    CHECK 5 — INCOMPLETE:
    Student stopped before finishing.
    → Partial grade for correct steps completed.

    Stop at the FIRST check that finds a difference. That is the error.
    Grade based on where the error occurred.` 
    : `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 4 — ASSESS PARTIAL CREDIT (only if Step 3 failed)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Read the student's full answer from the image.
    Compare meaning with model answer. Award partial credit proportionally.`}

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    OUTPUT — JSON only, no markdown:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

    • studentAnswer = STUDENT_FINAL (Step 3 pass) or full written work as on paper (Step 4).
    • grade = full (Step 3) or based on error location (Step 4).
    • feedback = Arabic (العربية الفصحى):
      Step 3 pass → brief acknowledgment.
      Step 4 → "الطالب كتب [STUDENT_FINAL]، والجواب النموذجي [MODEL_FINAL]. [نوع الخطأ وموضعه بالضبط]."
    • box = [ymin,xmin,ymax,xmax] student answer location (0–1000).
    • pageIndex = 0-based image index.`;

    const parts: any[] = base64ImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مقارن نتائج ومحدد أخطاء. قاعدة مطلقة: لا تحل أي معادلة ولا تغير أي رقم كتبه الطالب. دورك: (١) اقرأ الرقم النهائي للطالب من الورقة كما هو — إذا كتب -13 فهو -13 وليس -15. (٢) اقرأ الرقم النهائي من الجواب النموذجي. (٣) قارنهما كنصين — إن تطابقا درجة كاملة. إن اختلفا: قارن خطوات الطالب المكتوبة بصرياً مع خطوات الجواب النموذجي وابحث عن أول اختلاف — هل العملية مختلفة؟ هل الإشارة بين الأرقام مختلفة؟ هل ناتج عملية معينة مختلف؟ أول اختلاف تجده هو الخطأ. الملاحظات بالعربية الفصحى."
          : "أنت مقارن إجابات. اقرأ جواب الطالب النهائي كما هو ولا تغير أي شيء. قارنه بالجواب النموذجي — إن تطابقا درجة كاملة. إن اختلفا امنح درجة جزئية بناءً على مدى التطابق. الملاحظات بالعربية الفصحى."
      }
    });

    if (onProgress) onProgress(100, 100, 'grading');

    const data = JSON.parse(cleanJson(response.text || '{}'));
    const results = data.results || (data.gradings ? [{ studentName: data.studentName || 'طالب غير معروف', gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    return {
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => ({
          ...g,
          maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0
        }));
        const computedTotal = gradingsWithMax.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);
        return { ...r, gradings: gradingsWithMax, totalGrade: computedTotal };
      })
    };
  } catch (error: any) {
    console.error("Grading error:", error);
    throw new Error(friendlyError(error));
  }
}

async function compressImage(url: string, maxWidth = 800, maxHeight = 800, quality = 0.5): Promise<string> {
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
    img.oerror = () => reject(new Error('فشل في تحميل الصورة لمعالجتها'));
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
