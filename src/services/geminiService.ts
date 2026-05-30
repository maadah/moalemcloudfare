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

The QUESTION TEXT and MODEL ANSWER below are PRINTED (typed) and are given ONLY to help you understand context — for example, to tell whether a handwritten mark is an Arabic LETTER (like ح، س، ع، ص) used as a variable, or an Arabic DIGIT. They are NOT the student answer and must NEVER be copied as the student answer.

Questions (printed context):
${JSON.stringify(questionsForPrompt)}

CRITICAL RULE — KEEP THE STUDENT'S OWN NUMERAL SYSTEM (do NOT convert):
  If the student writes Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩), transcribe with THOSE SAME Arabic-Indic digits.
  If the student writes Western digits (0123456789), transcribe with Western digits.
  NEVER convert ٤ into 4 or ٥ into 5. Converting between systems is what causes reading errors,
  because ٤ visually resembles Western 5. Staying in the student's own system avoids the confusion.

DIGIT vs LETTER DISAMBIGUATION (still important):
  Some Arabic LETTERS resemble Arabic digits:
    ح (letter Haa) resembles ٢. If the printed question/model uses ح as a variable, read that mark as the LETTER ح, not ٢.
    ع (letter Ain) resembles ٤. If the formula uses ع as a symbol (e.g. height), read it as ع, not ٤.
  Use the printed question/model to decide: variable position → letter; number position → digit.

YOUR TASK — for each question, report EXACTLY what the student's handwriting shows:

1. Look ONLY at the student's handwritten ink. Ignore the printed question values.
2. Transcribe EVERY line of the student's working, in the SAME numeral system the student used.
   Join multiple working lines with " | " between them. Keep ALL intermediate steps.
3. Put the full transcription into "studentAnswer".
4. Put ONLY the student's FINAL result (value after the last "=") into "studentFinalResult", same numeral system.
5. Report which numeral system the student used in "numeralSystem": "arabic" or "western".

DO NOT solve the problem. DO NOT write the correct answer into studentAnswer or studentFinalResult.
If the student's result is wrong, you MUST still report their WRONG value. Reporting a wrong value is SUCCESS, not failure.
Example (Arabic): paper shows "٣ × (-١٧) = -١٤" → studentAnswer="٣ × (-١٧) = -١٤", studentFinalResult="-١٤", numeralSystem="arabic"
  (even though -١٤ is wrong — report -١٤ because that is the ink.)
Example with chain: paper shows "(٣+١٤)×٢-٦ = ١٧×٢-٦ = ٣٤-٦ = ٢٨" →
  studentAnswer="(٣+١٤)×٢-٦ = ١٧×٢-٦ = ٣٤-٦ = ٢٨", studentFinalResult="٢٨", numeralSystem="arabic"

Output JSON only:
{
  "studentName": "name from paper or طالب",
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<exact handwriting transcription in the student's own numeral system, all steps joined by ' | '>",
      "studentFinalResult": "<the last result the student wrote, same numeral system>",
      "numeralSystem": "arabic or western",
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
        systemInstruction: "أنت تقرأ ما كتبه الطالب بخط يده على ورقة الامتحان. أنت لا تحل الامتحان. قاعدة مهمة: ابقَ في نظام الأرقام الذي استخدمه الطالب؛ إذا كتب بالأرقام العربية ٠١٢٣٤٥٦٧٨٩ فانسخ بالعربية نفسها ولا تحوّلها إلى إنجليزية، وإذا كتب بالإنجليزية فابقَ بالإنجليزية، لأن التحويل سبب الخطأ (٤ تشبه 5 الإنجليزية). انسخ كل أسطر حل الطالب بالكامل وافصل بينها بـ ' | '. السؤال والنموذج المطبوعان يساعدانك فقط على تمييز الحروف (ح تشبه ٢، ع تشبه ٤) عن الأرقام. انسخ ما يظهره خط الطالب بالضبط حتى لو كان خطأً؛ نقل القيمة الخاطئة نجاح وليس فشلاً، ولا تضع النتيجة الصحيحة أبداً."
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

// Convert Arabic-Indic (and Persian) digits to Western digits by CODE POINT.
// This is 100% safe: it maps by Unicode value, never by visual shape, so ٤ is
// always 4 and is never confused with 5.
function normalizeArabicDigits(s: string): string {
  if (!s) return s;
  const map: Record<string, string> = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'
  };
  return s.replace(/[٠-٩۰-۹]/g, d => map[d] || d);
}

// Safe arithmetic evaluator: + - × ÷ * / and parentheses, respects order of
// operations. Returns null if the expression contains letters/variables or is
// otherwise not pure arithmetic.
function safeEval(expr: string): number | null {
  if (!expr) return null;
  let s = normalizeArabicDigits(expr)
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')   // unicode minus
    .replace(/\s+/g, '');

  if (!/^[-+*/().0-9]+$/.test(s)) return null;
  if (s.length === 0) return null;

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
      let num = '';
      while (pos < s.length && /[0-9.]/.test(peek())) num += next();
      if (num === '') throw new Error('parse error');
      return parseFloat(num);
    }

    const result = parseExpression();
    if (pos !== s.length) return null;
    return result;
  } catch {
    return null;
  }
}

function parseNum(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const s = normalizeArabicDigits(String(v)).replace(/−/g, '-').replace(/\s+/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

// Detect whether a string contains an unknown variable (Arabic or Latin letter)
// that prevents pure-numeric evaluation. We exclude × and ÷ which are operators.
function containsVariable(s: string): boolean {
  const cleaned = s.replace(/[×÷]/g, '');
  return /[\u0621-\u064A]|[a-wyzA-WYZ]/.test(cleaned);
}

// ════════════════════════════════════════════════════════════════════════
// Main verification. Strategy:
//   1. If the whole answer is pure arithmetic (no variables) → verify EVERY
//      "=" link in the chain, and verify the student's final result equals the
//      correct value of the first/original expression. JavaScript decides.
//   2. If it contains variables/letters → JavaScript cannot solve algebra, so
//      compare the student's FINAL result against the MODEL answer's final
//      result (method is free, only the final value matters).
// ════════════════════════════════════════════════════════════════════════
function verifyMathAnswer(studentAnswer: string, studentFinalResult: string, modelAnswer: string): VerifyResult {
  if (!studentAnswer || /BLANK/i.test(studentAnswer)) {
    return { decision: 'wrong', reason: 'لم يكتب الطالب إجابة.' };
  }

  const hasVariable = containsVariable(studentAnswer);

  // Split into working lines (joined by "|" in the transcription) and also
  // handle a single line that contains a chain a = b = c = d.
  const rawLines = studentAnswer.split(/\||\n/).map(l => l.trim()).filter(Boolean);

  // ── Case 1: PURE ARITHMETIC (no variables) → JavaScript is the judge ──────
  if (!hasVariable) {
    // 1a. Determine the "true" value: compute the very FIRST left-hand expression.
    let trueValue: number | null = null;
    let firstExpr = '';
    for (const line of rawLines) {
      const parts = line.split('=').map(p => p.trim()).filter(Boolean);
      for (const p of parts) {
        const v = safeEval(p);
        if (v !== null) { trueValue = v; firstExpr = p; break; }
      }
      if (trueValue !== null) break;
    }

    // 1b. Verify every "=" link across the entire chain (all lines).
    // Collect all segments separated by "=" across all lines in order.
    const allSegments: string[] = [];
    for (const line of rawLines) {
      for (const seg of line.split('=')) {
        const t = seg.trim();
        if (t) allSegments.push(t);
      }
    }
    // Every adjacent pair of segments that are both evaluable must be equal.
    for (let i = 0; i < allSegments.length - 1; i++) {
      const a = safeEval(allSegments[i]);
      const b = safeEval(allSegments[i + 1]);
      if (a !== null && b !== null && Math.abs(a - b) > 1e-9) {
        return {
          decision: 'wrong',
          reason: `خطأ: «${allSegments[i]}» يساوي ${formatNum(a)} لكن الطالب كتب «${allSegments[i + 1]}» = ${formatNum(b)}.`
        };
      }
    }

    // 1c. Compare student's final result to the true value of the first expression.
    const studentFinal = parseNum(studentFinalResult);
    if (trueValue !== null && studentFinal !== null) {
      if (Math.abs(trueValue - studentFinal) > 1e-9) {
        return {
          decision: 'wrong',
          reason: `الناتج الصحيح لـ «${firstExpr}» هو ${formatNum(trueValue)} لكن الطالب كتب ${formatNum(studentFinal)}.`
        };
      }
      return { decision: 'correct', reason: `الناتج صحيح: ${formatNum(trueValue)}.` };
    }

    // If we cannot find a usable final result, but all links were consistent,
    // and we have a model answer to compare against, fall through to model compare.
  }

  // ── Case 2: HAS VARIABLES (algebra) → compare final result with MODEL ─────
  // Extract the final numeric value from the model answer (last number in it).
  const modelFinal = extractLastNumber(modelAnswer);
  const studentFinal2 = parseNum(studentFinalResult) ?? extractLastNumber(studentAnswer);

  if (modelFinal !== null && studentFinal2 !== null) {
    return Math.abs(modelFinal - studentFinal2) < 1e-9
      ? { decision: 'correct', reason: `الناتج النهائي صحيح: ${formatNum(modelFinal)}.` }
      : { decision: 'wrong', reason: `الناتج النهائي الصحيح ${formatNum(modelFinal)} لكن الطالب كتب ${formatNum(studentFinal2)}.` };
  }

  // Could not verify with confidence → let the caller fall back.
  return { decision: 'unknown' };
}

// Extract the last standalone number from a string (handles Arabic digits and signs).
function extractLastNumber(s: string): number | null {
  if (!s) return null;
  const norm = normalizeArabicDigits(String(s)).replace(/−/g, '-');
  const matches = norm.match(/-?\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  return parseFloat(matches[matches.length - 1]);
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

