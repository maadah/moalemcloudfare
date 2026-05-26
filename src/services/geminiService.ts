import { GoogleGenAI, Type } from "@google/genai";

// ─────────────────────────────────────────────────────────────────────────────
// Friendly error messages — converts raw API errors to readable Arabic text
// Keys are sanitized and never exposed to the user
// ─────────────────────────────────────────────────────────────────────────────
const friendlyError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);

  // Sanitize — remove any API key patterns before logging or displaying
  const safe = raw
    .replace(/AIza[A-Za-z0-9_\-]{30,}/g, 'AIza***')
    .replace(/api[_-]?key[:\s'"]+[A-Za-z0-9_\-]{10,}/gi, 'api_key:***')
    .replace(/sk-[A-Za-z0-9_\-]{20,}/g, 'sk-***');

  // Parse error code from JSON if present
  let code: number | null = null;
  try {
    const m = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (m) code = JSON.parse(m[0])?.error?.code ?? null;
  } catch { /* */ }

  if (raw.includes('suspended') || raw.includes('Permission denied'))
    return '🚫 مفتاح API موقوف. افتح الإعدادات (⚙️) وأدخل مفتاحاً جديداً.';
  if (code === 503 || raw.includes('high demand') || raw.includes('UNAVAILABLE'))
    return '🔄 الخادم مشغول حالياً بسبب الضغط العالي. انتظر دقيقة أو دقيقتين ثم أعد المحاولة.';
  if (code === 429 || raw.includes('quota') || raw.includes('rate limit') || raw.includes('RESOURCE_EXHAUSTED'))
    return '⏳ تم تجاوز حد الاستخدام اليومي. انتظر بضع دقائق ثم أعد المحاولة.';
  if (code === 401 || raw.includes('UNAUTHENTICATED') || raw.includes('Unauthorized'))
    return '🔑 مفتاح API غير صحيح أو منتهي الصلاحية. افتح الإعدادات (⚙️) وتأكد من المفتاح.';
  if (code === 403 || raw.includes('Forbidden'))
    return '⛔ المفتاح لا يملك صلاحية استخدام هذا النموذج.';
  if (code === 400 || raw.includes('INVALID_ARGUMENT'))
    return '⚠️ خطأ في البيانات المُرسلة. تأكد من وضوح الصور وأعد المحاولة.';
  if (code === 500 || raw.includes('INTERNAL'))
    return '🛠️ خطأ داخلي في خادم Gemini. أعد المحاولة بعد لحظات.';
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError'))
    return '🌐 انقطع الاتصال بالإنترنت. تحقق من اتصالك وأعد المحاولة.';
  if (raw.includes('JSON') || raw.includes('SyntaxError'))
    return '📄 فشل في قراءة نتيجة العملية. أعد المحاولة أو قلّل عدد الصور.';
  if (raw.includes('timeout') || raw.includes('AbortError'))
    return '⌛ انتهت مهلة الطلب. قلّل عدد الصور وأعد المحاولة.';

  // Fallback — log sanitized version to console, show generic message to user
  console.error('[geminiService] Unhandled error:', safe);
  return '❌ حدث خطأ غير متوقع. أعد المحاولة، وإذا استمر تحقق من إعدادات مفتاح API.';
};

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
  if (isNetlify) {
    return 'مفتاح API غير مضبوط. إذا كنت تستخدم Netlify، تأكد من إضافة المفتاح باسم VITE_GEMINI_API_KEY في إعدادات البيئة. يمكنك أيضاً إدخاله يدوياً من أيقونة الإعدادات (⚙️) في الأعلى.';
  }
  return 'مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) في الأعلى وإدخال مفتاح Gemini API للمتابعة.';
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
    - GRADE EXTRACTION: Strictly copy the grade written on the paper. DO NOT divide the parent grade among sub-questions yourself.
    - Clean the 'text' field by removing redundant identifiers (like "س1:", "أ-", "1-") if already represented by structure.
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
    - Clean the 'text' field by removing redundant identifiers if already represented by structure.
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
      const compressed = await compressImage(imageUrls[i], 2000, 2000, 0.85);
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
          flattenedQuestions.push({ id: q.id, label: fullPath, text: combinedText, answer: q.answer, grade: q.grade, type: q.type });
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(questions);

    if (onProgress) onProgress(0, 100, 'grading');

    const isMath = subject.includes('رياضيات') || subject.toLowerCase().includes('math');

    const prompt = `You are a precise answer evaluator working directly on handwritten exam images.

Subject: ${subject}.
Questions with expected answers: ${JSON.stringify(flattenedQuestions)}.
Total Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || 'All'}.

For each question, follow this exact two-stage process:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 1 — LOOK AT THE FINAL ANSWER ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Find the student's final written result for this question.
The final answer is: the last number/expression written, OR the boxed/circled value.

Read this final value as a RAW INK PATTERN — digit by digit, shape by shape.
Do not interpret it mathematically. Do not validate it. Just read the last value.

Compare this raw final value against the expected 'answer':
✅ They match → full grade. Record studentAnswer = that final value. STOP here.
❌ They do not match → proceed to Stage 2.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 2 — ANALYSE THE FULL WORKING (only reached if Stage 1 failed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Now read the student's complete written work for this question — all steps.
Record studentAnswer = the complete expression as written on the paper, digit by digit.

⛔ While reading: treat every digit as an isolated ink shape — not a math value.
   If ink shows "28" → record "28". If ink shows "34-6=28" → record "34-6=28".
   Never alter a digit because the math "should" give a different result.

Then identify the error type from this list:
${isMath ? `
  • ORDER_OF_OPERATIONS — student did not follow PEMDAS/BODMAS (×÷ before +−, parentheses first)
  • ARITHMETIC_SLIP — correct method and order, but made a calculation mistake in one step
  • WRONG_FORMULA — used the wrong formula or approach entirely
  • SIGN_ERROR — mistake with negative/positive signs
  • INCOMPLETE — started correctly but did not finish
  • OTHER — describe clearly
` : `
  • FACTUAL_ERROR — wrong fact or concept
  • INCOMPLETE — partially answered
  • WRONG_CONCEPT — misunderstood the question
  • OTHER — describe clearly
`}

Assign partial grade based on how far the student got correctly before the error.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — JSON only, no markdown:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

• studentAnswer = final value if Stage 1 passed, or full working if Stage 2 reached.
• grade = full if Stage 1 passed, partial or 0 based on error analysis in Stage 2.
• feedback = Arabic (العربية الفصحى): if Stage 1 passed → brief praise. If Stage 2 → state what the student wrote, the error type, and what is correct.
• box = [ymin, xmin, ymax, xmax] location of student answer on page (0–1000 scale).
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
          ? "أنت مقيّم إجابات رياضية دقيق. لكل سؤال اتبع مرحلتين: المرحلة الأولى — انظر للجواب النهائي فقط (آخر رقم أو القيمة المحاطة بمستطيل) وقارنه بالجواب المتوقع. إذا تطابقا → درجة كاملة وانتهى. المرحلة الثانية (فقط عند عدم التطابق) — اقرأ خطوات الطالب كاملة رقماً رقماً كما هي بالحبر دون تغيير، ثم حدد نوع الخطأ: خطأ ترتيب عمليات، أو خطأ حسابي، أو خطأ إشارة، أو خطأ في القانون، أو غيره. الملاحظات بالعربية الفصحى توضح ما كتبه الطالب وما هو الصواب ونوع الخطأ."
          : "أنت مقيّم إجابات دقيق. لكل سؤال: أولاً انظر للجواب النهائي وقارنه بالمتوقع — إذا تطابقا درجة كاملة وانتهى. إذا لم يتطابقا اقرأ الإجابة كاملة كما هي وحدد نوع الخطأ. الملاحظات بالعربية الفصحى."
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
