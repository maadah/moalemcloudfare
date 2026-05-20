import { GoogleGenAI } from "@google/genai";
import { formatApiError, parseApiError } from "./apiErrors";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Question {
  id: string;
  text: string;
  answer: string;
  grade: number;
  type: "text" | "true-false" | "multiple-choice" | "fill-in-the-blanks";
  options?: string[];
  subQuestions?: Question[];
  requiredSubCount?: number;
  subStyle?: "numbers" | "letters";
  questionImage?: string;
  answerImage?: string;
  gradingCriteria?: string; // Optional rubric the teacher writes; never a full answer
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
// API key helpers
// ─────────────────────────────────────────────────────────────────────────────

const getApiKey = (): string => {
  const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
  if (viteKey && viteKey !== "undefined" && viteKey !== "") return viteKey.trim();
  try {
    const envKey =
      process.env?.GEMINI_API_KEY || (process.env as any)?.VITE_GEMINI_API_KEY;
    if (envKey && envKey !== "undefined" && envKey !== "") return envKey.trim();
  } catch {
    // process not available in browser
  }
  return (localStorage.getItem("GEMINI_API_KEY_FALLBACK") || "").trim();
};

const getApiKeyErrorMessage = (): string => {
  const isNetlify = window.location.hostname.includes("netlify.app");
  return isNetlify
    ? "مفتاح API غير مضبوط. إذا كنت تستخدم Netlify، تأكد من إضافة المفتاح باسم VITE_GEMINI_API_KEY في إعدادات البيئة. يمكنك أيضاً إدخاله يدوياً من أيقونة الإعدادات (⚙️) في الأعلى."
    : "مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) في الأعلى وإدخال مفتاح Gemini API للمتابعة.";
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const cleanJson = (text: string): string => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

async function compressImage(
  url: string,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.5
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      if (width > height) {
        if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
      } else {
        if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not get canvas context"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = () => reject(new Error("فشل في تحميل الصورة لمعالجتها"));
  });
}

function fixInlineSubQuestions(q: any, parentId?: string, level = 1): any {
  const id =
    q.id || `${parentId || "q"}_${Math.random().toString(36).substr(2, 4)}`;
  if (q.subQuestions && q.subQuestions.length > 0) {
    return {
      ...q,
      id,
      subQuestions: q.subQuestions.map((sq: any, i: number) =>
        fixInlineSubQuestions(sq, `${id}_${i}`, level + 1)
      ),
    };
  }
  return { ...q, id };
}

// ─────────────────────────────────────────────────────────────────────────────
// extractExamFromDualImages
// ─────────────────────────────────────────────────────────────────────────────

export async function extractExamFromDualImages(
  questionImages: string[],
  answerImages: string[]
): Promise<{ title: string; questions: Question[]; requiredQuestionsCount?: number }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    const compress = (b64: string) =>
      compressImage(
        b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`,
        1500, 1500, 0.7
      );

    const [qImagesData, aImagesData] = await Promise.all([
      Promise.all(questionImages.map(compress)),
      Promise.all(answerImages.map(compress)),
    ]);

    const prompt = `Analyze these Iraqi exam questions and their model answers. Match them.
Output a JSON object with:
- title: String (exam subject)
- requiredQuestionsCount: Number (if specified, e.g. "Answer 5 only")
- questions: Array of objects with {text, grade, answer, type, options, subQuestions:[]}

CRITICAL:
- Preserve Arabic digits (٠-٩).
- For sub-questions (branch A, B, or numbers 1, 2), nest them inside the parent question.
- GRADE EXTRACTION: Strictly copy the grade written on the paper. DO NOT divide the parent grade among sub-questions yourself.
- Clean the 'text' field by removing redundant identifiers (like "س1:", "أ-", "1-") if already represented by structure.
- If a question has sub-questions, the parent 'text' should be the general instruction only.
- If images are text-only, extract the full text.`;

    const parts: any[] = [
      { text: "QUESTIONS IMAGES:" },
      ...qImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } })),
      { text: "MODEL ANSWERS IMAGES:" },
      ...aImagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } })),
      { text: prompt },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        systemInstruction:
          "You are an expert Iraqi teacher. Extract exam data precisely into JSON. Ensure all numbers, symbols, and mathematical expressions are captured exactly as shown.",
      },
    });

    const data = JSON.parse(cleanJson(response.text || "{}"));
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
// extractExamFromImages
// ─────────────────────────────────────────────────────────────────────────────

export async function extractExamFromImages(
  base64Images: string[]
): Promise<{ title: string; questions: Question[]; requiredQuestionsCount?: number }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    const imagesData = await Promise.all(
      base64Images.map((b64) =>
        compressImage(
          b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`,
          1500, 1500, 0.7
        )
      )
    );

    const prompt = `Extract questions from this Iraqi exam paper.
Output a JSON object with:
- title: String
- requiredQuestionsCount: Number
- questions: Array of objects with {text, grade, answer (leave empty if not found), type}.

CRITICAL:
- Preserve Arabic digits (٠-٩).
- Nest sub-questions properly.
- GRADE EXTRACTION: Strictly copy original grades. DO NOT invent or divide grades for sub-questions.
- Clean the 'text' field by removing redundant identifiers if already represented by structure.
- If a question has sub-questions, the parent 'text' should be the general instruction only.`;

    const parts: any[] = [
      ...imagesData.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } })),
      { text: prompt },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        systemInstruction:
          "You are an expert Iraqi teacher. Extract exam data into JSON with high precision. Capture all mathematical formulas and Arabic digits correctly. DO NOT perform arithmetic yourself during extraction; strictly copy exactly what is written on the page or provided in the input. If you see 85/5, DO NOT calculate 17 or 18, just write the expression or the result exactly as it appears.",
      },
    });

    const data = JSON.parse(cleanJson(response.text || "{}"));
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
// gradeStudentPaper
// ─────────────────────────────────────────────────────────────────────────────

export async function gradeStudentPaper(
  imageUrls: string[],
  questions: Question[],
  totalExamGrade: number,
  requiredQuestionsCount: number,
  subject = "عام",
  onProgress?: (current: number, total: number, phase: "compressing" | "grading") => void
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    // ── Compress images ──────────────────────────────────────────────────────
    if (onProgress) onProgress(0, imageUrls.length, "compressing");
    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      base64ImagesData.push(await compressImage(imageUrls[i], 2000, 2000, 0.85));
      if (onProgress) onProgress(i + 1, imageUrls.length, "compressing");
    }

    // ── Flatten questions — strip the model answer before sending ────────────
    const flattenedQuestions: any[] = [];
    const flatten = (qs: Question[], parentText = "", path = "") => {
      qs.forEach((q, index) => {
        let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
        if (label.length > 15 || label.length === 0) label = `سؤال ${index + 1}`;
        const fullPath = path ? `${path} / ${label}` : label;
        const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;

        if (!q.subQuestions || q.subQuestions.length === 0) {
          // NOTE: 'answer' is intentionally NOT included — model must solve itself
          const entry: any = {
            id: q.id,
            label: fullPath,
            text: combinedText,
            grade: q.grade,
            type: q.type,
          };
          // Only send teacher rubric/criteria — never the full answer
          if (q.gradingCriteria && q.gradingCriteria.trim()) {
            entry.gradingCriteria = q.gradingCriteria;
          }
          flattenedQuestions.push(entry);
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(questions);

    if (onProgress) onProgress(0, 100, "grading");

    const isMath =
      subject.includes("رياضيات") || subject.toLowerCase().includes("math");

    // ── Prompt ───────────────────────────────────────────────────────────────
    const prompt = `You are an expert Iraqi teacher grading student exam papers.
You do NOT have a model answer — determine the correct answer yourself from the question, then evaluate the student.

Subject: ${subject}.
Questions (no model answer provided — use your own knowledge): ${JSON.stringify(flattenedQuestions)}.
Total Exam Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || "All"}.

STEP 1 — SOLVE THE QUESTION YOURSELF
Read each question and work out the correct answer independently before inspecting the student paper.
- Math: calculate step by step and verify (e.g. 85÷5=17, verify: 17×5=85 ✓).
- Factual / science: recall the correct fact or concept from knowledge.
- Essay / explanation: identify the key required points and concepts.
- If a "gradingCriteria" field is present, use it as the teacher's rubric.

STEP 2 — CLASSIFY THE QUESTION TYPE
TYPE A (Direct Answer): single number, value, word, true/false, MCQ, or short fill-in-blank.
  → Recognized by: question expects exactly one specific result.
TYPE B (Problem with Working): requires steps, reasoning, or extended explanation.
  → Recognized by: question uses words like اشرح / برهن / احسب بالتفصيل / حل المسألة,
    or the correct answer inherently requires multiple steps.

STEP 3 — LOCATE THE STUDENT ANSWER ON THE PAPER
Find the student's handwritten response for this question.
- If blank → studentAnswer = "لا توجد إجابة", grade = 0.
- BOXED or CIRCLED content = student's final answer — use it.
- Crossed-out text = ignore; use only what is not crossed out.

STEP 4 — GRADE
TYPE A:
  • Compare the student's answer to YOUR correct answer from Step 1.
  • Exact match = full grade. Wrong = 0. Partial match (e.g. right number wrong unit) = partial.
  • studentAnswer field: the number/word the student wrote.
${isMath
  ? `  • MATH TYPE A: apply PEMDAS/BODMAS strictly (× ÷ before + −). Verify your arithmetic first.`
  : ``}

TYPE B:
  • Evaluate: (1) Is the METHOD correct? (2) Are intermediate STEPS logical? (3) Is the FINAL ANSWER correct?
  • Grading scale:
      - Correct method + steps + answer           → full grade
      - Correct method + steps, arithmetic slip   → deduct 1 mark max
      - Partial understanding shown               → proportional partial grade
      - Wrong method entirely                     → 0 or minimal marks
  • If gradingCriteria provided: check each criterion and award marks accordingly.
  • studentAnswer field: brief summary of approach and final answer as seen on paper.
${isMath
  ? `  • MATH TYPE B: PEMDAS/BODMAS strictly. Verify all arithmetic yourself.`
  : `  • NON-MATH TYPE B: check factual accuracy, key concepts, logical structure. Award partial credit proportionally.`}

STEP 5 — OUTPUT
Return ONLY valid JSON (no markdown, no extra text):
{"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

Rules:
- feedback: Arabic only (العربية الفصحى), constructive and encouraging, suitable for Iraqi school students.
- box: [ymin, xmin, ymax, xmax] normalized coordinates (0–1000) of the student answer region on the page.
- pageIndex: 0-based index of the image that contains this answer.`;

    // ── API call ─────────────────────────────────────────────────────────────
    const parts: any[] = [
      ...base64ImagesData.map((data) => ({
        inlineData: { data, mimeType: "image/jpeg" },
      })),
      { text: prompt },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مصحح رياضيات خبير. لا يوجد جواب نموذجي — أنت تحل كل سؤال بنفسك أولاً ثم تقارن بإجابة الطالب. (١) احسب الجواب الصحيح وتحقق منه. (٢) صنّف السؤال: (أ) إجابة مباشرة: قارن ما كتبه الطالب بجوابك، صح=درجة كاملة خطأ=صفر أو جزئي. (ب) مسألة بخطوات: قيّم الطريقة والخطوات والناتج — إذا كانت الخطوات صحيحة والناتج فقط خطأ حسابي اخصم درجة واحدة فقط. راعِ دائماً أولوية العمليات (ضرب وقسمة قبل جمع وطرح). الملاحظات بالعربية الفصحى بأسلوب تربوي عراقي."
          : "أنت معلم محترف خبير. لا يوجد جواب نموذجي — أنت تحدد الجواب الصحيح بنفسك من معرفتك. (١) حدد الجواب أو النقاط المطلوبة. (٢) إذا وُجدت معايير تصحيح (gradingCriteria) استخدمها مرشداً. (٣) صنّف السؤال: (أ) إجابة مباشرة: قارن إجابة الطالب بما تعرفه. (ب) سؤال يتطلب شرحاً: قيّم الدقة والنقاط المغطاة والمنطق، وامنح درجات جزئية متدرجة. الملاحظات بالعربية الفصحى دائماً.",
      },
    });

    if (onProgress) onProgress(100, 100, "grading");

    const data = JSON.parse(cleanJson(response.text || "{}"));

    // Support both {results:[...]} and {gradings:[...]} shapes
    const results =
      data.results ||
      (data.gradings
        ? [
            {
              studentName: data.studentName || "طالب غير معروف",
              gradings: data.gradings,
              totalGrade: data.totalGrade,
            },
          ]
        : []);

    return {
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => ({
          ...g,
          maxGrade:
            g.maxGrade ||
            flattenedQuestions.find((fq) => fq.id === g.questionId)?.grade ||
            0,
        }));
        const computedTotal = gradingsWithMax.reduce(
          (acc: number, g: any) => acc + (Number(g.grade) || 0),
          0
        );
        return { ...r, gradings: gradingsWithMax, totalGrade: computedTotal };
      }),
    };
  } catch (error: any) {
    console.error("Grading error:", error);
    // Re-throw with a friendly Arabic message (parsed in apiErrors.ts)
    // If error was already formatted (from a nested throw), keep it; otherwise format it.
    const alreadyFormatted =
      error?.message?.includes("💡") || error?.message?.includes("🔄");
    throw new Error(alreadyFormatted ? error.message : formatApiError(error));
  }
}
