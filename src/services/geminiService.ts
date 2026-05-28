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

// Initialize AI on client side as per instructions
const getApiKey = () => {
  // Try various common environment variable patterns for Vite/Netlify
  const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
  if (viteKey && viteKey !== 'undefined' && viteKey !== '') return viteKey.trim();

  // Fallback to process.env if available (usually during dev or if polyfilled)
  try {
    const envKey = process.env?.GEMINI_API_KEY || (process.env as any)?.VITE_GEMINI_API_KEY;
    if (envKey && envKey !== 'undefined' && envKey !== '') return envKey.trim();
  } catch (e) {
    // process might not be defined in browser
  }
  
  return (localStorage.getItem('GEMINI_API_KEY_FALLBACK') || '').trim();
};

const getApiKeyErrorMessage = () => {
  const isNetlify = window.location.hostname.includes('netlify.app');
  if (isNetlify) {
    return 'مفتاح API غير مضبوط. إذا كنت تستخدم Netlify، تأكد من إضافة المفتاح باسم VITE_GEMINI_API_KEY في إعدادات البيئة (Environment Variables). يمكنك أيضاً إدخاله يدوياً من أيقونة الإعدادات (⚙️) في الأعلى.';
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
    throw error;
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
    throw error;
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

    // ── Compress images ──────────────────────────────────────────────────────
    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const compressed = await compressImage(imageUrls[i], 2000, 2000, 0.85);
      base64ImagesData.push(compressed);
      if (onProgress) onProgress(i + 1, imageUrls.length, 'compressing');
    }

    // ── Flatten question tree ─────────────────────────────────────────────────
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

    const isMath = subject.includes('رياضيات') || subject.toLowerCase().includes('math');

    // ════════════════════════════════════════════════════════════════════════
    // CALL 1 — PURE OCR  (images sent, model answers NOT sent)
    // The model sees only the question labels (id + label) so it knows WHERE
    // to look, but it has NO access to the correct answers.  It cannot
    // "fix" what the student wrote because it does not know what the right
    // answer is.
    // ════════════════════════════════════════════════════════════════════════
    if (onProgress) onProgress(0, 100, 'grading');

    const questionLabels = flattenedQuestions.map(q => ({ id: q.id, label: q.label, text: q.text }));

    const ocrPrompt = `You are a pure ink-reading scanner. You have NO math knowledge and NO access to any answer key.

Your ONLY job: for each question in the list below, find the student's handwritten answer in the images and copy it EXACTLY as written — every digit, every sign, every operator — with zero modification.

Questions to locate (id + label only — no correct answers given to you):
${JSON.stringify(questionLabels)}

ABSOLUTE RULES:
1. Copy ink shapes ONLY. You are like a photocopier, not a calculator.
2. If the student wrote "3×2=5" → you write "3×2=5". Do NOT change "5" to "6".
3. If the student wrote "85÷5=18" → you write "85÷5=18". Do NOT change to "17".
4. If the student wrote "-13" → you write "-13". Do NOT change to "-15".
5. If the student crossed out a number and wrote another, copy the final visible answer (what is NOT crossed out).
6. If a number is boxed or circled by the student, that is their final answer — copy it exactly.
7. Preserve all Arabic/Hindi numerals (٠١٢٣٤٥٦٧٨٩), Western digits, signs (+−×÷=), variables, and fraction bars exactly as they appear.
8. Do NOT evaluate, simplify, or judge correctness. Do NOT compute anything.
9. If the answer area is blank → write "BLANK".
10. Copy multi-line working as a single string separated by " | ".

Output JSON ONLY (no extra text):
{
  "studentName": "name from paper or طالب",
  "transcriptions": [
    {"id": "q_id_here", "rawText": "exact copied text", "box": [ymin, xmin, ymax, xmax], "pageIndex": 0}
  ]
}
Include ALL question ids. box is normalized 0–1000. pageIndex is the image index (0-based).`;

    const ocrParts: any[] = base64ImagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    ocrParts.push({ text: ocrPrompt });

    const ocrResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: ocrParts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: "أنت ماسح ضوئي للنصوص فقط. ليس لديك أي معرفة رياضية. مهمتك الوحيدة هي نسخ ما هو مكتوب على ورقة الطالب حرفياً دون أي تغيير أو تقييم. لا تعرف الإجابات الصحيحة ولا يجب أن تحاول تخمينها. انسخ الأرقام والرموز كما هي بالضبط."
      }
    });

    const ocrData = JSON.parse(cleanJson(ocrResponse.text || '{}'));
    const transcriptions: Array<{ id: string; rawText: string; box: number[]; pageIndex: number }> =
      ocrData.transcriptions || [];
    const studentName: string = ocrData.studentName || 'طالب غير معروف';

    if (onProgress) onProgress(50, 100, 'grading');

    // ════════════════════════════════════════════════════════════════════════
    // CALL 2 — PURE JUDGMENT  (NO images — text only)
    // The model receives: the student's already-transcribed answers + the
    // model answers.  It never sees the images again, so it cannot change
    // the transcription.  Its only job is to decide right/wrong and assign
    // a grade.
    // ════════════════════════════════════════════════════════════════════════

    // Build the judgment input: pair each transcription with the model answer
    const judgmentInput = flattenedQuestions.map(q => {
      const t = transcriptions.find(tr => tr.id === q.id);
      return {
        id: q.id,
        label: q.label,
        questionText: q.text,
        modelAnswer: q.answer,
        maxGrade: q.grade,
        studentRawText: t ? t.rawText : "BLANK",
        box: t ? t.box : [0, 0, 0, 0],
        pageIndex: t ? t.pageIndex : 0
      };
    });

    const judgmentPrompt = isMath
      ? `You are a strict mathematics judge. You receive pairs of (studentRawText, modelAnswer) for each question. 
You have NO images. Do NOT change studentRawText — it is already final and locked.
Your only job: decide if the student's answer is correct and assign a grade.

Questions with student answers and model answers:
${JSON.stringify(judgmentInput)}

MATHEMATICS JUDGMENT RULES:

RULE 1 — RESULT-FIRST VERIFICATION (most important rule):
For every arithmetic expression the student wrote (e.g. "A op B = R"), look at the RESULT R that the student wrote and ask:
  "Does R actually come from applying op to A and B?"
  - "3 × 2 = 5"  → Does 5 come from 3×2? No (3×2=6). → WRONG.
  - "3 × 2 = 6"  → Does 6 come from 3×2? Yes. → CORRECT.
  - "85 ÷ 5 = 18" → Does 18 come from 85÷5? No (85÷5=17). → WRONG.
  - "3 × -5 = -13" → Does -13 come from 3×(-5)? No (=-15). → WRONG.
  - "10 - 7 = 4"  → Does 4 come from 10-7? No (=3). → WRONG.
  - "6 + 5 = 11"  → Does 11 come from 6+5? Yes. → CORRECT.
This rule applies to EVERY step in the student's working, not just the final line.

RULE 2 — EXACT NUMERIC MATCH:
The student's final numeric answer must match the model answer's final numeric value exactly.
A close number is NOT correct. "-13" ≠ "-15" even though both are negative. "18" ≠ "17".

RULE 3 — ORDER OF OPERATIONS:
× and ÷ are evaluated BEFORE + and −.
"7 × 3 + 2" must equal 23. If student wrote 35, it is WRONG.

RULE 4 — NO PARTIAL CREDIT FOR WRONG FINAL NUMBERS:
If the final number is wrong, the answer is wrong. The only partial credit allowed is across independent sub-parts.

RULE 5 — studentRawText IS LOCKED:
You MUST copy studentRawText into the output's studentAnswer field unchanged. Never replace it with the model answer.

Output JSON ONLY:
{
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<copy studentRawText unchanged>",
      "grade": <number>,
      "maxGrade": <number>,
      "feedback": "<Arabic feedback — explain which operation result was wrong and what the correct result should be>",
      "box": [ymin, xmin, ymax, xmax],
      "pageIndex": <number>
    }
  ]
}`
      : `You are a subject-matter judge. You receive student answers (already transcribed) alongside model answers.
You have NO images. Do NOT change studentRawText — it is locked.

Questions:
${JSON.stringify(judgmentInput)}

JUDGMENT RULES:
1. Compare studentRawText to modelAnswer for essential facts and keywords.
2. Award full grade if the essential meaning matches, partial grade if some points are present.
3. Award 0 if the answer is blank or completely wrong.
4. Copy studentRawText unchanged into studentAnswer.

Output JSON ONLY:
{
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<copy studentRawText unchanged>",
      "grade": <number>,
      "maxGrade": <number>,
      "feedback": "<brief Arabic feedback>",
      "box": [ymin, xmin, ymax, xmax],
      "pageIndex": <number>
    }
  ]
}`;

    const judgmentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: judgmentPrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت حَكَم رياضيات. لديك النصوص المنسوخة من ورقة الطالب والإجابات النموذجية فقط — لا توجد صور. مهمتك: لكل تعبير رياضي كتبه الطالب، انظر إلى الناتج الذي كتبه وتحقق هل يأتي هذا الناتج فعلاً من تطبيق العملية على العددين. مثال: '3×2=5' → هل 5 ناتج 3×2؟ لا، إذاً الجواب خاطئ. يمنع منعاً باتاً تغيير نص إجابة الطالب. الملاحظات بالعربية الفصحى."
          : "أنت حَكَم محترف. لديك نصوص إجابات الطلاب والإجابات النموذجية. قارن بينهما وامنح الدرجة. لا تغير نص إجابة الطالب. الملاحظات بالعربية الفصحى."
      }
    });

    const judgmentData = JSON.parse(cleanJson(judgmentResponse.text || '{}'));
    const rawGradings: any[] = judgmentData.gradings || [];

    if (onProgress) onProgress(100, 100, 'grading');

    // ── Merge transcription coordinates back in (judgment call had no images) ─
    const finalGradings = rawGradings.map((g: any) => {
      const t = transcriptions.find(tr => tr.id === g.questionId);
      return {
        ...g,
        // Ensure studentAnswer is always the OCR transcription, never the model answer
        studentAnswer: t ? t.rawText : (g.studentAnswer || ''),
        box: t ? t.box : (g.box || [0, 0, 0, 0]),
        pageIndex: t ? t.pageIndex : (g.pageIndex ?? 0),
        maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0
      };
    });

    const computedTotal = finalGradings.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);

    return {
      results: [{
        studentName,
        gradings: finalGradings,
        totalGrade: computedTotal
      }]
    };

  } catch (error: any) {
    console.error("Grading error:", error);
    throw error;
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
