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

For each question follow this process STRICTLY:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP A — SOLVE IT YOURSELF FIRST (before looking at the student paper)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the question text and solve it yourself using correct mathematical rules.
PEMDAS/BODMAS: parentheses → exponents → ×÷ (left to right) → +− (left to right).
Write out every step mentally and reach CORRECT_ANSWER.
This is your ground truth. The student's work cannot change it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP B — READ THE STUDENT'S FINAL VALUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Find the last number the student wrote, or the boxed/circled value.
Read it as raw digits only — do not interpret mathematically.
Store as STUDENT_FINAL.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP C — COMPARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Does STUDENT_FINAL equal CORRECT_ANSWER?
✅ YES → full grade. studentAnswer = STUDENT_FINAL. Skip Step D.
❌ NO  → go to Step D.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP D — VERIFY EACH STUDENT STEP INDEPENDENTLY (only if Step C failed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the student's full working from the image, step by step.
studentAnswer = copy everything written, digit by digit as raw ink.

For EACH step the student wrote, YOU calculate that step yourself independently:
- Do NOT trust the student's result for any step.
- Calculate the result of each operation yourself, then compare to what the student wrote.
- Example: student writes "3 + 14 = 17" → you calculate 3+14=17 ✓ correct step.
- Example: student writes "17 × 2 = 34" → you calculate 17×2=34 ✓ correct step.
- Example: student writes "34 - 6 = 28" → you calculate 34-6=28 ✓ correct step.
- BUT THEN check: was the ORDER OF OPERATIONS respected from the start?
  If the student did addition before multiplication when they should not have → ORDER_OF_OPERATIONS error.
  The individual step arithmetic may be correct, but the ORDER was wrong from step 1.

${isMath ? `
Error types to identify:
• ORDER_OF_OPERATIONS — wrong sequence of operations (e.g. added before multiplying)
• ARITHMETIC_SLIP — correct order and method, wrong arithmetic in one step  
• WRONG_FORMULA — used wrong formula or approach
• SIGN_ERROR — wrong negative/positive sign
• INCOMPLETE — did not finish
• OTHER — describe
` : `
Error types:
• FACTUAL_ERROR — wrong fact or concept
• INCOMPLETE — partially answered
• WRONG_CONCEPT — misunderstood the question
• OTHER — describe
`}
Grade: 0 if order of operations violated. Partial if minor arithmetic slip only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — JSON only, no markdown:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

• studentAnswer = STUDENT_FINAL if Step C passed, full working if Step D reached.
• grade = full if Step C passed, 0 or partial from Step D analysis.
• feedback = Arabic (العربية الفصحى): Step C pass → brief praise. Step D → state what student wrote, which step had the error, error type, and correct answer.
• box = [ymin, xmin, ymax, xmax] location of student answer (0–1000 scale).
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
          ? "أنت مقيّم رياضيات صارم. لكل سؤال: أولاً احسب الجواب الصحيح بنفسك بشكل مستقل تام قبل أن تنظر لأي شيء في ورقة الطالب — هذا هو مرجعك الثابت الذي لا تغيره. ثانياً قارن الجواب النهائي للطالب بجوابك — إن تطابقا درجة كاملة. إن اختلفا: اقرأ كل خطوة كتبها الطالب واحسبها أنت بشكل مستقل — لا تثق بنتيجة الطالب في أي خطوة بل احسبها أنت. تحقق من أمرين: (١) هل ترتيب العمليات صحيح؟ أقواس ثم أسس ثم ضرب وقسمة ثم جمع وطرح — أي مخالفة هنا تعني خطأ في الأساس وليس خطأً حسابياً. (٢) هل العمليات الحسابية في كل خطوة صحيحة؟ ابدأ من الخطوة الأولى ولا تتأثر بسلاسة الخطوات اللاحقة. الملاحظات بالعربية الفصحى توضح أين الخطأ بالضبط."
          : "أنت مقيّم دقيق. لكل سؤال: أولاً حدد الجواب الصحيح من معرفتك. ثانياً قارن جواب الطالب النهائي — إن تطابق درجة كاملة. إن اختلف اقرأ إجابته كاملة وحدد الخطأ بدقة. الملاحظات بالعربية الفصحى."
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
