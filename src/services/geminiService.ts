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
You do NOT have a model answer — you will solve each question yourself, then READ what the student actually wrote, then compare.

Subject: ${subject}.
Questions (no model answer — solve yourself): ${JSON.stringify(flattenedQuestions)}.
Total Exam Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || "All"}.

════════════════════════════════════════════════════════════
MANDATORY 3-PHASE PROCESS — FOLLOW IN ORDER FOR EVERY QUESTION
════════════════════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1 — SOLVE THE QUESTION YOURSELF (before looking at student paper)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the question text and independently compute/recall the correct answer.
- Math: work out every arithmetic step yourself. Write it out mentally and VERIFY.
  Example: 3 × (−17) = −51. Verify: −51 ÷ 3 = −17 ✓
- Factual: recall the correct fact or concept.
- Essay: list the key required points.
- If "gradingCriteria" is provided, use it as the teacher rubric.
Store your correct answer mentally as CORRECT_ANSWER.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2 — READ WHAT THE STUDENT ACTUALLY WROTE (critical — no inference allowed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Now look at the student's paper and locate their handwritten answer for this question.

⚠️ CRITICAL READING RULES — THESE ARE NON-NEGOTIABLE:
1. Report ONLY what is physically written on the paper. Nothing else.
2. If the student wrote −41, you report −41. NOT −51. NOT the correct answer.
3. If the student wrote −51, you report −51.
4. NEVER substitute your CORRECT_ANSWER into the studentAnswer field.
5. NEVER "correct" or "interpret" what the student wrote based on what it should be.
6. Numbers that look similar (e.g. −41 vs −51, 17 vs 71, 3 vs 8): read carefully — do NOT assume.
7. BOXED or CIRCLED content = the student's definitive final answer. Read it exactly.
8. Crossed-out content = ignore completely. Read only what is NOT crossed out.
9. If the answer area is blank → studentAnswer = "لا توجد إجابة"
10. If handwriting is ambiguous → describe what you see: e.g. "رقم يبدو ٤١- أو ٥١-"

Store what you read as STUDENT_WRITTEN_ANSWER. This goes directly into the "studentAnswer" JSON field.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3 — COMPARE AND GRADE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Now compare CORRECT_ANSWER (Phase 1) with STUDENT_WRITTEN_ANSWER (Phase 2).

QUESTION TYPE A — Direct Answer (number, word, true/false, MCQ, short fill-in-blank):
  • Does STUDENT_WRITTEN_ANSWER match CORRECT_ANSWER?
  • Yes → full grade.
  • No  → 0 (or partial if partially correct, e.g. right number wrong unit/sign).
  • Example: CORRECT=−51, STUDENT_WRITTEN=−41 → WRONG → grade 0 (or partial).
  • Example: CORRECT=−51, STUDENT_WRITTEN=−51 → CORRECT → full grade.
${isMath ? `  • MATH: PEMDAS/BODMAS strictly (× ÷ before + −). Negative signs matter.` : ``}

QUESTION TYPE B — Problem with Working (steps, reasoning, explanation):
  • Evaluate: (1) METHOD correct? (2) STEPS logical? (3) FINAL ANSWER correct?
  • Grading scale:
      Correct method + steps + answer        → full grade
      Correct method + steps, slip in answer → deduct 1 mark max
      Partial understanding                  → proportional partial grade
      Wrong method entirely                  → 0 or minimal
  • If gradingCriteria provided: check each criterion explicitly.
${isMath
  ? `  • MATH: PEMDAS/BODMAS strictly throughout all steps.`
  : `  • NON-MATH: check factual accuracy, key concepts, logical structure. Partial credit proportionally.`}

════════════════════════════════════════════════════════════
OUTPUT — Return ONLY valid JSON, no markdown:
{"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"<STUDENT_WRITTEN_ANSWER exactly>","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

FIELD RULES:
- studentAnswer: MUST be what the student physically wrote. NEVER the correct answer unless they match.
- grade: based on comparison of STUDENT_WRITTEN_ANSWER vs CORRECT_ANSWER.
- feedback: Arabic only (العربية الفصحى), constructive and encouraging for Iraqi students.
- box: [ymin, xmin, ymax, xmax] normalized 0–1000 coordinates of the student answer region.
- pageIndex: 0-based image index containing the answer.`

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
          ? "أنت مصحح رياضيات خبير. لكل سؤال اتبع ثلاث مراحل صارمة بالترتيب: المرحلة ١ (احسب بنفسك): احسب الجواب الصحيح وتحقق منه — مثال: 3×(-17)=-51 تحقق: -51÷3=-17 ✓. المرحلة ٢ (اقرأ ما كتبه الطالب فعلاً): انظر إلى منطقة إجابة الطالب على الورقة واقرأ الأرقام كما هي مكتوبة بالحبر — إذا كتب -41 فاكتب -41 في studentAnswer، إذا كتب -51 فاكتب -51، لا تستبدل ما كتبه الطالب بالجواب الصحيح أبداً، الأرقام المتشابهة مثل 41 و51 و17 و71 تستوجب قراءة دقيقة جداً. المرحلة ٣ (قارن وصحح): قارن STUDENT_WRITTEN مع CORRECT — تطابق=درجة كاملة، خطأ=صفر أو جزئي. حقل studentAnswer = ما كتبه الطالب حرفياً وليس الجواب الصحيح. أولوية العمليات دائماً. الملاحظات بالعربية الفصحى."
          : "أنت معلم محترف خبير. لكل سؤال اتبع ثلاث مراحل: المرحلة ١ (حدد الجواب الصحيح): من معرفتك حدد الجواب أو النقاط المطلوبة، واستخدم gradingCriteria إن وُجد. المرحلة ٢ (اقرأ ما كتبه الطالب): انظر إلى ورقة الطالب واقرأ ما هو مكتوب فعلاً — لا تفسّر ولا تصحح ولا تستبدل، ما كتبه الطالب هو بالضبط ما تضعه في studentAnswer. المرحلة ٣ (قارن وصحح): قارن إجابة الطالب بالجواب الصحيح، للأسئلة المقالية امنح درجات جزئية متدرجة. الملاحظات بالعربية الفصحى دائماً.",
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
