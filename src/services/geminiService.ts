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

    // Apply strict numeric rules for any subject that could have arithmetic
    // (math, physics, chemistry, or any subject not explicitly text-only)
    const textOnlySubjects = ['أحياء', 'قواعد', 'إسلامية', 'إنجليزي'];
    const isMath = !textOnlySubjects.some(s => subject.includes(s));

    // ══════════════════════════════════════════════════════════════════════
    // SINGLE CALL — direct from images
    // We give the model the images + question list (with model answers).
    // The key insight: for math, we ask it to write what it SEES first,
    // then compute the operation ITSELF from the operands it saw, then
    // compare its own computed result to what the student wrote.
    // This way the model never "corrects" the student — it discovers the
    // error by re-deriving the result from the operands.
    // ══════════════════════════════════════════════════════════════════════

    const questionsForPrompt = flattenedQuestions.map(q => ({
      id: q.id,
      label: q.label,
      questionText: q.text,
      modelAnswer: q.answer,
      maxGrade: q.grade
    }));

    const prompt = `You are reading a student exam paper written in Arabic/Hindi numerals.

CRITICAL — ARABIC-HINDI DIGIT RECOGNITION TABLE (memorize before reading anything):
  The paper uses Eastern Arabic numerals. Their shapes look NOTHING like Western digits in some cases:
  ٠ = 0  (circle, like Western 0)
  ١ = 1  (vertical stroke, like Western 1)
  ٢ = 2  (looks like Western 2 rotated)
  ٣ = 3  (looks like Western 3 but reversed/different)
  ٤ = 4  ← CRITICAL: looks like a backwards "3" or like the number "5" to untrained eyes. IT IS 4, NOT 5.
  ٥ = 5  (looks like a circle with a tail, like Western 0 with extension. IT IS 5, NOT 0)
  ٦ = 6  (looks like a "7" or angled stroke)
  ٧ = 7  (looks like a "V" or Western 7)
  ٨ = 8  (looks like Western 8)
  ٩ = 9  (looks like Western 9)

  MOST COMMON MISTAKE TO AVOID:
  ٤ (four) is frequently misread as 5. If you see a shape that could be ٤ or 5, it is ٤ (four) = 4.
  Example: "-٤١" means -41, NOT -51. "٣ × (-١٧) = -٤١" means 3 × (-17) = -41 (which is wrong, correct is -51).

Questions and model answers:
${JSON.stringify(questionsForPrompt)}

For EVERY question, do these steps IN ORDER:

STEP 1 — READ DIGIT BY DIGIT (left to right, or right to left for Arabic):
  Find the student answer area for this question.
  Read each digit shape one at a time using the table above.
  Write the Western digit equivalent for each shape you see.
  Combine them to form the full number.
  Put the complete expression in "studentAnswer" using Western digits.
  Do NOT change the numeric value — only convert the script.
  Example: student wrote "٣ × (-١٧) = -٤١" → studentAnswer = "3 × (-17) = -41"

STEP 2 — DERIVE the correct result from the operands in studentAnswer:
  Take operands A and B and operator from what you read in STEP 1.
  Compute A op B yourself. Store as "derivedResult".
  Example: studentAnswer has "3 × (-17) = -41" → operands are 3 and -17 → 3 × (-17) = -51 → derivedResult = -51

STEP 3 — JUDGE by comparing studentAnswer result vs derivedResult:
  Extract the result R the student wrote (last number after "=") from studentAnswer.
  Compare R with derivedResult:
    "-41" vs -51 → they differ → student answer is WRONG → grade = 0
    "-51" vs -51 → they match → correct → compare with modelAnswer → full grade
  For text answers: compare studentAnswer with modelAnswer for essential facts.

Output JSON only:
{
  "studentName": "name from paper or طالب",
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<Western digit transcription from STEP 1>",
      "derivedResult": "<your computed result from STEP 2, or null>",
      "grade": <number>,
      "maxGrade": <number>,
      "feedback": "<Arabic: state exactly what student wrote (e.g. -41) vs correct result (e.g. -51)>",
      "box": [ymin, xmin, ymax, xmax],
      "pageIndex": <0-based image index>
    }
  ]
}`;

    const parts: any[] = base64ImagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: "أنت ناظر امتحان يقرأ أوراق مكتوبة بالأرقام العربية الهندية. قاعدة حرجة: الرقم ٤ (أربعة) يشبه بصرياً الرقم 5 الإنجليزي لكنه أربعة وليس خمسة. اقرأ كل رقم بشكل مستقل باستخدام جدول التحويل: ٠=0، ١=1، ٢=2، ٣=3، ٤=4، ٥=5، ٦=6، ٧=7، ٨=8، ٩=9. بعد القراءة الصحيحة، احسب ناتج العملية من الأرقام التي قرأتها أنت، ثم قارن ناتجك بما كتبه الطالب — إن اختلفا فالإجابة خاطئة. لا تغير ما قرأته في studentAnswer. الملاحظات بالعربية."
      }
    });

    let data: any = { gradings: [], studentName: 'طالب غير معروف' };
    try { data = JSON.parse(cleanJson(response.text || '{}')); } catch(e) { console.error("Parse error:", e, "\nRaw:", response.text?.slice(0, 400)); }

    if (onProgress) onProgress(100, 100, 'grading');

    const rawGradings: any[] = data.gradings || [];
    const studentName: string = data.studentName || 'طالب غير معروف';

    const finalGradings = rawGradings.map((g: any) => ({
      ...g,
      maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0
    }));

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
