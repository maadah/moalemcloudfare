// ============================================================================
// Grading helpers: math (two-phase transcription+evaluation) + standard.
// Used by /api/gemini/grade and /api/gemini/grade-math-direct.
// ============================================================================

import { Env, executeAiRequest } from "./kimi";
import { cleanJson } from "./exam-helpers";

export async function gradingMath(
  env: Env,
  reqHeaders: Headers,
  base64ImagesData: string[],
  cleanedQuestions: any[],
  totalExamGrade: number
): Promise<string> {
  console.log("[gradingMath] Phase 1: Pure Visual Transcription");

  const transcriptionQuestions = cleanedQuestions.map(q => ({ id: q.id, text: q.text }));

  const step1Prompt = `You are a professional, blind exam transcriber. Your ONLY job is to look at the student exam paper images and transcribe the student's handwritten math calculations, equations, intermediate steps, and final answers for each of the following questions.

CRITICAL INSTRUCTIONS:
1. Act as a literal copy-paste machine. You must not know, guess, or solve the questions.
2. For each question, extract exactly what the student wrote on their paper, capturing any handwritten mathematical formula, intermediate calculation steps, and final results.
3. Transcribe EXACTLY the student's written digits or symbols. Do NOT try to solve it, and do NOT correct their math! For example, if they did step-by-step division but did some steps incorrectly or got a wrong final number, write down those exact wrong steps and numbers.
4. If a question is left empty or not answered, write "فارغ" or "Empty".
5. Do NOT assign any grades or scores. Do NOT evaluate if the answer is correct or not.

Questions to transcribe:
${JSON.stringify(transcriptionQuestions)}

JSON OUTPUT SCHEMA (Respond ONLY with valid JSON following this exact structure):
{
  "results": [
    {
      "studentName": "string",
      "transcriptions": [
        {
          "questionId": "string",
          "studentAnswer": "string",
          "box": [ymin, xmin, ymax, xmax],
          "pageIndex": number
        }
      ]
    }
  ]
}`;

  const parts: any[] = base64ImagesData.map((data: string) => {
    const cleanData = data.includes(',') ? data.split(',')[1] : data;
    return { inlineData: { data: cleanData, mimeType: "image/jpeg" } };
  });
  const step1Parts = [...parts, { text: step1Prompt }];

  let step1ResponseText = "{}";
  try {
    step1ResponseText = await executeAiRequest(env, reqHeaders, {
      parts: step1Parts,
      systemInstruction: "أنت ناسخ بصري لورق الامتحانات وبلا أي معرفة مسبقة بالحلول النموذجية. مهمتك البحتة هي استخراج وكتابة خطوات حل الطالب الرياضية بالكامل (المعادلات، الحسابات الجانبية، والناتج النهائي) حرفياً كما هي مكتوبة بخط اليد وبلا أي تعديل أو تصحيح.",
      temperature: 0,
      responseMimeType: "application/json"
    });
  } catch (err: any) {
    console.error("[gradingMath] Step 1 failed, falling back:", err);
    step1ResponseText = JSON.stringify({
      results: [{
        studentName: "طالب غير معروف",
        transcriptions: cleanedQuestions.map(q => ({ questionId: q.id, studentAnswer: "فارغ", box: null, pageIndex: 0 }))
      }]
    });
  }

  const step1Data = JSON.parse(cleanJson(step1ResponseText));
  console.log("[gradingMath] Phase 1 Done.");

  const finalResults: any[] = [];
  const students = step1Data.results || [];
  if (students.length === 0) {
    students.push({
      studentName: "طالب",
      transcriptions: cleanedQuestions.map(q => ({ questionId: q.id, studentAnswer: "فارغ", box: null, pageIndex: 0 }))
    });
  }

  for (const student of students) {
    const studentName = student.studentName || "طالب غير معروف";
    const studentTranscriptions = student.transcriptions || [];
    console.log(`[gradingMath] Phase 2: Grading student ${studentName}`);

    const gradingPayload = cleanedQuestions.map(q => {
      const trans = studentTranscriptions.find((t: any) => t.questionId === q.id) || {};
      return {
        id: q.id,
        questionText: q.text,
        correctAnswer: q.answer,
        studentAnswer: trans.studentAnswer || "Empty",
        maxGrade: q.grade || 0,
        box: trans.box || null,
        pageIndex: trans.pageIndex !== undefined ? trans.pageIndex : 0
      };
    });

    const step2Prompt = `أنت معلم رياضيات صارم ودقيق.

القواعد الأساسية:
1. لا تغيّر نص إجابة الطالب أبداً.
2. لا تصحح أرقام الطالب داخل studentAnswer.
3. إذا كتب الطالب 3×5=12 فتبقى كما هي: 3×5=12.
4. لا تستبدل جواب الطالب بالجواب الصحيح أو بالإجابة النموذجية.
5. قيّم فقط ما كتبه الطالب فعلاً.
6. إذا كان الناتج النهائي خطأ، لا تعتبره صحيحاً حتى لو عرفت أنت الناتج الصحيح.
7. الحل الصحيح يُكتب فقط في feedback أو correctAnswer، وليس في studentAnswer.

طريقة التصحيح:
- اقرأ السؤال.
- اقرأ إجابة الطالب كما هي حرفياً.
- احسب الحل الصحيح بنفسك.
- قارن بين ما كتبه الطالب والحل الصحيح.
- حدد أول خطوة خطأ إن وجدت.
- أعطِ درجة جزئية حسب صحة الخطوات.
- في الرياضيات، انتبه لترتيب العمليات:
  الأقواس، الأسس، الضرب والقسمة، الجمع والطرح.

مثال مهم:
السؤال: 3×5
إجابة الطالب: 12

النتيجة:
studentAnswer: "12"
correctAnswer: "15"
grade: 0
feedback: "الناتج غير صحيح؛ لأن 3×5 يساوي 15 وليس 12."

Here is the transcribed data for student "${studentName}":
${JSON.stringify(gradingPayload)}

Expected Output Schema (Respond ONLY with valid JSON structure. Do not include markdown wraps. Ensure all numbers are raw numeric types and "box" is either null or an array of 4 numbers):
{
  "studentName": "${studentName}",
  "gradings": [
    {
      "questionId": "string",
      "studentAnswer": "string",
      "grade": 0,
      "maxGrade": 10,
      "feedback": "string",
      "box": null,
      "pageIndex": 0
    }
  ]
}`;

    const step2Parts = [...parts, { text: step2Prompt }];

    try {
      const step2ResponseText = await executeAiRequest(env, reqHeaders, {
        parts: step2Parts,
        systemInstruction: `أنت معلم رياضيات صارم ودقيق.

القواعد الأساسية:
1. لا تغيّر نص إجابة الطالب أبداً.
2. لا تصحح أرقام الطالب داخل studentAnswer.
3. إذا كتب الطالب 3×5=12 فتبقى كما هي: 3×5=12.
4. لا تستبدل جواب الطالب بالجواب الصحيح أو بالإجابة النموذجية.
5. قيّم فقط ما كتبه الطالب فعلاً.
6. إذا كان الناتج النهائي خطأ، لا تعتبره صحيحاً حتى لو عرفت أنت الناتج الصحيح.
7. الحل الصحيح يُكتب فقط في feedback أو correctAnswer، وليس في studentAnswer.`,
        temperature: 0,
        responseMimeType: "application/json"
      });
      const studentGradingResult = JSON.parse(cleanJson(step2ResponseText));
      finalResults.push(studentGradingResult);
    } catch (err: any) {
      console.error(`[gradingMath] Step 2 failed for student ${studentName}:`, err);
      const fallbackGradings = gradingPayload.map(gp => {
        const cleanStudent = String(gp.studentAnswer).trim().replace(/\s+/g, '');
        const cleanCorrect = String(gp.correctAnswer).trim().replace(/\s+/g, '');
        const isMatch = cleanStudent === cleanCorrect;
        return {
          questionId: gp.id,
          studentAnswer: gp.studentAnswer,
          grade: isMatch ? gp.maxGrade : 0,
          maxGrade: gp.maxGrade,
          feedback: isMatch ? "إجابة صحيحة." : "إجابة خاطئة.",
          box: gp.box,
          pageIndex: gp.pageIndex
        };
      });
      finalResults.push({ studentName, gradings: fallbackGradings });
    }
  }

  return JSON.stringify({ results: finalResults });
}

export async function gradingStandard(
  env: Env,
  reqHeaders: Headers,
  base64ImagesData: string[],
  questions: any[],
  totalExamGrade: number
): Promise<string> {
  const prompt = `Grade student paper against questions:
1. Transcribe: Put the EXACT student answer in "studentAnswer".
Questions: ${JSON.stringify(questions)}
Total Grade: ${totalExamGrade}

JSON: {"results": [{"studentName": "...", "gradings": [{"questionId": "...", "studentAnswer": "...", "grade": 0, "maxGrade": 10, "feedback": "...", "box": null, "pageIndex": 0}]}]}`;

  const parts: any[] = base64ImagesData.map((data: string) => {
    const cleanData = data.includes(',') ? data.split(',')[1] : data;
    return { inlineData: { data: cleanData, mimeType: "image/jpeg" } };
  });
  parts.push({ text: prompt });

  return await executeAiRequest(env, reqHeaders, {
    parts,
    systemInstruction: "أنت مصحح سريع ودقيق. القواعد: 1) انقل إجابة الطالب بـ studentAnswer تماماً كما كتبها دون تعديل. 2) قارن بالنموذج الإرشادي بمرونة كبيرة وسهولة. 3) اكتب ملاحظات عربية فصحى موجزة جداً.",
    temperature: 0,
    responseMimeType: "application/json"
  });
}
