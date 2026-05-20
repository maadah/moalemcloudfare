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

    const prompt = `You are grading a student exam paper. Follow this exact procedure for EVERY question.

    Subject: ${subject}.
    Questions: ${JSON.stringify(flattenedQuestions)}.
    Total Exam Max Grade: ${totalExamGrade}.
    Required Questions Count: ${requiredQuestionsCount || 'All'}.

    ════════════════════════════════════════
    STEP 1 — CLASSIFY THE QUESTION TYPE
    ════════════════════════════════════════
    Before grading, classify each question into one of two types:

    TYPE A — DIRECT ANSWER (رقم أو كلمة مباشرة):
    A question where the expected answer is a single number, value, word, or short phrase.
    Examples: "احسب ناتج 85÷5", "ما عاصمة العراق؟", true/false, multiple choice, fill-in-the-blank with one word.
    → Recognition: the model answer (field "answer") is a short value (number or 1-3 words).

    TYPE B — PROBLEM WITH WORKING (مسألة بها شرح وخطوات):
    A question requiring the student to show reasoning, steps, or explanation to reach an answer.
    Examples: word problems, geometry proofs, multi-step calculations with shown work, essay-style.
    → Recognition: the model answer contains steps, explanation, or multiple lines.

    ════════════════════════════════════════
    STEP 2 — LOCATE THE STUDENT'S ANSWER
    ════════════════════════════════════════
    Find the student's handwritten response area on the paper for this question.
    - Scan the area carefully.
    - If blank: studentAnswer = "لا توجد إجابة", grade = 0.
    - BOXED or CIRCLED content = the student's final definitive answer, prioritize it.
    - Crossed-out text = ignore it, use only what is NOT crossed out.

    ════════════════════════════════════════
    STEP 3 — GRADE BASED ON QUESTION TYPE
    ════════════════════════════════════════

    ── FOR TYPE A (Direct Answer) ──
    • DO NOT attempt to read or transcribe the student's handwriting literally.
    • Instead: COMPARE visually — does what the student wrote MATCH the model answer value?
    • Re-calculate the model answer yourself to verify it is correct first.
    • MATCH = full grade. NO MATCH = 0 (or partial if partially correct, e.g. correct number wrong unit).
    • For true/false and multiple choice: simple match check only.
    • studentAnswer field: write the value you identified the student wrote (just the final number/word).
    • DO NOT deduct for messy handwriting if the value is correct.

    ── FOR TYPE B (Problem with Working) ──
    • Read the question text carefully to understand what is being asked.
    • Examine the student's FULL working/steps shown on the paper.
    • Evaluate:
      - Are the steps logical and correct?
      - Is the method appropriate for the question?
      - Is the final answer correct?
    • GRADING SCALE for Type B:
      - All steps correct + correct final answer → full grade.
      - Correct method/steps but arithmetic error in final answer only → deduct 1 mark maximum.
      - Partial understanding shown → award partial grade proportionally.
      - Wrong method entirely → 0 or minimal marks.
    • studentAnswer field: summarize the student's approach and final answer as seen.
    ${isMath ? `
    ── MATH ARITHMETIC INTEGRITY (applies to both types) ──
    • YOU MUST verify all arithmetic yourself. 85÷5=17 NOT 18. Always double-check.
    • PEMDAS/BODMAS: × and ÷ before + and −. This is non-negotiable.
    • If student's final answer matches the correct mathematical result → correct.
    ` : `
    ── NON-MATH GRADING STANDARD ──  
    • Focus on factual accuracy and key concepts.
    • Award partial credit for partially correct answers.
    `}

    ════════════════════════════════════════
    STEP 4 — OUTPUT
    ════════════════════════════════════════
    JSON OUTPUT: {"results": [{"studentName": "...", "gradings": [{"questionId": "...", "studentAnswer": "...", "grade": number, "maxGrade": number, "feedback": "...", "box": [ymin, xmin, ymax, xmax], "pageIndex": number}]}]}.
    - feedback: Arabic only (العربية الفصحى), constructive and educational tone.
    - box: [ymin, xmin, ymax, xmax] coordinates of the student's answer area on the page.
    - pageIndex: 0-based index of the image page containing this answer.`;`;

    const parts: any[] = base64ImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: { 
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath ?
          "أنت مصحح رياضيات خبير. لكل سؤال: أولاً صنّف نوعه — (أ) إجابة مباشرة (رقم أو قيمة واحدة): لا تحاول قراءة الخط الحرفي، فقط قارن بصرياً هل ما كتبه الطالب يطابق الجواب النموذجي أم لا، صح = الدرجة كاملة، خطأ = صفر أو جزئي. (ب) مسألة بها خطوات وشرح: افهم المطلوب من السؤال أولاً، ثم قيّم منطق الخطوات والطريقة والناتج النهائي، إذا كانت الخطوات صحيحة والناتج فقط خطأ حسابي اخصم درجة واحدة فقط. في كلتا الحالتين: أعد حساب الجواب النموذجي بنفسك للتحقق، راعِ أولوية العمليات (ضرب وقسمة قبل جمع وطرح). الملاحظات بالعربية الفصحى بأسلوب تربوي عراقي." :
          "أنت معلم محترف خبير في التصحيح. لكل سؤال: صنّف نوعه أولاً — (أ) إجابة مباشرة (كلمة أو عبارة قصيرة): قارن بصرياً ما كتبه الطالب بالجواب النموذجي مباشرة. (ب) سؤال يتطلب شرحاً أو فهماً: افهم المطلوب من السؤال، ثم قيّم مدى فهم الطالب وصحة إجابته، اعتمد تصحيحاً مرناً ومتدرجاً. الملاحظات بالعربية الفصحى دائماً."
      }
    });

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

