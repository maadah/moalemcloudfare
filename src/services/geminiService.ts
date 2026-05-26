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
    const imageParts: any[] = base64ImagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } }));

    // ─────────────────────────────────────────────────────────────────────
    // CALL 1 — BLIND TRANSCRIPTION
    // Model sees images only — no questions, no answers.
    // Cannot "fix" what it doesn't know is wrong.
    // ─────────────────────────────────────────────────────────────────────
    const questionLabels = flattenedQuestions.map(q => ({ id: q.id, label: q.label }));

    const transcribePrompt = `You are a document scanner. Scan this exam paper and copy handwritten text exactly.

For each question label listed here: ${JSON.stringify(questionLabels)}
Find the student's handwritten response area for that question and copy EVERY character — digit by digit, symbol by symbol, line by line.

RULES — NO EXCEPTIONS:
- You are a SCANNER. Copy ink shapes exactly. Do not interpret meaning.
- Copy every number, sign (+−×÷√=), and step you see in the answer area.
- [BOXED: value] — if student boxed or circled a value, mark it this way.
- Crossed-out text: skip.
- Blank area: write "BLANK".
- Unclear: copy what you see + "?".

Output JSON only:
{"studentName": "...", "transcriptions": [{"id": "...", "rawText": "..."}]}

- studentName: the student's name if written on the paper, otherwise "طالب".
- id: must match exactly the id from the question labels list.
- rawText: everything written in the answer area for that question, copied character by character.`;

    const transcribeResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [...imageParts, { text: transcribePrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: "You are a document scanner. You convert handwritten images to raw text with zero interpretation. You have no knowledge of math or any subject. You only see ink marks and copy them exactly as they appear. You never alter, fix, or interpret what you see."
      }
    });

    const transcribeData = JSON.parse(cleanJson(transcribeResponse.text || '{}'));
    const studentName: string = transcribeData.studentName || 'طالب غير معروف';
    const transcriptions: { id: string, rawText: string }[] = transcribeData.transcriptions || [];

    const questionsWithRaw = flattenedQuestions.map(q => ({
      ...q,
      studentRawText: transcriptions.find(t => t.id === q.id)?.rawText || 'BLANK'
    }));

    // ─────────────────────────────────────────────────────────────────────
    // CALL 2 — COMPARISON ONLY (text only, no images)
    // Model receives transcribed text + expected answers.
    // Cannot re-read or re-interpret the student's work.
    // ─────────────────────────────────────────────────────────────────────
    const comparePrompt = `You are a strict answer comparator. You receive transcribed student answers and compare them against expected answers.

Subject: ${subject}.
Student name: ${studentName}.
Questions with expected answers and transcribed student text:
${JSON.stringify(questionsWithRaw)}
Total Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || 'All'}.

For each question:

STEP 1 — Extract student's FINAL value from studentRawText:
  Final value = last number in the text, OR [BOXED: value] if present.
  Do NOT compute anything. Just read the last value written.
  Store as STUDENT_FINAL.

STEP 2 — Compare STUDENT_FINAL with the 'answer' field (final value only):
  ✅ Values match → full grade. studentAnswer = STUDENT_FINAL. Done.
  ❌ Values differ → Step 3.

STEP 3 — Locate error in studentRawText (only if Step 2 failed):
${isMath ? `  Compare the student's written steps against the model answer steps:
  ① Operation order: did student do + or − before × or ÷? → ORDER_OF_OPERATIONS error → grade 0.
  ② Signs: wrong + − × ÷ √ compared to model answer? → SIGN_ERROR → partial grade.
  ③ Arithmetic: a step result differs from model answer same step? → ARITHMETIC_SLIP → deduct 1 mark max.
  ④ Wrong method/formula? → WRONG_METHOD → grade based on validity.
  ⑤ Incomplete? → partial for completed correct steps.`
    : `  Compare meaning of studentRawText with expected answer. Partial credit proportionally.`}

Output JSON only:
{"results":[{"studentName":"${studentName}","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[0,0,0,0],"pageIndex":0}]}]}

- studentAnswer: STUDENT_FINAL if Step 2 passed, or full studentRawText if Step 3.
- grade: full (Step 2) or 0/partial (Step 3).
- feedback: Arabic (العربية الفصحى). Step 2 pass → brief praise. Step 3 → "الطالب كتب [STUDENT_FINAL] والجواب النموذجي [MODEL_FINAL]. الخطأ: [وصف دقيق لنقطة الانحراف]."`;

    const compareResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: comparePrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مقارن نصوص صارم. تستقبل نصاً منسوخاً من ورقة الطالب وتقارنه بالجواب النموذجي. لا تحل أي معادلة. استخرج الرقم النهائي من النص المنسوخ وقارنه بالجواب النموذجي. إن اختلفا ابحث في النص عن أول نقطة اختلاف عن الجواب النموذجي. الملاحظات بالعربية الفصحى."
          : "أنت مقارن نصوص. قارن النص المنسوخ بالجواب المتوقع وأعط الدرجة. الملاحظات بالعربية الفصحى."
      }
    });

    if (onProgress) onProgress(100, 100, 'grading');

    const data = JSON.parse(cleanJson(compareResponse.text || '{}'));
    const results = data.results || (data.gradings ? [{ studentName, gradings: data.gradings, totalGrade: data.totalGrade }] : []);

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
