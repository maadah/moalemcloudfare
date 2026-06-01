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
    
    // 1. فحص واكتشاف مادة الرياضيات تلقائياً
    const isMath = subject.includes('رياضيات') || 
                   subject.toLowerCase().includes('math') || 
                   subject.includes('الرياضيات');

    let prompt = "";
    let systemInstruction = "";

    if (isMath) {
      // ==========================================
      // استراتيجية الرياضيات المتقدمة المقترحة (الناتج أولاً كبوابة عبور + فحص التعويض العكسي)
      // ==========================================
      prompt = `Perform a TWO-PHASE MATHEMATICAL AUDIT on the student's paper against the MODEL ANSWER.
    
      Current Subject: ${subject}.
      Questions to grade (TOTAL ${flattenedQuestions.length}): ${JSON.stringify(flattenedQuestions)}. 
      Total Exam Max Grade: ${totalExamGrade}. 
      Required Questions Count: ${requiredQuestionsCount || 'All'}. 
      
      GATEWAY GRADING RULE (CRITICAL):
      - PHASE 1 (The Final Answer Gate): Look ONLY at the final boxed, circled, or definitive result of the student for each question. Compare it to the Model Answer's final result.
        * If they MATCH exactly (e.g., Model is 13 and Student final result is 13), STOP THINKING. Award FULL GRADE immediately. Do not over-analyze steps or hallucinate errors.
        * If they DO NOT MATCH (e.g., Model is 13, but Student final result is 17 or 11), you MUST proceed to PHASE 2.
      
      - PHASE 2 (Deep Substitution Check & Reverse Verification): 
        * Since the final answer is wrong, dissect the student's steps character by character.
        * Check for "Substitution Errors": Did the student swap numbers or transfer them incorrectly from the main question? (e.g., writing 3×2+5 instead of 3+2×5). If they changed the positions of numbers, this is a fatal substitution error.
        * Apply a reverse consistency check to find exactly which sub-operation or priority step (PEMDAS/BODMAS) broke down.
      
      CRITICAL GRADING RULES:
      1. EXHAUSTIVE SEARCH: Grade every visible mark individually.
      2. PEDANTIC LITERAL OCR: In the 'studentAnswer' field, you MUST act as a Literal OCR Robot. Transcribe EXACTLY what is written on the paper, character by character (e.g., if they wrote "3×2+5=17", transcribe "3×2+5=17"). Do not let math logic auto-correct your transcription.
      3. COORDINATES: Provide the 'box' [ymin, xmin, ymax, xmax] precisely.
      4. JSON OUTPUT: {"results": [{"studentName": "...", "gradings": [{"questionId": "...", "studentAnswer": "...", "grade": number, "maxGrade": number, "feedback": "...", "box": [ymin, xmin, ymax, xmax], "pageIndex": number}]}]}.`;

      systemInstruction = `أنت مصحح رياضيات خوارزمي صارم وعالي الدقة يعمل على مرحلتين شرطيتين:
      المرحلة الأولى (بوابة الناتج النهائي): اذهب مباشرة إلى الناتج النهائي الذي كتبه الطالب للمسألة. إذا كان مطابقاً تماماً للجواب النموذجي المرفق، اعتبر الإجابة صحيحة تماماً وأعطه الدرجة كاملة (Full Grade) وتخطى تدقيق الخطوات تماماً لحمايتك وحماية الطالب من الهلوسة البصرية الحرفية.
      
      المرحلة الثانية (التشريح والتدقيق العكسي): إذا كان الناتج النهائي خاطئاً أو غير متطابق، هنا فقط تبدأ بالتدقيق السطري:
      1) انقل ما كتبه الطالب في حقل "studentAnswer" بحرفية تامة دون أي تعديل (حتى لو كان خطأ حسابياً).
      2) ابحث عن "خطأ التعويض" (Substitution Error): هل نقل الطالب الأرقام بشكل خاطئ أو عكس أماكنها بالمعادلة؟ حدد هذا في التعليق واخصم بناءً عليه.
      3) تتبع ترتيب العمليات سطر بوسطر عبر سؤال عكسي: "هل هذا السطر هو النتيجة المنطقية للسطر الذي قبله؟" لتحديد أول خطوة تعثر فيها الطالب.
      4) اكتب الـ feedback باللغة العربية الفصحى بأسلوب تربوي عراقي واضح يوضح سبب خصم الدرجة (الناتج، التعويض، أو الخطوات).`;

    } else {
      // ==========================================
      // النسخة الأصلية المستقرة الخاصة بك للمواد النصية الأخرى
      // ==========================================
      prompt = `Perform a RIGOROUS COMPARATIVE AUDIT of the student's paper against the MODEL ANSWER.
    
      Current Subject: ${subject}.
      Questions to grade (TOTAL ${flattenedQuestions.length}): ${JSON.stringify(flattenedQuestions)}. 
      Total Exam Max Grade: ${totalExamGrade}. 
      Required Questions Count: ${requiredQuestionsCount || 'All'}. 
      
      MENTAL PROCEDURE FOR GRADING (DO THIS INTERNALLY FOR EVERY QUESTION):
      1. Identify Question: Find the student's handwritten answer for a question in the images.
      2. Read Model Answer: Carefully read the 'answer' provided in the JSON for this question. 
      3. COMPARE: Match student result with model answer result.
      
      GRADING STANDARDS:
      1. FACTUAL ACCURACY: Compare student answers precisely with the MODEL ANSWER.
      2. KEYWORDS: Check for essential concepts.
      3. LOGICAL STEPS: The process must align with the model answer's logic.
      
      CRITICAL GRADING RULES:
      1. EXHAUSTIVE SEARCH: Grade every visible mark individually.
      2. PEDANTIC LITERAL OCR (ZERO INFERENCE): In the 'studentAnswer' field, you MUST act as a Literal OCR Robot. 
         - Transcribe EXACTLY what is written, character by character. 
         - DO NOT use math logic to "correct" the student's transcription.
         - PRIORTIZE BOXED TEXT: If a student has drawn a box or circle around a number, that number is the student's definitive answer and MUST be transcribed exactly.
         - Transcribe Arabic/Hindi numerals (٠-٩) and symbols (=, -, +, ×, ÷) with absolute fidelity to the ink on the paper.
      3. COORDINATES: Provide the 'box' [ymin, xmin, ymax, xmax] precisely.
      4. JSON OUTPUT: {"results": [{"studentName": "...", "gradings": [{"questionId": "...", "studentAnswer": "...", "grade": number, "maxGrade": number, "feedback": "...", "box": [ymin, xmin, ymax, xmax], "pageIndex": number}]}]}.`;

      systemInstruction = "أنت معلم محترف وروبوت استخراج نصوص حرفي. يجب استخراج إجابة الطالب بدقة كما هي مكتوبة تماماً. اعتمد سياسة تصحيح مرنة؛ إذا كانت الإجابة قريبة من الصواب أو تعبر عن فهم الموضوع، اخصم درجة بسيطة فقط. يجب أن تكون الملاحظات والتعليقات (feedback) باللغة العربية الفصحى دائماً.";
    }

    const parts: any[] = base64ImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: { 
        responseMimeType: "application/json",
        temperature: 0, // صفر للحفاظ على دقة مطابقة تامة
        systemInstruction: systemInstruction
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
