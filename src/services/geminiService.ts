import { GoogleGenAI } from "@google/genai";
import { formatApiError } from "./apiErrors";

// ─────────────────────────────────────────────────────────────────────────────
// Types — identical to original
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// API key helpers — dual-key fallback (primary → backup on any error)
//
// Cloudflare Pages environment variables (Settings → Environment Variables):
//   VITE_GEMINI_API_KEY            ← primary key
//   VITE_GEMINI_API_KEY_SECONDARY  ← backup key
// ─────────────────────────────────────────────────────────────────────────────

const LS_PRIMARY = 'GEMINI_API_KEY_FALLBACK';
const LS_BACKUP  = 'GEMINI_API_KEY_BACKUP';

const readKey = (envName: string, lsKey: string): string => {
  try {
    const envVal = (import.meta.env as Record<string, string>)[envName];
    if (envVal && envVal !== 'undefined' && envVal.trim() !== '') {
      return envVal.trim();
    }
  } catch { /* */ }
  try {
    const nodeVal = (process.env as any)?.[envName];
    if (nodeVal && nodeVal !== 'undefined' && nodeVal !== '') return String(nodeVal).trim();
  } catch { /* */ }
  return (localStorage.getItem(lsKey) || '').trim();
};

const getPrimaryKey = (): string => readKey('VITE_GEMINI_API_KEY', LS_PRIMARY);
const getBackupKey  = (): string =>
  readKey('VITE_GEMINI_API_KEY_SECONDARY', LS_BACKUP) ||
  readKey('VITE_GEMINI_API_KEY_2',         LS_BACKUP);

const getApiKeyErrorMessage = () => {
  const isCloudflare = window.location.hostname.includes('.pages.dev') ||
                       window.location.hostname.includes('cloudflare');
  const isNetlify = window.location.hostname.includes('netlify.app');
  if (isCloudflare) {
    return 'مفتاح API غير مضبوط. تأكد من إضافة المتغير VITE_GEMINI_API_KEY في Cloudflare Pages → Settings → Environment Variables ثم أعد النشر (Redeploy). يمكنك أيضاً إدخاله يدوياً من أيقونة الإعدادات (⚙️).';
  }
  if (isNetlify) {
    return 'مفتاح API غير مضبوط. إذا كنت تستخدم Netlify، تأكد من إضافة المفتاح باسم VITE_GEMINI_API_KEY في إعدادات البيئة. يمكنك أيضاً إدخاله يدوياً من أيقونة الإعدادات (⚙️) في الأعلى.';
  }
  return 'مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) في الأعلى وإدخال مفتاح Gemini API للمتابعة.';
};

export const savePrimaryApiKey = (key: string): void => {
  localStorage.setItem(LS_PRIMARY, key.trim());
};
export const saveBackupApiKey = (key: string): void => {
  localStorage.setItem(LS_BACKUP, key.trim());
};
export const hasBackupApiKey = (): boolean => !!getBackupKey();

/**
 * Try the primary key first. If anything fails AND a backup key is configured,
 * automatically retry with the backup. Preserves original error if no backup.
 */
async function withKeyFallback<T>(
  fn: (ai: GoogleGenAI, keyLabel: string) => Promise<T>
): Promise<T> {
  const primary = getPrimaryKey();
  const backup  = getBackupKey() || undefined;

  if (!primary) throw new Error(getApiKeyErrorMessage());

  try {
    return await fn(new GoogleGenAI({ apiKey: primary }), 'primary');
  } catch (primaryError: any) {
    if (!backup) throw primaryError;
    console.warn('[gemini] Primary key failed, switching to backup.', primaryError?.message?.slice(0, 80));
    try {
      return await fn(new GoogleGenAI({ apiKey: backup }), 'backup');
    } catch (backupError: any) {
      console.error('[gemini] Backup key also failed.');
      throw backupError;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities — identical to original
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// extractExamFromDualImages — identical prompt to original
// ─────────────────────────────────────────────────────────────────────────────

export async function extractExamFromDualImages(
  questionImages: string[],
  answerImages: string[]
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
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

    const response = await withKeyFallback((ai) =>
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
        config: { 
          responseMimeType: "application/json",
          temperature: 0.1,
          systemInstruction: "You are an expert Iraqi teacher. Extract exam data precisely into JSON. Ensure all numbers, symbols, and mathematical expressions are captured exactly as shown."
        }
      })
    );

    const data = JSON.parse(cleanJson(response.text || '{}'));

    if (data && Array.isArray(data.questions)) {
      data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
    }
    return data || { title: "", questions: [] };
  } catch (error) {
    console.error("Extraction error:", error);
    throw new Error(formatApiError(error));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// extractExamFromImages — identical prompt to original
// ─────────────────────────────────────────────────────────────────────────────

export async function extractExamFromImages(base64Images: string[]): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
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

    const response = await withKeyFallback((ai) =>
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
        config: { 
          responseMimeType: "application/json",
          temperature: 0.1,
          systemInstruction: "You are an expert Iraqi teacher. Extract exam data into JSON with high precision. Capture all mathematical formulas and Arabic digits correctly. DO NOT perform arithmetic yourself during extraction; strictly copy exactly what is written on the page or provided in the input. If you see 85/5, DO NOT calculate 17 or 18, just write the expression or the result exactly as it appears."
        }
      })
    );

    const data = JSON.parse(cleanJson(response.text || '{}'));

    if (data && Array.isArray(data.questions)) {
      data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
    }
    return data || { title: "", questions: [] };
  } catch (error) {
    console.error("Extraction error:", error);
    throw new Error(formatApiError(error));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// gradeStudentPaper — identical prompt to original
// ─────────────────────────────────────────────────────────────────────────────

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

    const prompt = `You are a visual data extraction and comparison engine. Look directly at the handwritten image — do NOT convert to text first.

    Subject: ${subject}.
    Questions with expected answers (TOTAL ${flattenedQuestions.length}): ${JSON.stringify(flattenedQuestions)}.
    Total Max Score: ${totalExamGrade}.
    Required Questions Count: ${requiredQuestionsCount || 'All'}.

    FOR EACH QUESTION — FOLLOW THIS EXACT SEQUENCE:

    STEP 1 — LOCATE: Find the region on the image where the student wrote their response for this question number/label.

    STEP 2 — EXTRACT (visual scan only, zero text conversion):
       - Look at the ink marks directly in the image.
       - Copy what you SEE into the studentAnswer field — exactly as written, character by character.
       - If student wrote "68-" → studentAnswer = "68-". If student wrote "-41" → studentAnswer = "-41".
       - NEVER alter, fix, or interpret what is written. You are a camera, not a reader.
       - BOXED or CIRCLED ink = the student's final answer — extract it first.
       - Crossed-out ink = ignore it entirely.
       - Blank region → studentAnswer = "لا توجد إجابة".
       - Unclear ink → write what you see, note ambiguity: e.g. "٤١ أو ٥١".

    STEP 3 — COMPARE: Compare the extracted studentAnswer against the 'answer' field in the JSON.
    ${isMath ? `
       MATH COMPARISON RULES:
       - Re-calculate the expected answer yourself first. 85÷5=17 (verify: 17×5=85 ✓).
       - PEMDAS/BODMAS: × and ÷ before + and −. Always.
       - studentAnswer matches expected → full score.
       - studentAnswer wrong → 0 (or partial if method/steps partially correct).
       - Steps correct but final value wrong → deduct 1 point max.
    ` : `
       COMPARISON RULES:
       - studentAnswer matches expected meaning → full score.
       - Partially correct → proportional partial score.
       - Wrong → 0.
    `}

    STEP 4 — OUTPUT JSON only, no markdown:
    {"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

    - studentAnswer: exactly what the ink says — never the expected answer unless they visually match.
    - feedback: Arabic (العربية الفصحى), brief and constructive.
    - box: [ymin, xmin, ymax, xmax] pixel region (0–1000 scale) of the student's written answer.
    - pageIndex: 0-based index of the image page.`;`;

    const parts: any[] = base64ImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await withKeyFallback((ai) =>
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
        config: { 
          responseMimeType: "application/json",
          temperature: 0,
          systemInstruction: isMath ?
            "أنت محرك بصري لاستخراج البيانات من الصور ومقارنتها. مهمتك الوحيدة: (١) انظر مباشرة إلى الصورة وحدد موقع إجابة الطالب لكل سؤال. (٢) استخرج ما هو مكتوب بالحبر حرفاً بحرف كما تراه — أي رقم تراه انقله كما هو بدون تغيير، إذا رأيت 68- انقل 68- وليس غيرها. (٣) قارن ما استخرجته بالجواب المتوقع في الـ JSON. لا تحوّل الصورة إلى نص أولاً — تعامل معها مباشرة. أولوية العمليات (ضرب وقسمة قبل جمع وطرح) يجب مراعاتها عند المقارنة. الملاحظات بالعربية الفصحى." :
            "أنت محرك بصري لاستخراج البيانات من الصور ومقارنتها. مهمتك: (١) انظر مباشرة إلى الصورة وحدد موقع إجابة الطالب. (٢) استخرج ما هو مكتوب كما تراه بالضبط — لا تغيّر ولا تفسّر ولا تكمل. (٣) قارن ما استخرجته بالجواب المتوقع في الـ JSON وأعط الدرجة. لا تحوّل الصورة إلى نص أولاً. الملاحظات بالعربية الفصحى دائماً."
        }
      })
    );

    const data = JSON.parse(cleanJson(response.text || '{}'));

    if (onProgress) onProgress(100, 100, 'grading');

    // Flatten results if model outputted directly to 'gradings'
    const results = data.results || (data.gradings ? [{ studentName: data.studentName || 'طالب غير معروف', gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    return { 
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => ({
          ...g,
          maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0
        }));
        
        // Ensure total grade is calculated by summing individual question grades
        const computedTotal = gradingsWithMax.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);
        
        return {
          ...r,
          gradings: gradingsWithMax,
          totalGrade: computedTotal
        };
      })
    };
  } catch (error: any) {
    console.error("Grading error:", error);
    const alreadyFormatted = error?.message?.includes('💡') || error?.message?.includes('🔄');
    throw new Error(alreadyFormatted ? error.message : formatApiError(error));
  }
}
