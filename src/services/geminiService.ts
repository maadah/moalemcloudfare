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

const cleanJson = (text: string): string => {
  if (!text) return '{}';

  // Strip markdown code fences
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Walk forward from first '{' matching braces to find the real JSON end
  const start = t.indexOf('{');
  if (start === -1) return '{}';

  let depth = 0;
  let end = -1;
  for (let i = start; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  return end === -1 ? t.slice(start) : t.slice(start, end + 1);
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

    const textOnlySubjects = ['أحياء', 'قواعد', 'إسلامية', 'إنجليزي'];
    const isMath = !textOnlySubjects.some(s => subject.includes(s));

    // ═══════════════════════════════════════════════════════════════════════
    // CALL 1 — TRANSCRIPTION ONLY (images → Western digits, no answers given)
    // The model does NOT see model answers. Its only job is to copy what it
    // sees on the paper and convert Arabic/Hindi digits to Western digits.
    // No judgment, no math, no context that could trigger auto-correction.
    // ═══════════════════════════════════════════════════════════════════════

    const questionLocators = flattenedQuestions.map(q => ({
      id: q.id,
      label: q.label,
      questionText: q.text
    }));

    const transcribePrompt = `You are a transcription robot. You can only copy text. You have zero math ability.

Your job: find each student answer on the paper and copy it character by character into Western digits.

DIGIT CONVERSION TABLE — use this for every digit you see:
  ٠ → 0   ١ → 1   ٢ → 2   ٣ → 3   ٤ → 4   ٥ → 5   ٦ → 6   ٧ → 7   ٨ → 8   ٩ → 9
  DANGER: ٤ looks like Western 5 but it is 4. ٥ looks like 0 but it is 5.
  Read each digit shape in isolation using only the table above.

Questions to locate (NO correct answers given — you do not need them):
${JSON.stringify(questionLocators)}

For each question:
1. Find the student answer area in the images.
2. Copy every character exactly: digits (convert using table), signs (+, -, ×, ÷, =), parentheses, variables.
3. Copy ALL lines of working, joined with " | " between lines.
4. Do NOT compute anything. Do NOT change any digit value. You are a camera, not a calculator.
5. If blank → write "BLANK".

Output JSON only:
{
  "studentName": "name visible on paper or طالب",
  "answers": [
    {
      "id": "question id",
      "text": "exact transcription in Western digits",
      "box": [ymin, xmin, ymax, xmax],
      "pageIndex": 0
    }
  ]
}`;

    const transcribeParts: any[] = base64ImagesData.map(d => ({ inlineData: { data: d, mimeType: "image/jpeg" } }));
    transcribeParts.push({ text: transcribePrompt });

    const transcribeResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: transcribeParts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: "أنت روبوت نسخ فقط. مهمتك الوحيدة: انسخ الأرقام والرموز التي تراها على الورقة وحوّل الأرقام العربية الهندية إلى أرقام غربية باستخدام الجدول. لا تحسب شيئاً. لا تعرف الإجابات الصحيحة ولا تحتاجها. ٤ تساوي 4 وليس 5. ٥ تساوي 5 وليس 0. اقرأ كل رقم بشكل منفصل."
      }
    });

    let transcribeData: any = { answers: [], studentName: 'طالب غير معروف' };
    try {
      transcribeData = JSON.parse(cleanJson(transcribeResponse.text || '{}'));
    } catch(e) {
      console.error("Transcribe parse error:", e, "\nRaw:", transcribeResponse.text?.slice(0, 400));
    }

    const transcribedAnswers: Array<{ id: string; text: string; box: number[]; pageIndex: number }> =
      transcribeData.answers || [];
    const studentName: string = transcribeData.studentName || 'طالب غير معروف';

    if (onProgress) onProgress(50, 100, 'grading');

    // ═══════════════════════════════════════════════════════════════════════
    // CALL 2 — JUDGMENT ONLY (text only, no images)
    // The model now receives the already-transcribed student answers paired
    // with model answers. No images means it cannot change the transcription.
    // It checks every arithmetic line independently using derive-and-compare.
    // ═══════════════════════════════════════════════════════════════════════

    const judgmentItems = flattenedQuestions.map(q => {
      const t = transcribedAnswers.find(a => a.id === q.id);
      return {
        id: q.id,
        questionText: q.text,
        modelAnswer: q.answer,
        maxGrade: q.grade,
        studentTranscription: t ? t.text : 'BLANK'
      };
    });

    const judgePrompt = isMath
      ? `You are a mathematics examiner. You receive student answers already transcribed in Western digits.
You have NO images. The transcriptions are final — do NOT change them.

Items to judge:
${JSON.stringify(judgmentItems)}

For each item:

A) READ studentTranscription as-is. Copy it into "studentAnswer" unchanged.

B) SPLIT into individual arithmetic lines (split on "|" separator or newlines).
   For EACH line that contains "=":
   1. Take everything to the LEFT of "=" as an expression.
   2. Compute that expression yourself from scratch (do not look at what student wrote on the right).
   3. Note what the student wrote on the RIGHT of "=".
   4. If your computed value ≠ student's right-side value → line is WRONG.
   
   Check ALL error types:
   - Wrong result: left side computes to X but student wrote Y on right
   - Wrong sign: computed -15 but student wrote 15, or computed 15 but wrote -15
   - Order of operations: × and ÷ before + and −, unless parentheses override
     "3 + 4 × 2" → must be 3 + 8 = 11, NOT (3+4)×2 = 14
   - Carried-forward: if line 1 is wrong, any line that uses line 1's result is also wrong

   Store in lineChecks:
   [{"line": "3+14=17", "leftComputed": 17, "studentWrote": 17, "ok": true},
    {"line": "17×2=40", "leftComputed": 34, "studentWrote": 40, "ok": false}]

C) GRADE:
   If any lineCheck has "ok": false → grade = 0.
   If all lines ok AND final value matches modelAnswer → full maxGrade.
   Partial credit only for multi-part questions where some parts are right.

Output JSON only:
{
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<studentTranscription unchanged>",
      "lineChecks": [{"line": "...", "leftComputed": <number>, "studentWrote": <number>, "ok": true/false}],
      "grade": <number>,
      "maxGrade": <number>,
      "feedback": "<Arabic: for each wrong line state what student wrote and what correct value is>"
    }
  ]
}`
      : `You are an examiner. Student answers are already transcribed. No images.

Items:
${JSON.stringify(judgmentItems)}

For each item compare studentTranscription to modelAnswer:
- Copy studentTranscription into "studentAnswer" unchanged.
- Check for essential facts and keywords.
- Full grade if meaning matches. Partial if some points. Zero if blank or wrong.

Output JSON only:
{
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<studentTranscription unchanged>",
      "grade": <number>,
      "maxGrade": <number>,
      "feedback": "<brief Arabic feedback>"
    }
  ]
}`;

    const judgeResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: judgePrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مدقق رياضيات. لديك إجابات الطلاب منسوخة بالأرقام الغربية والإجابات النموذجية. لا توجد صور. مهمتك: لكل سطر في حل الطالب احسب أنت الطرف الأيسر من علامة = بشكل مستقل تماماً، ثم قارن ناتجك بما كتبه الطالب على يمين =. إن اختلفا فالسطر خاطئ والدرجة صفر. افحص كل سطر بهذه الطريقة. لا تغير studentTranscription أبداً. الملاحظات بالعربية."
          : "أنت مدقق. لديك إجابات الطلاب منسوخة والإجابات النموذجية. قارن بينها وامنح الدرجة. لا تغير نص إجابة الطالب. الملاحظات بالعربية."
      }
    });

    let judgeData: any = { gradings: [] };
    try {
      judgeData = JSON.parse(cleanJson(judgeResponse.text || '{}'));
    } catch(e) {
      console.error("Judge parse error:", e, "\nRaw:", judgeResponse.text?.slice(0, 400));
    }

    if (onProgress) onProgress(100, 100, 'grading');

    const rawGradings: any[] = judgeData.gradings || [];

    // Merge coordinates from transcription back into gradings
    const finalGradings = rawGradings.map((g: any) => {
      const t = transcribedAnswers.find(a => a.id === g.questionId);
      return {
        ...g,
        // Always use transcribed text as studentAnswer — never the model answer
        studentAnswer: t ? t.text : (g.studentAnswer || ''),
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
