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

// ═══════════════════════════════════════════════════════════════════════════════
// PASS 1: Read student answers ONLY — NO model answers provided
// This prevents the AI from "correcting" what it reads to match expected answers
// ═══════════════════════════════════════════════════════════════════════════════
async function readStudentAnswers(
  ai: GoogleGenAI,
  base64ImagesData: string[],
  flattenedQuestions: any[],
  subject: string
): Promise<{ studentName: string; answers: { questionId: string; studentAnswer: string; box?: [number, number, number, number]; pageIndex?: number }[] }> {
  
  // We send ONLY the question texts (without answers) so the AI cannot "correct"
  const questionTextsOnly = flattenedQuestions.map(q => ({
    id: q.id,
    label: q.label,
    text: q.text,
    type: q.type
  }));

  const isMath = subject.includes('رياضيات') || subject.toLowerCase().includes('math');

  const prompt = `You are a handwriting reader. Your ONLY job is to read what the student wrote — exactly as written.

Subject: ${subject}
Questions to find answers for: ${JSON.stringify(questionTextsOnly)}

ABSOLUTE RULES — VIOLATION IS FATAL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. You MUST read the student's handwriting EXACTLY as it appears on the paper.
2. If the student wrote "3×2=7", you MUST write "3×2=7" — NOT "3×2=6".
3. If the student wrote "15+3=20", you MUST write "15+3=20" — NOT "15+3=18".
4. NEVER use your math knowledge to "fix" or "correct" what the student wrote.
5. NEVER calculate the answer yourself and substitute it for what the student wrote.
6. If a number is unclear or ambiguous, write what you see and add "?" after it.
7. Copy ALL intermediate steps the student wrote, exactly as written.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 ${isMath ? `
MATH-SPECIFIC RULES:
- Read EVERY digit, sign, and symbol the student wrote — even if mathematically wrong.
- If the student wrote a wrong final answer, write that wrong answer exactly.
- If the student wrote intermediate steps (like carrying, crossing out), copy them.
- The student may have written: the question, their work, and a final answer.
  → Copy ALL of it exactly as written on paper.
- If you see "=7" written by the student, write "=7" even if you know the answer should be "=6".
` : ''}

For each question, find where the student answered it and read their answer EXACTLY.

OUTPUT — JSON only, no markdown:
{"studentName":"...","answers":[{"questionId":"...","studentAnswer":"exact text as written by student","box":[ymin,xmin,ymax,xmax],"pageIndex":0}]}

• studentAnswer must be the RAW text copied from the student's paper — wrong numbers and all.
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
        ? `أنت قارئ خط يد فقط — لا تقيّم ولا تصحح أبداً. وظيفتك الوحيدة: اقرأ ما كتبه الطالب حرفياً كما يظهر على الورقة. إذا كتب الطالب ٣×٢=٧ فاكتب ٣×٢=٧ حتى لو كنت تعرف أن الجواب الصحيح ٦. لا تستخدم معرفتك الرياضية أبداً لتصحيح أو تغيير ما تقرأه. انقل الأرقام والإشارات والرموز بالضبط كما كتبها الطالب — خطأ كان أم صواب.`
        : `أنت قارئ خط يد فقط. اقرأ ما كتبه الطالب بالضبط كما يظهر على الورقة — لا تصحح ولا تغيّر أبداً.`
    }
  });

  const data = JSON.parse(cleanJson(response.text || '{}'));
  return {
    studentName: data.studentName || 'طالب غير معروف',
    answers: data.answers || []
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASS 2: Compare student answers with model answers and grade
// Now the AI gets both the student's raw answer AND the model answer for comparison
// ═══════════════════════════════════════════════════════════════════════════════
async function compareAndGrade(
  ai: GoogleGenAI,
  studentAnswers: { questionId: string; studentAnswer: string; box?: [number, number, number, number]; pageIndex?: number }[],
  flattenedQuestions: any[],
  totalExamGrade: number,
  requiredQuestionsCount: number,
  subject: string
): Promise<{ gradings: GradingResult[] }> {
  
  const isMath = subject.includes('رياضيات') || subject.toLowerCase().includes('math');

  // Build comparison pairs: student answer + model answer for each question
  const comparisons = flattenedQuestions.map(q => {
    const student = studentAnswers.find(s => s.questionId === q.id);
    return {
      questionId: q.id,
      label: q.label,
      text: q.text,
      modelAnswer: q.answer,
      grade: q.grade,
      type: q.type,
      studentAnswer: student?.studentAnswer || '(لم يتم العثور على إجابة)',
      box: student?.box,
      pageIndex: student?.pageIndex
    };
  });

  const prompt = `You are a grading judge. You receive the student's answer (already read from paper) and the model answer. Compare and grade.

Subject: ${subject}
Total Max Grade: ${totalExamGrade}
Required Questions Count: ${requiredQuestionsCount || 'All'}

Comparison data: ${JSON.stringify(comparisons)}

GRADING RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. The studentAnswer field was read directly from the student's paper — treat it as accurate.
2. Compare studentAnswer with modelAnswer to determine the grade.

 ${isMath ? `
MATH GRADING — STEP BY STEP:

STEP 1: Extract the FINAL numeric value from studentAnswer.
  - If student wrote "3×2=7", the final value is 7.
  - If student wrote a multi-step solution, take the last computed result.

STEP 2: Extract the FINAL numeric value from modelAnswer.

STEP 3: Compare final values:
  ✅ Match → full grade. Done.
  ❌ Don't match → go to Step 4.

STEP 4: Analyze the error by comparing student's steps with model answer steps:
  Check in this order:
  A. ORDER OF OPERATIONS: Did the student follow the same operation sequence?
     (parentheses → × ÷ → + −). If different → ORDER_ERROR → 0 grade.
  
  B. SIGNS: Compare every +, −, ×, ÷ sign. Any mismatch → SIGN_ERROR → partial or 0.
  
  C. ARITHMETIC: For each step, does the computed value match what it should be?
     If only the last step has a small arithmetic error → deduct 1 mark max.
  
  D. FORMULA/METHOD: Did the student use the same approach?
     Different method but correct result → full grade.
     Different method and wrong result → 0 grade.
  
  E. COMPLETENESS: Did the student finish? Incomplete → proportional partial grade.

  Grading based on error type:
  - Order of operations error → 0
  - Wrong formula/method → 0
  - Sign error in early step → 0
  - Arithmetic slip in final step only → deduct max 1 mark (e.g., if question is 5 marks → 4)
  - Multiple arithmetic errors → proportional deduction
  - Partially correct steps → proportional partial grade
` : `
NON-MATH GRADING:
- Full match in meaning → full grade
- Partial match → proportional grade
- Wrong or missing → 0
`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — JSON only, no markdown:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}

• studentAnswer = the student's answer as provided in the input (do not modify it).
• grade = numeric grade for this question.
• feedback = Arabic (العربية الفصحى):
  - Full grade → brief praise.
  - Partial/zero → state: what the student wrote, what the model answer is, where the error is, and why this grade was given.
• box and pageIndex = copy from input data.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: { parts: [{ text: prompt }] },
    config: {
      responseMimeType: "application/json",
      temperature: 0,
      systemInstruction: isMath
        ? `أنت مقيّم رياضيات. تحصل على إجابة الطالب (التي قُرئت مسبقاً من الورقة) والجواب النموذجي. قارن بينهما فقط. لا تقرأ من صورة — الإجابة أمامك نصياً. قيّم بناءً على المقارنة: هل الجواب النهائي صحيح؟ إن لم يكن، حلل الخطأ (ترتيب عمليات، إشارات، حساب، طريقة) وأعطِ الدرجة المناسبة. الملاحظات بالعربية الفصحى توضح أين الخطأ ولماذا هذه الدرجة.`
        : `أنت مقيّم. تحصل على إجابة الطالب والجواب النموذجي — قارن وقيّم. الملاحظات بالعربية الفصحى.`
    }
  });

  const data = JSON.parse(cleanJson(response.text || '{}'));
  return { gradings: data.gradings || [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GRADING FUNCTION — Now uses Two-Pass approach
// ═══════════════════════════════════════════════════════════════════════════════
export async function gradeStudentPaper(
  imageUrls: string[],
  questions: Question[],
  totalExamGrade: number,
  requiredQuestionsCount: number,
  subject: string = "عام",
  onProgress?: (current: number, total: number, phase: 'compressing' | 'reading' | 'grading') => void
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    // ─── Phase 0: Compress images ───
    if (onProgress) onProgress(0, imageUrls.length, 'compressing');

    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const compressed = await compressImage(imageUrls[i], 2000, 2000, 0.85);
      base64ImagesData.push(compressed);
      if (onProgress) onProgress(i + 1, imageUrls.length, 'compressing');
    }

    // ─── Flatten questions (same as before) ───
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

    // ═══════════════════════════════════════════════════════════════════
    // PASS 1: Read student answers WITHOUT model answers
    // This is the KEY change — AI doesn't know correct answers while reading
    // ═══════════════════════════════════════════════════════════════════
    if (onProgress) onProgress(0, 100, 'reading');

    const readResult = await readStudentAnswers(ai, base64ImagesData, flattenedQuestions, subject);

    if (onProgress) onProgress(50, 100, 'reading');

    // ═══════════════════════════════════════════════════════════════════
    // PASS 2: Compare and grade — now AI gets both student & model answers
    // ═══════════════════════════════════════════════════════════════════
    if (onProgress) onProgress(0, 100, 'grading');

    const gradeResult = await compareAndGrade(
      ai,
      readResult.answers,
      flattenedQuestions,
      totalExamGrade,
      requiredQuestionsCount,
      subject
    );

    if (onProgress) onProgress(100, 100, 'grading');

    // ─── Merge results ───
    const gradingsWithMax: GradingResult[] = gradeResult.gradings.map((g: any) => {
      const question = flattenedQuestions.find(fq => fq.id === g.questionId);
      const studentData = readResult.answers.find(s => s.questionId === g.questionId);
      return {
        questionId: g.questionId,
        studentAnswer: g.studentAnswer || studentData?.studentAnswer || '',
        grade: Number(g.grade) || 0,
        feedback: g.feedback || '',
        box: g.box || studentData?.box,
        pageIndex: g.pageIndex ?? studentData?.pageIndex,
        maxGrade: question?.grade || 0
      } as GradingResult & { maxGrade: number };
    });

    const computedTotal = gradingsWithMax.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);

    return {
      results: [{
        studentName: readResult.studentName,
        gradings: gradingsWithMax,
        totalGrade: computedTotal
      }]
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
