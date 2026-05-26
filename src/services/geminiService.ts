import { GoogleGenAI, Type } from "@google/genai";

// ─────────────────────────────────────────────────────────────────────────────
// Friendly error messages
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
  } catch { }
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
    return '🛠️ خطأ داخلي في خادم Gemini. أعد المحاولة بعد لحظات.';
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError'))
    return '🌐 انقطع الاتصال بالإنترنت. تحقق من اتصالك وأعد المحاولة.';
  if (raw.includes('JSON') || raw.includes('SyntaxError'))
    return '📄 فشل في قراءة النتيجة. أعد المحاولة أو قلّل عدد الصور.';
  if (raw.includes('timeout') || raw.includes('AbortError'))
    return '⌛ انتهت مهلة الطلب. قلّل عدد الصور وأعد المحاولة.';
  console.error('[geminiService] Unhandled error:', safe);
  return '❌ حدث خطأ غير متوقع. أعد المحاولة أو تحقق من إعدادات مفتاح API.';
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
  studentAnswerImage?: string; // base64 JPEG crop of the student's answer area (without data: prefix)
  needsReview?: boolean; // true when verification pass detected a mismatch
}

const getApiKey = () => {
  const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
  if (viteKey && viteKey !== 'undefined' && viteKey !== '') return viteKey.trim();
  try {
    const envKey = process.env?.GEMINI_API_KEY || (process.env as any)?.VITE_GEMINI_API_KEY;
    if (envKey && envKey !== 'undefined' && envKey !== '') return envKey.trim();
  } catch (e) { }
  return (localStorage.getItem('GEMINI_API_KEY_FALLBACK') || '').trim();
};

const getApiKeyErrorMessage = () => {
  const isCloudflare = window.location.hostname.includes('.pages.dev');
  if (isCloudflare) return 'مفتاح API غير مضبوط. تأكد من إضافة VITE_GEMINI_API_KEY في Cloudflare Pages → Settings → Environment Variables ثم أعد النشر.';
  return 'مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) وإدخال مفتاح Gemini API.';
};

const cleanJson = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

async function compressImage(url: string, maxWidth = 800, maxHeight = 800, quality = 0.5): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } }
      else { if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; } }
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not get canvas context'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = () => reject(new Error('فشل في تحميل الصورة'));
  });
}

function fixInlineSubQuestions(q: any, parentId?: string, level: number = 1): any {
  const id = q.id || `${parentId || 'q'}_${Math.random().toString(36).substr(2, 4)}`;
  if (q.subQuestions && q.subQuestions.length > 0) {
    return { ...q, id, subQuestions: q.subQuestions.map((sq: any, i: number) => fixInlineSubQuestions(sq, `${id}_${i}`, level + 1)) };
  }
  return { ...q, id };
}

/**
 * Crops a region from a base64 image using box coordinates in 0–1000 scale (Gemini convention).
 * box = [ymin, xmin, ymax, xmax].
 * Returns a base64 JPEG (without data: prefix) of just the cropped region.
 */
async function cropAnswerRegion(
  base64Image: string,
  box: [number, number, number, number],
  padding: number = 20
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`;
    img.onload = () => {
      try {
        const [ymin, xmin, ymax, xmax] = box;
        // Convert 0–1000 normalized coords to actual pixels, with padding
        const px = (v: number, max: number) => Math.max(0, Math.min(max, Math.round((v / 1000) * max)));
        let x1 = px(xmin, img.width) - padding;
        let y1 = px(ymin, img.height) - padding;
        let x2 = px(xmax, img.width) + padding;
        let y2 = px(ymax, img.height) + padding;
        x1 = Math.max(0, x1);
        y1 = Math.max(0, y1);
        x2 = Math.min(img.width, x2);
        y2 = Math.min(img.height, y2);
        const w = Math.max(1, x2 - x1);
        const h = Math.max(1, y2 - y1);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Could not get canvas context for crop'));
        ctx.drawImage(img, x1, y1, w, h, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('فشل في تحميل الصورة للاقتصاص'));
  });
}

export async function extractExamFromDualImages(
  questionImages: string[], answerImages: string[]
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    const qImagesData = await Promise.all(questionImages.map(b64 => compressImage(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`, 1500, 1500, 0.7)));
    const aImagesData = await Promise.all(answerImages.map(b64 => compressImage(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`, 1500, 1500, 0.7)));

    const prompt = `Analyze these Iraqi exam questions and their model answers. Match them.
    Output a JSON object with:
    - title: String (exam subject)
    - requiredQuestionsCount: Number (if specified)
    - questions: Array of objects with {text, grade, answer, type, options, subQuestions: []}
    CRITICAL: Preserve Arabic digits (٠-٩). Nest sub-questions. Copy grades exactly. Clean redundant identifiers from text.`;

    const parts: any[] = [{ text: "QUESTIONS IMAGES:" }];
    qImagesData.forEach(data => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: "MODEL ANSWERS IMAGES:" });
    aImagesData.forEach(data => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", contents: { parts },
      config: { responseMimeType: "application/json", temperature: 0.1, systemInstruction: "You are an expert Iraqi teacher. Extract exam data precisely into JSON." }
    });
    const data = JSON.parse(cleanJson(response.text || '{}'));
    if (data && Array.isArray(data.questions)) data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
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

    const imagesData = await Promise.all(base64Images.map(b64 => compressImage(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`, 1500, 1500, 0.7)));

    const prompt = `Extract questions from this Iraqi exam paper. Output JSON with: title, requiredQuestionsCount, questions [{text, grade, answer, type}].
    CRITICAL: Preserve Arabic digits. Nest sub-questions. Copy grades exactly. Clean redundant identifiers.`;

    const parts: any[] = [...imagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } })), { text: prompt }];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", contents: { parts },
      config: { responseMimeType: "application/json", temperature: 0.1, systemInstruction: "You are an expert Iraqi teacher. Extract exam data into JSON. DO NOT perform arithmetic during extraction — copy exactly what is written." }
    });
    const data = JSON.parse(cleanJson(response.text || '{}'));
    if (data && Array.isArray(data.questions)) data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
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

    const prompt = `You are evaluating a student's handwritten exam paper image.

Subject: ${subject}.
Questions and model answers: ${JSON.stringify(flattenedQuestions)}.
Total Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || 'All'}.

WARNING — MOST IMPORTANT RULE:
You must read the student's written answer EXACTLY as ink on paper. Never compute or verify arithmetic.
If the student wrote "3×4=10", STUDENT_FINAL = 10 (not 12). If they wrote "15÷3=6", STUDENT_FINAL = 6 (not 5).
The value after the last "=" is the student's answer. Copy it. Do not evaluate it.

For each question follow these steps EXACTLY:

STEP 1 — READ STUDENT'S FINAL WRITTEN VALUE
Find the answer area for this question in the image.
STUDENT_FINAL = the ink value after the last "=" sign written by the student.
If student circled/boxed a value → [BOXED: value] = STUDENT_FINAL.
Do NOT compute. Do NOT verify. The ink shape after = is STUDENT_FINAL.

STEP 2 — READ MODEL ANSWER FINAL VALUE
MODEL_FINAL = value after the last "=" in the 'answer' field. Do NOT compute. Just read.

STEP 3 — COMPARE AS TEXT STRINGS
Normalize Arabic-Indic digits (٠-٩) to Western (0-9) for comparison only.
Are STUDENT_FINAL and MODEL_FINAL numerically equal?
${isMath ? `
✅ YES → full grade. studentAnswer = STUDENT_FINAL. Done.
❌ NO  → go to Step 4.

STEP 4 — FIND WHERE STUDENT'S WORK DIVERGED FROM MODEL ANSWER
Read the student's FULL written working (all lines) and compare step-by-step with model answer.
Find the FIRST step where the student's written work differs from the model answer.

Error types:
① ORDER_OF_OPERATIONS: student applied +/− before ×/÷ when they shouldn't → grade 0.
② SIGN_ERROR: wrong operator at a step → partial grade (50%).
③ ARITHMETIC_SLIP: right operator, wrong computed result at one step → deduct 1 mark max.
④ WRONG_METHOD: completely different approach → 0 or based on validity.
⑤ INCOMPLETE: stopped before finishing → partial for correct steps done.
` : `
✅ Match → full grade.
❌ No match → compare meaning of student answer with model answer. Partial credit proportionally.
`}

OUTPUT — JSON only:
{"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

• studentAnswer = STUDENT_FINAL if Step 3 passed, or full working if Step 4 reached.
• grade = full (Step 3) or based on divergence analysis (Step 4).
• feedback = Arabic (العربية الفصحى):
  Step 3 pass → brief praise.
  Step 4 → "الطالب كتب [STUDENT_FINAL]، الجواب النموذجي [MODEL_FINAL]. في الخطوة [N]: الطالب كتب [ما كتبه] بينما الصواب [ما يجب]. [نوع الخطأ]."
• box = [ymin,xmin,ymax,xmax] student answer location (0–1000).
• pageIndex = 0-based image index.`;

    const parts: any[] = base64ImagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مقيّم امتحانات رياضيات. القاعدة الأهم: لا تعيد حساب أي شيء كتبه الطالب. إذا كتب 3×4=10 فجوابه هو 10. إذا كتب 15÷3=6 فجوابه هو 6. STUDENT_FINAL هو الرقم بعد آخر = في خط الطالب — اقرأه كنقش حبر فقط. قارنه بـ MODEL_FINAL. إن اختلفا ابحث في الخطوات عن أول نقطة اختلاف. الملاحظات بالعربية الفصحى."
          : "أنت مقيّم امتحانات. اقرأ جواب الطالب النهائي كما هو مكتوب ولا تعيد حسابه. قارنه بالجواب النموذجي وامنح الدرجة المناسبة. الملاحظات بالعربية الفصحى."
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

export async function gradeMultipleStudents(
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
    const imageParts: any[] = base64ImagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } }));

    // ─────────────────────────────────────────────────────────────────────
    // CALL 1 — BLIND TRANSCRIPTION
    // Model sees images only — no questions, no answers.
    // Cannot "fix" what it doesn't know is wrong.
    // ─────────────────────────────────────────────────────────────────────
    const questionLabels = flattenedQuestions.map(q => ({ id: q.id, label: q.label }));

    const transcribePrompt = `You are a DUMB optical scanner with zero math knowledge. You convert ink to text AND locate it on the page.

For each question label listed here: ${JSON.stringify(questionLabels)}
Find the handwritten answer area for that question and copy EVERY ink mark exactly, AND mark its location.

ABSOLUTE RULES — VIOLATION = SYSTEM FAILURE:
1. YOU HAVE NO MATH KNOWLEDGE. You cannot add, subtract, multiply, divide, or evaluate anything.
2. Copy EVERY character exactly as written: digits, operators (+−×÷√=<>), Arabic/Western numerals.
3. If student wrote "3×4=10" → you write "3×4=10". You do NOT write "3×4=12". EVER.
4. If student wrote "5+3=7" → you write "5+3=7". You do NOT write "5+3=8". EVER.
5. The = sign and what follows it is PART OF THE ANSWER. Never replace the value after = with a computed result.
6. [BOXED: value] — student circled or boxed a final answer.
7. Crossed-out text: skip it.
8. Blank area: write "BLANK" and box = [0,0,0,0].
9. Unclear ink: copy best guess + "?".
10. Multi-line working: copy ALL lines in order, separated by " | ".

CRITICAL: You are copying INK SHAPES. 3×4=10 has two ink shapes after = : "1" and "0". Copy "10". Not "12".

BOUNDING BOX RULES:
- For each answer, return its location as box = [ymin, xmin, ymax, xmax] in 0–1000 normalized coordinates.
- The box must tightly contain ALL of the student's handwritten work for that question (including all lines and the final answer).
- pageIndex = 0-based index of the image where the answer is found.

Output JSON only:
{
  "studentName": "...",
  "transcriptions": [
    {"id": "...", "rawText": "...", "box": [ymin, xmin, ymax, xmax], "pageIndex": 0}
  ]
}

- studentName: student's name from paper, otherwise "طالب".
- id: must match exactly from question labels list.
- rawText: every ink mark in the answer area, copied character by character.
- box: [ymin, xmin, ymax, xmax] tight bounding box around the answer ink, 0–1000 scale.
- pageIndex: 0-based image index containing this answer.`;

    const transcribeResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [...imageParts, { text: transcribePrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: "You are a zero-intelligence optical character recognition scanner. You have NO knowledge of mathematics, arithmetic, language, or meaning. You see only ink shapes and you copy them. If you see the ink shapes '3×4=10' you output '3×4=10'. You never compute. You never verify. You never correct. The digit after = is just an ink shape to copy, not a result to validate. Copy every ink shape exactly as it appears."
      }
    });

    const transcribeData = JSON.parse(cleanJson(transcribeResponse.text || '{}'));
    const studentName: string = transcribeData.studentName || 'طالب غير معروف';
    const transcriptions: { id: string, rawText: string, box?: [number, number, number, number], pageIndex?: number }[] = transcribeData.transcriptions || [];

    // Crop each answer region from the original images so the user can visually verify the transcription.
    const answerCrops: Record<string, string> = {};
    await Promise.all(
      transcriptions.map(async (t) => {
        if (!t.box || !Array.isArray(t.box) || t.box.length !== 4) return;
        const [ymin, xmin, ymax, xmax] = t.box;
        // Skip degenerate boxes (e.g. BLANK answers)
        if (ymax <= ymin || xmax <= xmin) return;
        const pageIndex = typeof t.pageIndex === 'number' ? t.pageIndex : 0;
        const sourceImage = base64ImagesData[pageIndex] || base64ImagesData[0];
        if (!sourceImage) return;
        try {
          answerCrops[t.id] = await cropAnswerRegion(sourceImage, t.box, 24);
        } catch (e) {
          console.warn(`[crop] failed for question ${t.id}:`, e);
        }
      })
    );

    const questionsWithRaw = flattenedQuestions.map(q => {
      const t = transcriptions.find(tr => tr.id === q.id);
      return {
        ...q,
        studentRawText: t?.rawText || 'BLANK',
        _box: t?.box,
        _pageIndex: t?.pageIndex
      };
    });

    // ─────────────────────────────────────────────────────────────────────
    // CALL 2 — COMPARISON ONLY (text only, no images)
    // Model receives transcribed text + expected answers.
    // Cannot re-read or re-interpret the student's work.
    // ─────────────────────────────────────────────────────────────────────
    const comparePrompt = `You are a strict answer comparator. You receive transcribed student answers and compare them against expected answers.

Subject: ${subject}.
Student name: ${studentName}.
Questions with expected answers and transcribed student text:
${JSON.stringify(questionsWithRaw.map(({ _box, _pageIndex, ...rest }) => rest))}
Total Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || 'All'}.

IMPORTANT — THE TRANSCRIBED TEXT IS GROUND TRUTH:
The studentRawText was copied ink-by-ink from the student's paper. It is EXACTLY what the student wrote.
If studentRawText says "3×4=10" then the student wrote 3×4=10. The student's answer IS 10.
Do NOT recompute. Do NOT verify arithmetic in studentRawText. Treat it as a fixed string.

For each question:

STEP 1 — IDENTIFY STUDENT'S FINAL WRITTEN VALUE:
  Look for a [BOXED: value] in studentRawText → that is STUDENT_FINAL.
  If no box: STUDENT_FINAL = the value written after the LAST "=" sign in studentRawText.
  If no "=" sign: STUDENT_FINAL = the entire studentRawText trimmed.
  If studentRawText is "BLANK" → grade 0, feedback "لم يجب", done.
  DO NOT COMPUTE. STUDENT_FINAL is read from the text string, not calculated.

STEP 2 — IDENTIFY MODEL'S FINAL VALUE:
  MODEL_FINAL = the value after the last "=" in the 'answer' field.
  If no "=": MODEL_FINAL = the full 'answer' field trimmed.
  DO NOT COMPUTE. Just read the string.

STEP 3 — COMPARE AS STRINGS (allow Arabic/Western digit equivalence):
  Normalize: convert Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) to Western (0-9) for comparison only.
  Are STUDENT_FINAL and MODEL_FINAL numerically equal?
  ✅ YES → full grade. studentAnswer = STUDENT_FINAL. Done.
  ❌ NO  → go to Step 4.

STEP 4 — LOCATE DIVERGENCE (only if Step 3 failed):
${isMath ? `  Compare studentRawText steps against 'answer' steps to find FIRST divergence point.
  ① ORDER_OF_OPERATIONS: student applied lower-priority op before higher-priority? → grade 0.
  ② SIGN_ERROR: wrong operator (+−×÷√) at correct position? → partial grade (50%).
  ③ ARITHMETIC_SLIP: correct operator, wrong computed result at one step? → deduct 1 mark max.
  ④ WRONG_METHOD: completely different approach? → 0 or based on validity.
  ⑤ INCOMPLETE: stopped mid-way? → partial for correct steps done.`
    : `  Compare meaning of studentRawText with expected answer. Partial credit proportionally.`}

Output JSON only:
{"results":[{"studentName":"${studentName}","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[0,0,0,0],"pageIndex":0}]}]}

- studentAnswer: STUDENT_FINAL (Step 2 pass) or full studentRawText (Step 4 reached).
- grade: full (Step 3 pass) or 0/partial (Step 4).
- feedback: Arabic (العربية الفصحى).
  Step 3 pass → brief praise.
  Step 4 → "الطالب كتب [STUDENT_FINAL] والجواب النموذجي [MODEL_FINAL]. الخطأ: [وصف دقيق لنقطة الانحراف]."
- box/pageIndex: set to 0.`;

    const compareResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: comparePrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مقارن نصوص صارم للرياضيات. تستقبل نصاً منسوخاً حرفياً من ورقة الطالب. هذا النص هو الحقيقة المطلقة — لا تعيد حساب أي شيء فيه. إذا كتب 3×4=10 فجوابه هو 10 وليس 12. استخرج الرقم بعد آخر علامة = في النص المنسوخ كـ STUDENT_FINAL. استخرج الرقم بعد آخر = في حقل answer كـ MODEL_FINAL. قارنهما كنصين. إن تطابقا درجة كاملة. إن اختلفا ابحث في خطوات النص عن أول نقطة اختلاف. الملاحظات بالعربية الفصحى."
          : "أنت مقارن نصوص. النص المنسوخ هو ما كتبه الطالب فعلاً — لا تعيد حسابه. قارن معناه بالجواب المتوقع وأعط الدرجة. الملاحظات بالعربية الفصحى."
      }
    });

    if (onProgress) onProgress(100, 100, 'grading');

    const data = JSON.parse(cleanJson(compareResponse.text || '{}'));
    const results = data.results || (data.gradings ? [{ studentName, gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    // ─────────────────────────────────────────────────────────────────────
    // CALL 3 — VERIFICATION PASS
    // For every answer marked "correct" (full grade), re-examine the cropped
    // image with a closed yes/no question: does the ink actually say the
    // model's expected final value? If NO, the transcription was wrong —
    // demote the grade and flag for review.
    //
    // This catches the failure mode where the scanner "corrects" the student
    // in its head: student wrote 21, scanner wrote "12" (the right answer),
    // comparator agreed → false-positive. The verifier sees just the ink
    // and the expected value, so it can't paper over the mismatch.
    // ─────────────────────────────────────────────────────────────────────
    const verifyAnswer = async (
      questionId: string,
      cropBase64: string,
      expectedFinal: string
    ): Promise<{ matches: boolean; actualInk: string }> => {
      const verifyPrompt = `You are a verification scanner. Look at this image of a student's handwritten answer.

The system claims the student wrote: "${expectedFinal}"

Your job: confirm whether the ink in the image ACTUALLY shows "${expectedFinal}" as the final answer (the value after the last "=" sign, OR the boxed/circled value).

ABSOLUTE RULES:
1. You have NO math knowledge. Do not compute anything.
2. Read the ink shapes EXACTLY as drawn. Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) are equivalent to Western (0-9) — that is the ONLY allowed equivalence.
3. "12" and "21" are DIFFERENT. "14" and "-14" are DIFFERENT. "10" and "100" are DIFFERENT.
4. If the ink shows something different from "${expectedFinal}", say NO and report what you actually see.

Output JSON only:
{"matches": true|false, "actualInk": "what the ink actually says, character by character"}`;

      try {
        const verifyResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: {
            parts: [
              { inlineData: { data: cropBase64, mimeType: "image/jpeg" } },
              { text: verifyPrompt }
            ]
          },
          config: {
            responseMimeType: "application/json",
            temperature: 0,
            systemInstruction: "You are a verification scanner with zero math knowledge. You confirm or deny whether an image's ink matches a claimed text value. You read ink shapes only — never compute, never correct. 12 ≠ 21. Be strict."
          }
        });
        const verifyData = JSON.parse(cleanJson(verifyResponse.text || '{}'));
        return {
          matches: verifyData.matches === true,
          actualInk: String(verifyData.actualInk ?? '')
        };
      } catch (e) {
        console.warn(`[verify] failed for ${questionId}:`, e);
        // On verifier failure, assume original grade stands (don't punish on infra errors)
        return { matches: true, actualInk: '' };
      }
    };

    // Collect all "correct" gradings that need verification
    type GradingToVerify = { result: any; grading: any; expectedFinal: string; crop: string };
    const toVerify: GradingToVerify[] = [];
    for (const r of results) {
      for (const g of r.gradings || []) {
        const maxGrade = g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0;
        const crop = answerCrops[g.questionId];
        // Only verify when: full marks given AND we have a crop to check
        if (crop && maxGrade > 0 && Number(g.grade) >= maxGrade) {
          // Extract the final value the student supposedly wrote (after last "=")
          const txt = String(g.studentAnswer || '').trim();
          const lastEq = txt.lastIndexOf('=');
          const expectedFinal = lastEq >= 0 ? txt.slice(lastEq + 1).trim() : txt;
          if (expectedFinal) {
            toVerify.push({ result: r, grading: g, expectedFinal, crop });
          }
        }
      }
    }

    // Run verifications in parallel, but cap concurrency to avoid rate limits
    const CONCURRENCY = 3;
    for (let i = 0; i < toVerify.length; i += CONCURRENCY) {
      const batch = toVerify.slice(i, i + CONCURRENCY);
      const verdicts = await Promise.all(
        batch.map(item => verifyAnswer(item.grading.questionId, item.crop, item.expectedFinal))
      );
      batch.forEach((item, idx) => {
        const verdict = verdicts[idx];
        if (!verdict.matches) {
          // Transcription was wrong — the answer is actually incorrect.
          const maxGrade = item.grading.maxGrade || flattenedQuestions.find(fq => fq.id === item.grading.questionId)?.grade || 0;
          const original = item.grading.studentAnswer;
          item.grading.grade = 0;
          item.grading.needsReview = true;
          item.grading.studentAnswer = verdict.actualInk || original;
          item.grading.feedback = `⚠️ تنبيه: النسخ الأصلي قال "${original}" لكن التحقق البصري من الصورة قرأ "${verdict.actualInk}". الجواب النموذجي هو "${item.expectedFinal}" — لا يتطابق. الدرجة 0. (يحتاج مراجعة المعلم).`;
          console.warn(`[verify] mismatch for ${item.grading.questionId}: claimed "${original}", ink actually says "${verdict.actualInk}"`);
        }
      });
    }

    return {
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => {
          const transcription = transcriptions.find(t => t.id === g.questionId);
          return {
            ...g,
            maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0,
            // Attach the cropped image of the student's handwriting so the user can verify visually.
            studentAnswerImage: answerCrops[g.questionId] || undefined,
            box: transcription?.box || g.box,
            pageIndex: transcription?.pageIndex ?? g.pageIndex ?? 0
          };
        });
        const computedTotal = gradingsWithMax.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);
        return { ...r, gradings: gradingsWithMax, totalGrade: computedTotal };
      })
    };
  } catch (error: any) {
    console.error("Grading error:", error);
    throw new Error(friendlyError(error));
  }
}
