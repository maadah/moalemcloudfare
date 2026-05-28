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

    const prompt = `Perform a STRICT LITERAL COMPARISON between the student's paper and the MODEL ANSWER.
    
    Current Subject: ${subject}.
    Questions to evaluate (TOTAL ${flattenedQuestions.length}): ${JSON.stringify(flattenedQuestions)}. 
    Total Exam Max Grade: ${totalExamGrade}. 
    Required Questions Count: ${requiredQuestionsCount || 'All'}. 

    ===== TWO STRICTLY SEPARATED PHASES =====

    PHASE 1 — PURE OCR EXTRACTION (NO MATH, NO THINKING):
    For every question, locate the student's handwritten answer in the images and copy it into the 'studentAnswer' field EXACTLY as written, character by character.
    - You are NOT a math solver in this phase. You are an ink-shape copier.
    - Copy every digit, every sign (- + × ÷ =), every variable, every fraction line, EXACTLY as it appears on the paper.
    - If the student wrote "3×-5=-13", you MUST write "3×-5=-13". Do NOT change "-13" to "-15" because the model answer says so.
    - If the student wrote "68-", write "68-". Do NOT change to "28" or anything else.
    - If you cannot read a character clearly, write what your eyes see, never what you "expect" the student to have written.
    - PRIORITIZE BOXED/CIRCLED TEXT: If the student boxed or circled their final answer, transcribe THAT exact value into studentAnswer.
    - Preserve Arabic/Hindi numerals (٠-٩) and Western digits exactly as written. Preserve all signs and operators.
    - DO NOT replace the student's writing with the model answer under any circumstance.

    PHASE 2 — JUDGMENT (RIGHT OR WRONG ONLY):
    After you have already copied the student's literal answer into 'studentAnswer', compare that literal text against the MODEL 'answer'.
    Your job is ONLY to decide: is what the student wrote identical (or mathematically equivalent in form) to the model answer? You are NOT here to fix, polish, or rewrite anything the student wrote.

    ${isMath ? `===== MATHEMATICS JUDGMENT RULES =====

    1. EXACT NUMERIC MATCH IS REQUIRED:
       - Every single number written by the student must match the model answer's corresponding number EXACTLY, digit for digit, sign for sign.
       - If the model answer is "-15" and the student wrote "-13", the answer is WRONG. The matching sign does NOT make it right.
       - If the model answer is "17" and the student wrote "18", it is WRONG.
       - If the model answer is "23" and the student wrote "-23", it is WRONG (sign differs).
       - A close number is NOT a correct number. A number is either identical to the model or it is wrong.

    2. EVERY OPERATION BETWEEN NUMBERS MUST BE VERIFIED INDIVIDUALLY:
       For each arithmetic operation the student wrote, check whether the two operand numbers and the result the student wrote match what is required:
       - Multiplication: if the student wrote "4 × 2 = 9", look at the END RESULT "9" and ask: does the number 9 arise from multiplying 4 by 2? If not, this line is WRONG.
       - Division: if the student wrote "85 ÷ 5 = 18", ask: does 18 arise from 85 divided by 5? It does not (the correct outcome is 17). This line is WRONG.
       - Subtraction: if the student wrote "10 - 7 = 4", ask: does 4 arise from 10 minus 7? It does not. WRONG.
       - Addition: if the student wrote "6 + 5 = 12", ask: does 12 arise from 6 plus 5? It does not. WRONG.
       - Signed numbers: "3 × -5 = -13" — the result -13 does NOT arise from 3 times -5 (which is -15). WRONG, even though the sign is negative in both.
       Do NOT decide based on whether "the sign looks right" or "it is close enough". The numeric value the student wrote must be the value that the operation actually produces.

    3. NO PARTIAL CREDIT FOR WRONG FINAL NUMBERS:
       If the student's final numeric answer does not match the model answer's final numeric value exactly, the question does not earn full marks. A wrong final number is a wrong final number, regardless of how close it is or whether the sign matches.
       The only legitimate partial credit is when the student answered SOME sub-parts of a multi-part question correctly and OTHERS incorrectly — grade each sub-part independently.

    4. ORDER OF OPERATIONS (PEMDAS/BODMAS) IS ENFORCED:
       - Multiplications (×) and Divisions (÷) are performed BEFORE Additions (+) and Subtractions (-).
       - Example: 7 × 3 + 2 = 23. If the student wrote 35, the answer is WRONG (zero credit for that part).
       - Example: 21 - 4 × 2 = 13. If the student wrote 34, the answer is WRONG.

    5. DO NOT INVENT OR REWRITE NUMBERS:
       You never substitute the model's number into the student's answer field. You never "fix" the student's arithmetic. You only judge what the student actually wrote.` 
    : 
    `===== GENERAL JUDGMENT RULES =====
    1. Compare the student's literal answer to the model answer.
    2. The student's answer must contain the essential facts/keywords required by the model answer.
    3. Do NOT rewrite the student's words to make them match the model. Judge what was actually written.
    4. Partial credit is allowed only when distinct required points were partially covered.`}

    ===== OUTPUT RULES =====

    1. EXHAUSTIVE COVERAGE: Provide an entry for every question id in the list. If the student left a question blank, set 'studentAnswer' to "" (empty) and grade 0.
    2. studentAnswer FIELD = LITERAL TRANSCRIPTION ONLY. It must reflect exactly what is on the paper. It must NEVER be a copy of the model answer when the student wrote something different.
    3. COORDINATES: Provide the 'box' [ymin, xmin, ymax, xmax] around the student's answer region precisely.
    4. JSON OUTPUT: {"results": [{"studentName": "...", "gradings": [{"questionId": "...", "studentAnswer": "...", "grade": number, "maxGrade": number, "feedback": "...", "box": [ymin, xmin, ymax, xmax], "pageIndex": number}]}]}.`;

    const parts: any[] = base64ImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: { 
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath ? 
          "أنت حَكَم رياضيات دقيق جداً وروبوت استخراج نصوص حرفي. مهمتك ليست تغيير ما كتبه الطالب ولا إعادة كتابته بصورة أفضل، بل الحكم على صحته أو خطئه فقط. 1) مرحلة الاستخراج: يجب أن تكتب في حقل studentAnswer ما تراه في الورقة بدقة 100% حتى لو كان خطأً رياضياً. إذا رأيت '68-' اكتب '68-' ولا تكتب '28' بناءً على استنتاجك. إذا كتب الطالب '3×-5=-13' اكتب '3×-5=-13' ولا تستبدلها بـ '-15' لأن النموذج يقول ذلك. يمنع منعاً باتاً تغيير أي رقم أو رمز يظهر في الورقة، ويمنع منعاً باتاً نقل قيمة النموذج إلى حقل إجابة الطالب. 2) مرحلة الحكم: المقارنة حرفية ورقمية مطلقة. كل رقم كتبه الطالب يجب أن يطابق رقم النموذج تماماً (نفس القيمة ونفس الإشارة). مطابقة الإشارة وحدها لا تعني أن الرقم صحيح: '-13' ليست '-15' حتى وإن كانتا سالبتين. إذا كتب الطالب رقماً نهائياً مختلفاً عن رقم النموذج فالجواب خاطئ ولا يستحق الدرجة الكاملة. كذلك تحقق من كل عملية حسابية بين الأرقام (ضرب، قسمة، طرح، جمع): انظر إلى الناتج الذي كتبه الطالب واسأل هل يأتي هذا الناتج فعلاً من العملية بين العددين المكتوبين؟ إن لم يكن كذلك فالسطر خاطئ. لا تعتمد سياسة متساهلة في الأرقام النهائية في الرياضيات. الملاحظات (feedback) باللغة العربية الفصحى وبأسلوب تربوي عراقي مختصر." :
          "أنت حَكَم محترف وروبوت استخراج نصوص حرفي. مهمتك ليست تغيير ما كتبه الطالب ولا إعادة كتابته بصورة أفضل، بل الحكم على إجابته. يجب نقل إجابة الطالب إلى حقل studentAnswer بدقة كما هي مكتوبة تماماً دون أي تعديل، ولا يجوز نقل نص النموذج إلى هذا الحقل. عند الحكم، قارن نص الطالب الحرفي بنص النموذج، وامنح الدرجة بناءً على وجود المفاهيم والمعلومات الأساسية المطلوبة. يجب أن تكون الملاحظات والتعليقات (feedback) باللغة العربية الفصحى دائماً ومختصرة."
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

