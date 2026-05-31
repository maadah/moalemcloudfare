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

YOUR TASK — for each question:

PART A — TRANSCRIBE (copy the ink, do not solve):
1. Look ONLY at the student's handwritten ink.
2. Ignore any leading question number such as "٣)" or "ج٣)" — that is the QUESTION NUMBER, not part of the math.
3. Transcribe EVERY working line in the SAME numeral system the student used, joined by " | ".
4. Put the full transcription in "studentAnswer".
5. Put ONLY the student's FINAL result (the value after the last "=") in "studentFinalResult".
   Do not confuse this with the question number or with a measurement unit (e.g. م², سم³).
6. Report "numeralSystem": "arabic" or "western".

*** ANTI-COPY WARNING (very important) ***
  The MODEL ANSWER is printed in the data above. You must NEVER copy it into studentAnswer.
  The student's handwriting is messy and often DIFFERENT from the model. If the student's
  handwriting happens to come out IDENTICAL to the model answer, you are probably copying the
  model by mistake — re-read the ink and report what is ACTUALLY written, including any messy,
  wrong, or incomplete steps.
  If the handwriting is genuinely unreadable, set studentAnswer to what you can see plus "?"
  for unclear parts, set "unreadable": true, and do NOT fill it in from the model answer.
  Reporting a messy/wrong/partial transcription is correct behavior. Substituting the clean
  model answer is a serious error.

PART B — JUDGE BY READING THE RESULT FIRST, THEN ASKING (the core method, think in WORDS):
For each step the student wrote as "LEFT = RIGHT":
  - FIRST read the RIGHT side (the result the student wrote) — before you compute anything yourself.
  - THEN ask an honest Arabic question: does the RIGHT side truly come from the LEFT side?
  - Answer it truthfully. If no → the step is WRONG. If yes → the step is OK.
  This "read the answer first, then verify backward" order stops you from auto-completing.
  Example: "٥ × ٧ = ٣٠" → "هل ثلاثون ناتج من خمسة ضرب سبعة؟" → لا (الناتج ٣٥) → WRONG.
  Apply to EVERY step and every link in a chain a = b = c.

  *** A RESULT HAS TWO PARTS: THE NUMBER (magnitude) AND THE SIGN. BOTH must be correct. ***
  A correct sign with a wrong number is STILL WRONG. A correct number with a wrong sign is STILL WRONG.
  Do NOT say "the sign is right so it is correct" — you must ALSO check the number itself.
  Example: "٣ × (-٥) = -٢٠" → the sign is negative (correct direction), BUT the NUMBER is wrong:
    "هل عشرون ناتج من ثلاثة ضرب خمسة؟" → لا (الناتج ١٥). So -٢٠ ≠ -١٥ → WRONG.
  Always verify the digits, never approve a step just because the sign matches.

GENERAL MATH RULES — apply whichever fit each question (these are universal, not tied to any one problem):

RULE 1 — INTEGER ARITHMETIC & SIGNS (+ − × ÷):
  Verify the NUMBER and the SIGN as TWO SEPARATE checks — both must pass.
  Sign rules: negative × negative = positive; negative × positive = negative;
              negative ÷ negative = positive; negative ÷ positive = negative;
              subtracting a larger number from a smaller gives a negative.
  Check 1 (number): does the magnitude match? e.g. ٣ × ٥ must give 15 — not 20, not 10.
  Check 2 (sign):   is the sign right? e.g. (-٧٥) ÷ ٥ must be negative.
  A step is correct ONLY if BOTH checks pass. Examples of WRONG steps:
   - "٣ × (-٥) = -٢٠" → sign correct but number wrong (should be -١٥) → WRONG.
   - "٣ × (-٥) = ١٥"  → number correct but sign wrong (should be -١٥) → WRONG.
   - "(-٧٥) ÷ ٥ = ١٥" → number correct but sign wrong (should be -١٥) → WRONG.
  NEVER approve a step merely because the sign direction looks right.

RULE 2 — ORDER OF OPERATIONS (priority): brackets → exponents/roots → × and ÷ (left to right) → + and − (left to right).
  Example: "٣ + ٤ × ٢" must be 3+(4×2)=11, NOT (3+4)×2=14.

RULE 3 — SOLVING EQUATIONS (a variable س/ص/ع/x with "="): moving a term across "=" FLIPS its sign;
  a factor that multiplies one side becomes division on the other (and vice-versa).
  A line can be arithmetically true yet WRONG if the transfer rule was broken.
  Example: "س + ١٤ = ٢٧" → correct "س = ٢٧ - ١٤ = ١٣"; if student wrote "س = ٢٧ + ١٤ = ٤١" the
  arithmetic ٢٧+١٤=٤١ is true on its own but the transfer was wrong → WRONG (model says ١٣).

RULE 4 — FRACTIONS: 
  - addition/subtraction needs a common denominator; "١/٢ + ١/٣ = ٢/٥" is WRONG (correct ٥/٦).
  - multiplication multiplies numerators and denominators; division multiplies by the reciprocal.
  - a fraction should be checked in lowest terms if the model is reduced (e.g. ٢/٤ = ١/٢).

RULE 5 — EXPONENTS & ROOTS: "أُس" means repeated multiplication (٢³ = ٢×٢×٢ = ٨, not ٢×٣=٦).
  Square root: "هل الجذر صحيح؟" √٩ = ٣ because ٣×٣ = ٩.

RULE 6 — PERCENTAGES & RATIOS: a percent is out of 100 (٢٥٪ of ٨٠ = ٢٠). Check ratio simplification and proportions (cross-multiply).

RULE 7 — DECIMALS & ROUNDING: align decimal places; check the student rounded as the question asked (e.g. to nearest whole / one decimal).

RULE 8 — GEOMETRY / FORMULAS: if a formula is used (area, perimeter, volume, average/mean), check the right formula was used and the substitution is correct. Ignore the unit symbol (م²، سم³) when comparing the numeric value, but a correct answer should still carry a sensible unit.

RULE 9 — WORD PROBLEMS & MULTI-PART: read what the question asks for. For multi-part answers, judge each required part; the final reported quantity must match the model's final quantity.

RULE 10 — EQUIVALENT FORMS ARE ACCEPTED (method is free): different but valid methods, or equivalent forms (١/٢ = ٠٫٥ = ٥٠٪, or ٣٤-٦ reached directly vs via ١٧×٢-٦), are CORRECT as long as the FINAL value equals the model's final value. Do not punish a student for solving differently than the model.

PART C — FINAL RESULT FIRST, THEN ESTIMATE HOW MUCH IS CORRECT:
  STEP 1 — Identify the correct FINAL value from the printed MODEL ANSWER (it is typed and reliable).
  STEP 2 — Read the student's FINAL result and turn BOTH into words to compare their VALUE
           (not their surface text). Accept equivalent forms (e.g. ١/٢ = ٠٫٥ = ٥٠٪، أو ٢/٤ = ١/٢).
           Ignore unit symbols (م²، سم³) when comparing the number.
             - same value  → the student's answer is CORRECT.
             - different    → the student's answer is WRONG overall (even if some inner lines were
                              self-consistent — e.g. the sign-transfer error in RULE 3).
  STEP 3 — ESTIMATE "correctnessRatio" (a number from 0 to 1) = how much of the required solution
           the student got right:
             - final value correct                              → 1.0
             - final value wrong, but most of the work is sound
               and only a small slip occurred                   → high, e.g. 0.7–0.9
             - about half the work/parts correct                → ~0.5
             - only a little correct                            → low, e.g. 0.2–0.3
             - completely wrong, or wrong from the very start,
               or blank, or only copied the question            → 0.0
           For a multi-part question, base the ratio on how many required parts are correct.
  STEP 4 — Also give a coarse "verdict": "correct" (ratio = 1), "partial" (0 < ratio < 1),
           or "wrong" (ratio = 0). The numeric grade will be computed from correctnessRatio.

  NEVER overwrite the student's writing with the model answer. The model answer is ONLY a
  reference for the correct final value.

CRITICAL: DO NOT write the correct answer into studentAnswer or studentFinalResult.
If the student's result is wrong, you MUST report their WRONG value as-is. Reporting a wrong value is SUCCESS.

Output JSON only:
{
  "studentName": "name from paper or طالب",
  "gradings": [
    {
      "questionId": "id",
      "studentAnswer": "<exact handwriting transcription, student's numeral system, steps joined by ' | ', WITHOUT the question number>",
      "studentFinalResult": "<the student's final result only, same numeral system>",
      "numeralSystem": "arabic or western",
      "unreadable": false,
      "verdict": "correct | partial | wrong",
      "correctnessRatio": <number from 0 to 1>,
      "feedback": "<Arabic: compare the student's final value to the correct one, and briefly say what was right and what was wrong, e.g. 'الناتج النهائي للطالب ٤١ والصحيح ١٣ لأن ١٤ يجب أن تُطرح عند النقل؛ الخطوة الأولى سليمة.'>",
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
        systemInstruction: "أنت تقرأ ما كتبه الطالب بخط يده على ورقة الامتحان. أنت لا تحل الامتحان. قاعدة مهمة: ابقَ في نظام الأرقام الذي استخدمه الطالب؛ إذا كتب بالأرقام العربية ٠١٢٣٤٥٦٧٨٩ فانسخ بالعربية نفسها ولا تحوّلها إلى إنجليزية، وإذا كتب بالإنجليزية فابقَ بالإنجليزية، لأن التحويل سبب الخطأ (٤ تشبه 5 الإنجليزية). انسخ كل أسطر حل الطالب بالكامل وافصل بينها بـ ' | '. السؤال والنموذج المطبوعان يساعدانك فقط على تمييز الحروف (ح تشبه ٢، ع تشبه ٤) عن الأرقام. انسخ ما يظهره خط الطالب بالضبط حتى لو كان خطأً؛ نقل القيمة الخاطئة نجاح وليس فشلاً، ولا تضع النتيجة الصحيحة أبداً. عند الحكم: الناتج له جزآن، الرقم والإشارة، وكلاهما يجب أن يكون صحيحاً. لا تقبل ناتجاً لمجرد أن إشارته صحيحة؛ تحقق من الرقم نفسه أيضاً. مثال: ٣×(-٥)=-٢٠ إشارته سالبة صحيحة لكن الرقم خطأ (الصحيح -١٥) فهو خاطئ."
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

      // ── Grade from the AI's correctnessRatio (0..1) ──────────────────────
      // The model compares the student's FINAL result to the model answer and
      // estimates how much of the solution is correct. Grade = max × ratio,
      // rounded to the nearest WHOLE number. A completely wrong/blank answer
      // has ratio 0 → grade 0.
      const verdict = String(g.verdict || '').toLowerCase();

      // Determine the ratio. Prefer the AI's numeric correctnessRatio; if it is
      // missing, fall back to the coarse verdict (correct=1, wrong=0, partial=0.5).
      let ratio: number;
      if (typeof g.correctnessRatio === 'number' && isFinite(g.correctnessRatio)) {
        ratio = Math.max(0, Math.min(1, g.correctnessRatio));
      } else if (verdict === 'correct') {
        ratio = 1;
      } else if (verdict === 'wrong') {
        ratio = 0;
      } else if (verdict === 'partial') {
        ratio = 0.5;
      } else {
        // No info at all (e.g. free-text). Use AI-provided grade if any, else full.
        ratio = -1; // sentinel: use g.grade
      }

      let grade: number;
      if (ratio < 0) {
        grade = (typeof g.grade === 'number') ? g.grade : maxGrade;
      } else {
        // No fractions: round to the nearest whole number.
        grade = Math.round(maxGrade * ratio);
      }
      // Safety clamp
      grade = Math.max(0, Math.min(maxGrade, grade));

      let feedback = g.feedback || '';
      if (!feedback) {
        if (ratio >= 1) feedback = 'اجابة صحيحة.';
        else if (ratio <= 0) feedback = 'اجابة خاطئة.';
        else feedback = 'اجابة صحيحة جزئياً.';
      }

      // ── Copy-detection: if the transcribed answer is almost identical to the
      // model answer, the AI likely copied the model instead of reading the
      // student's messy ink. Flag it for manual review.
      const modelAns = q?.answer || '';
      if (modelAns && looksCopiedFromModel(studentAnswer, modelAns)) {
        feedback = '\u26A0\uFE0F تحذير: قد يكون استخراج اجابة الطالب غير دقيق (تشبه الاجابة النموذجية كثيراً). يُرجى المراجعة اليدوية. ' + feedback;
      }
      if (g.unreadable === true) {
        feedback = '\u26A0\uFE0F خط الطالب غير واضح للقراءة الالية، يُرجى المراجعة اليدوية. ' + feedback;
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


// Detect whether the transcribed student answer was likely COPIED from the
// model answer (a known AI failure mode when handwriting is messy). We compare
// after normalizing digits, spaces and operators. If they are essentially the
// same string, it is suspicious and worth a manual-review flag.
function looksCopiedFromModel(studentAnswer: string, modelAnswer: string): boolean {
  const norm = (s: string) => {
    const map: Record<string, string> = {
      '\u0660':'0','\u0661':'1','\u0662':'2','\u0663':'3','\u0664':'4',
      '\u0665':'5','\u0666':'6','\u0667':'7','\u0668':'8','\u0669':'9'
    };
    return s
      .replace(/[\u0660-\u0669]/g, d => map[d] || d)
      .replace(/[\u00D7]/g, '*').replace(/[\u00F7]/g, '/').replace(/[\u2212]/g, '-')
      .replace(/[\s|]/g, '')           // drop spaces and the " | " separators
      .replace(/["'.]/g, '')            // drop quotes/periods
      .toLowerCase();
  };
  const a = norm(studentAnswer);
  const b = norm(modelAnswer);
  if (!a || !b) return false;
  if (a.length < 4) return false;        // too short to judge
  // Exact match after normalization, or one fully contains the other and they
  // are nearly the same length → very likely a copy.
  if (a === b) return true;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length / longer.length > 0.9) return true;
  return false;
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

