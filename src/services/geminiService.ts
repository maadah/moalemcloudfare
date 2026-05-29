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
      const compressed = await compressImage(imageUrls[i], 1600, 1600, 0.75);
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

    // ═══════════════════════════════════════════════════════════════════════
    // SINGLE CALL — Self-comparison approach
    // The model receives the question, sees the student paper, and must:
    //   1. Copy the student answer exactly as written (with digit conversion)
    //   2. Solve the question ITSELF independently
    //   3. Compare ITS OWN answer with the student's copied answer
    // This way the comparison is between two things the model computed
    // in the same context, making it much harder to "auto-correct" the
    // student's answer without noticing the discrepancy.
    // ═══════════════════════════════════════════════════════════════════════

    const questionsForPrompt = flattenedQuestions.map(q => ({
      id: q.id,
      label: q.label,
      questionText: q.text,
      modelAnswer: q.answer,
      maxGrade: q.grade
    }));

    const singlePrompt = `You are reading what a student WROTE on their exam paper. You are NOT solving the exam.

The QUESTION TEXT and MODEL ANSWER below are PRINTED (typed) and are given ONLY to help you understand context — for example, to tell whether a handwritten mark is an Arabic LETTER (like ح، س، ع، ص) used as a variable, or an Arabic DIGIT. They are NOT to be copied as the student answer.

Questions (printed context):
${JSON.stringify(questionsForPrompt)}

DIGIT vs LETTER DISAMBIGUATION (critical):
  Arabic digits: ٠=0 ١=1 ٢=2 ٣=3 ٤=4 ٥=5 ٦=6 ٧=7 ٨=8 ٩=9
  Some Arabic LETTERS look like digits:
    ح (the letter Haa) looks like ٢ (2). If the question/model uses ح as a variable, a similar mark is the LETTER ح, not 2.
    ع (the letter Ain) looks like ٤ (4). If the formula uses ع as a symbol (e.g. height), a similar mark is ع, not 4.
  Use the printed question and model answer to decide: if that position holds a variable/letter, read it as a letter; if it holds a number, read it as a digit.
  Also: ٤ looks like Western 5 but is 4. ٥ looks like 0 but is 5.

YOUR TASK — for each question, report EXACTLY what the student's handwriting shows:

1. Look ONLY at the student's handwritten ink. Ignore the printed question.
2. Transcribe what you SEE, mark by mark, left part then result. Convert Arabic digits to Western using the table.
3. Write the FINAL RESULT the student wrote (the number/expression after the last "=") into a SEPARATE field "studentFinalResult".
4. Put the full transcription (all working) into "studentAnswer".

DO NOT solve the problem. DO NOT write the correct answer into studentAnswer or studentFinalResult.
If the student's result is wrong, you MUST still report their WRONG value. Reporting a wrong value is SUCCESS, not failure.
Example: paper shows "٣ × (-١٧) = -١٤" → studentAnswer="3 × (-17) = -14", studentFinalResult="-14"
  (even though -14 is mathematically wrong — you report -14 because that is what the ink shows.)

Output JSON only:
{
  "studentName": "name from paper or طالب",
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<exact handwriting transcription, wrong values kept as-is>",
      "studentFinalResult": "<the last result the student wrote, e.g. -14>",
      "box": [ymin, xmin, ymax, xmax],
      "pageIndex": <0-based>
    }
  ]
}`;

    const singleParts: any[] = base64ImagesData.map(d => ({ inlineData: { data: d, mimeType: "image/jpeg" } }));
    singleParts.push({ text: singlePrompt });

    const singleResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: singleParts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: "أنت تقرأ ما كتبه الطالب بخط يده على ورقة الامتحان. أنت لا تحل الامتحان. السؤال والإجابة النموذجية مطبوعان ويُعطيان لك فقط لتمييز الحروف العربية (مثل ح، ع، س) عن الأرقام: الحرف ح يشبه ٢، والحرف ع يشبه ٤، فإذا كان موضع الرمز في القانون حرفاً فاقرأه حرفاً. مهمتك نسخ ما يظهره خط الطالب بالضبط حتى لو كان خطأً. إذا كتب الطالب نتيجة خاطئة يجب أن تنقل النتيجة الخاطئة كما هي ولا تضع النتيجة الصحيحة أبداً. نقل القيمة الخاطئة هو نجاح وليس فشلاً. ٤=4 وليس 5، ٥=5 وليس 0."
      }
    });

    let singleData: any = { gradings: [], studentName: 'طالب غير معروف' };
    try {
      singleData = JSON.parse(cleanJson(singleResponse.text || '{}'));
    } catch(e) {
      console.error("Parse error:", e, "\nRaw:", singleResponse.text?.slice(0, 400));
    }

    if (onProgress) onProgress(100, 100, 'grading');

    const studentName: string = singleData.studentName || 'طالب غير معروف';
    const rawGradings: any[] = singleData.gradings || [];

    const finalGradings = rawGradings.map((g: any) => {
      const q = flattenedQuestions.find(fq => fq.id === g.questionId);
      const maxGrade = g.maxGrade || q?.grade || 0;
      const studentAnswer = g.studentAnswer || '';

      // ── JavaScript arithmetic verification ──────────────────────────────
      // We do NOT trust the AI's judgment. We compute the math ourselves
      // from what the AI transcribed, then compare against the student's
      // final result and against the model answer.
      const check = verifyMathAnswer(studentAnswer, g.studentFinalResult, q?.answer || '');

      let grade = maxGrade;
      let feedback = g.feedback || '';

      if (check.decision === 'wrong') {
        grade = 0;
        feedback = check.reason || feedback;
      } else if (check.decision === 'correct') {
        grade = maxGrade;
        feedback = feedback || 'إجابة صحيحة.';
      } else {
        // 'unknown' — could not verify by JS (text answer, variables, etc.)
        // fall back to the AI-provided grade if present, else full marks
        grade = (typeof g.grade === 'number') ? g.grade : maxGrade;
      }

      return {
        questionId: g.questionId,
        studentAnswer,
        grade,
        maxGrade,
        feedback,
        box: g.box || [0, 0, 0, 0],
        pageIndex: g.pageIndex ?? 0
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

// ════════════════════════════════════════════════════════════════════════
// Arithmetic verification engine (pure JavaScript — does NOT use the AI)
// Takes the transcribed student answer, evaluates the math itself, and
// decides if the student's final result is correct. This removes reliance
// on the AI for the judgment step.
// ════════════════════════════════════════════════════════════════════════

interface VerifyResult {
  decision: 'correct' | 'wrong' | 'unknown';
  reason?: string;
}

// Safe arithmetic evaluator supporting + - × ÷ * / and parentheses.
// Returns null if the expression cannot be evaluated (e.g. contains letters/variables).
function safeEval(expr: string): number | null {
  if (!expr) return null;
  // Normalize operators
  let s = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')   // unicode minus
    .replace(/\s+/g, '');

  // Reject if it contains anything that is not a number, operator, parenthesis, or dot
  if (!/^[-+*/().0-9]+$/.test(s)) return null;
  if (s.length === 0) return null;

  // Tokenize and evaluate using a small shunting-yard / recursive parser
  try {
    let pos = 0;
    const peek = () => s[pos];
    const next = () => s[pos++];

    function parseExpression(): number {
      let value = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = next();
        const rhs = parseTerm();
        value = op === '+' ? value + rhs : value - rhs;
      }
      return value;
    }
    function parseTerm(): number {
      let value = parseFactor();
      while (peek() === '*' || peek() === '/') {
        const op = next();
        const rhs = parseFactor();
        value = op === '*' ? value * rhs : value / rhs;
      }
      return value;
    }
    function parseFactor(): number {
      if (peek() === '+') { next(); return parseFactor(); }
      if (peek() === '-') { next(); return -parseFactor(); }
      if (peek() === '(') {
        next();
        const v = parseExpression();
        if (peek() === ')') next();
        return v;
      }
      // parse number
      let num = '';
      while (pos < s.length && /[0-9.]/.test(peek())) num += next();
      if (num === '') throw new Error('parse error');
      return parseFloat(num);
    }

    const result = parseExpression();
    if (pos !== s.length) return null; // leftover unparsed → invalid
    return result;
  } catch {
    return null;
  }
}

// Normalize a numeric string for comparison (handles "-14", " -14 ", "−14")
function parseNum(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

function verifyMathAnswer(studentAnswer: string, studentFinalResult: string, modelAnswer: string): VerifyResult {
  if (!studentAnswer || /BLANK/i.test(studentAnswer)) {
    return { decision: 'wrong', reason: 'لم يكتب الطالب إجابة.' };
  }

  // If the answer contains Arabic letters or unknown variables → can't verify arithmetically
  // (Arabic letters range, or Latin letters used as variables)
  const hasLetters = /[\u0621-\u064A]|[a-zA-Z]/.test(studentAnswer.replace(/[xX](?=\s|\*|$)/g, ''));
  // Note: we keep going only for pure-arithmetic answers

  // Split the student's working into lines/steps separated by "|" or newlines
  const rawLines = studentAnswer.split(/\||\n/).map(l => l.trim()).filter(Boolean);

  // Check each line of the form  LEFT = RIGHT
  for (const line of rawLines) {
    if (!line.includes('=')) continue;
    const sides = line.split('=').map(p => p.trim()).filter(Boolean);
    // For a chain A = B = C, check each adjacent pair
    for (let i = 0; i < sides.length - 1; i++) {
      const left = sides[i];
      const right = sides[i + 1];
      const leftVal = safeEval(left);
      const rightVal = safeEval(right);
      // Only judge when BOTH sides are pure numbers/expressions we can evaluate
      if (leftVal !== null && rightVal !== null) {
        if (Math.abs(leftVal - rightVal) > 1e-9) {
          return {
            decision: 'wrong',
            reason: `خطأ حسابي: ${left} يساوي ${formatNum(leftVal)} وليس ${right}.`
          };
        }
      }
    }
  }

  // Now verify the final result against a fresh computation of the FIRST left-hand expression.
  // Take the very first expression (left of the first "=") and compute it correctly.
  const firstLine = rawLines.find(l => l.includes('='));
  if (firstLine) {
    const firstLeft = firstLine.split('=')[0].trim();
    const correctVal = safeEval(firstLeft);
    const studentFinal = parseNum(studentFinalResult);

    if (correctVal !== null && studentFinal !== null) {
      if (Math.abs(correctVal - studentFinal) > 1e-9) {
        return {
          decision: 'wrong',
          reason: `الناتج الصحيح هو ${formatNum(correctVal)} لكن الطالب كتب ${formatNum(studentFinal)}.`
        };
      } else {
        return {
          decision: 'correct',
          reason: `الناتج صحيح: ${formatNum(correctVal)}.`
        };
      }
    }
  }

  // Could not verify (letters, variables, or unparseable) → let AI/model comparison decide
  if (hasLetters) return { decision: 'unknown' };

  // As a last resort, compare student final result directly with model answer
  const sf = parseNum(studentFinalResult);
  const mf = parseNum(modelAnswer);
  if (sf !== null && mf !== null) {
    return Math.abs(sf - mf) < 1e-9
      ? { decision: 'correct', reason: `الناتج صحيح: ${formatNum(mf)}.` }
      : { decision: 'wrong', reason: `الناتج الصحيح ${formatNum(mf)} والطالب كتب ${formatNum(sf)}.` };
  }

  return { decision: 'unknown' };
}

function formatNum(n: number): string {
  // Show integers without decimals, keep decimals otherwise
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
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

