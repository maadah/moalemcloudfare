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

    // Secret watermark appended to every model answer the AI sees. A student
    // cannot write ¥¥ by hand, so if it appears in the transcribed student
    // answer, the AI copied the model answer instead of reading the ink.
    const COPY_MARKER = '\u00A5\u00A5'; // ¥¥
    const questionsForPrompt = flattenedQuestions.map(q => ({
      ...q,
      answer: q.answer ? String(q.answer) + ' ' + COPY_MARKER : q.answer
    }));

    const prompt = `Perform a RIGOROUS COMPARATIVE AUDIT of the student's paper against the MODEL ANSWER.
    
    Questions to grade (TOTAL ${flattenedQuestions.length}): ${JSON.stringify(questionsForPrompt)}. 
    Total Exam Max Grade: ${totalExamGrade}. 
    Required Questions Count: ${requiredQuestionsCount || 'All'}. 
    
    STEP 0 — DETECT THE TYPE OF EACH QUESTION (do this per question, do NOT assume a single subject):
      • TYPE NUMERIC: the answer is a number or a math expression with a final value (arithmetic,
        equations, fractions, percentages, physics/chemistry calculations). → grade by the FINAL RESULT.
      • TYPE TEXTUAL: the answer is a definition, explanation, law, reason, list, translation, grammar,
        or essay (common in biology, chemistry theory, islamic studies, arabic/english, "define/explain"
        questions). → grade by MEANING vs the model answer (keywords/concepts), accept paraphrases.

    MENTAL PROCEDURE (FOR EVERY QUESTION):
    1. Find the student's handwritten answer in the images.
    2. Read the model 'answer' from the JSON.
    3. Apply the correct grading mode for the detected type (see below).
    4. Compare and grade.

    ===== GRADING TYPE: NUMERIC (focus ONLY on the final result) =====
    Do NOT analyze the intermediate steps. Look ONLY at the final result, with this exact method:
    1. LOCATE the student's final result = the value written AFTER THE LAST "=" sign on the last line.
       Ignore any leading question number (like "٣)") and ignore unit symbols (م²، سم³).
    2. CONVERT the student's final result into Arabic WORDS, reading it carefully digit by digit,
       INCLUDING its sign and any fraction/decimal:
         ٢٥ → "خمسة وعشرون"   |   -١٥ → "سالب خمسة عشر"   |   ١/٢ → "واحد على اثنين"
         ٢١ → "واحد وعشرون" (NOT "اثنا عشر") — read every digit in order, do not flip.
    3. Take the model answer's FINAL number (the last number in the model 'answer') and convert it to
       Arabic WORDS the same way.
    4. COMPARE the two spoken-word values. Accept equivalent forms (١/٢ = ٠٫٥ = ٥٠٪).
         - same value  → grade = full marks (maxGrade).
         - different    → grade = 0.
    There is no partial credit for numeric questions: the final result is either right (full) or wrong (zero).

    ===== GRADING TYPE: TEXTUAL =====
    1. FACTUAL ACCURACY: compare the student's meaning with the MODEL ANSWER.
    2. KEYWORDS/CONCEPTS: check the essential points are present (wording may differ; accept paraphrases & synonyms).
    3. PARTIAL CREDIT: full marks if the core meaning matches; partial grade if some required points are
       present; zero only if blank, irrelevant, or fundamentally wrong.
    
    CRITICAL GRADING RULES (ALL TYPES):
    1. EXHAUSTIVE SEARCH: grade every visible answer individually.
    2. PEDANTIC LITERAL OCR (ZERO INFERENCE): in 'studentAnswer' act as a literal OCR robot. Transcribe
       EXACTLY what is written, character by character, keeping the student's own Arabic/Western digits.
       If the student wrote "68-", write "68-", even if the math suggests "28". DO NOT use logic to
       "correct" the transcription. NEVER copy the model answer into studentAnswer. If a question is blank
       (no ink), set studentAnswer "" and grade 0 — never invent or solve it.
       PRIORITIZE BOXED TEXT: a number the student boxed/circled is their definitive answer.
    3. COORDINATES: provide 'box' [ymin, xmin, ymax, xmax] precisely.
    4. JSON OUTPUT: {"results": [{"studentName": "...", "gradings": [{"questionId": "...", "studentAnswer": "...", "grade": number, "maxGrade": number, "feedback": "...", "box": [ymin, xmin, ymax, xmax], "pageIndex": number}]}]}.`;

    const parts: any[] = base64ImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: { 
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction:
          "أنت معلم عراقي خبير وروبوت استخراج نصوص حرفي، تصحّح كل المواد. أولاً حدّد نوع كل سؤال: رقمي (رياضيات/مسائل حسابية) أو نصي (تعريف/شرح/قانون/قواعد). 1) الاستخراج: اكتب ما تراه في خط الطالب بدقة 100% حتى لو كان خطأً، واحتفظ بنظام أرقامه (عربي يبقى عربي). إذا رأيت '68-' اكتب '68-' ولا تصححها، ولا تنسخ الإجابة النموذجية أبداً، والسؤال الفارغ تكتبه فارغاً ودرجته صفر. 2) التصحيح: للأسئلة الرقمية ركّز فقط على الناتج النهائي (آخر رقم بعد آخر علامة =)؛ حوّله إلى كلمات (مثل ٢٥ تصبح خمسة وعشرون، و-١٥ تصبح سالب خمسة عشر) واقرأ كل خانة بترتيبها دون قلب، ثم حوّل آخر رقم في الإجابة النموذجية إلى كلمات وقارن: إن تطابقا فالدرجة كاملة وإلا صفر، بلا درجة جزئية في الرياضيات. لا تحلّل الخطوات الوسطى. للأسئلة النصية قارن المعنى والمفاهيم بالنموذج واقبل إعادة الصياغة وامنح درجة جزئية إن غطّى بعض النقاط. اجعل الملاحظات (feedback) بالعربية الفصحى وبأسلوب تربوي."
      }
    });

    const data = JSON.parse(cleanJson(response.text || '{}'));

    if (onProgress) onProgress(100, 100, 'grading');

    // Flatten results if model outputted directly to 'gradings'
    const results = data.results || (data.gradings ? [{ studentName: data.studentName || 'طالب غير معروف', gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    return { 
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => {
          const maxGrade = g.maxGrade || flattenedQuestions.find((fq: any) => fq.id === g.questionId)?.grade || 0;

          // ── Copy detection via the secret ¥¥ marker ──────────────────────
          // If ¥¥ appears in the transcription, the AI copied the model answer
          // instead of reading the student's ink. Flag it, then strip the marker
          // from every visible field.
          const stripMarker = (s: any) => String(s ?? '').split(COPY_MARKER).join('').replace(/\u00A5/g, '').trim();
          const markerCopied = String(g.studentAnswer ?? '').includes(COPY_MARKER);
          const cleanStudentAnswer = stripMarker(g.studentAnswer);

          let feedback = g.feedback || '';
          if (markerCopied) {
            feedback = '\u26A0\uFE0F تحذير: تم اكتشاف نسخ الاجابة النموذجية بدل قراءة خط الطالب، يرجى المراجعة اليدوية. ' + feedback;
          }

          return {
            ...g,
            studentAnswer: cleanStudentAnswer,
            feedback,
            maxGrade
          };
        });
        
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

