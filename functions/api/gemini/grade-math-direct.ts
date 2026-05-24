// POST /api/gemini/grade-math-direct
// Direct math grading: extract Qs+model answers from exam sheet, then grade student paper.

import { Env, executeAiRequest } from "../../_shared/kimi";
import {
  cleanJson,
  ensureTwoLevelHierarchy,
  jsonResponse,
  handleOptions
} from "../../_shared/exam-helpers";
import { gradingMath } from "../../_shared/grading";

interface Ctx { request: Request; env: Env; }

export const onRequestOptions = () => handleOptions();

export const onRequestPost = async (context: Ctx): Promise<Response> => {
  try {
    const { request, env } = context;
    const body: any = await request.json();
    const { examSheetImages, studentPaperImages, totalExamGrade = 100 } = body;

    if (!examSheetImages || !Array.isArray(examSheetImages) || examSheetImages.length === 0) {
      return jsonResponse({ error: "يرجى رفع صور ورقة الأسئلة أولاً." }, 400);
    }
    if (!studentPaperImages || !Array.isArray(studentPaperImages) || studentPaperImages.length === 0) {
      return jsonResponse({ error: "يرجى رفع صور أوراق إجابات الطلاب للبدء بالتصحيح." }, 400);
    }

    console.log("[GRADE-MATH-DIRECT] Stage 1: Question+Answer Extraction");

    const extractionPrompt = `Extract questions and calculate the mathematically correct answer ("correctAnswer") for each question precisely from this official exam paper.
      Each top-level question card in the 'questions' array MUST represent exactly ONE complete main question on the paper (e.g., "س ١", "س ٢", "س ٣", "س ٤", etc.).
      
      Output a JSON object with:
      - title: String (the exam title/subject parsed from the top of the paper, e.g. "الرياضيات")
      - requiredQuestionsCount: Number (the number of questions to answer, e.g., if note says "أجب عن خمسة أسئلة فقط" then requiredQuestionsCount is 5)
      - questions: Array of objects conforming to this hierarchy:
        {
          id: String,
          text: String (e.g. "س ١"),
          grade: Number (grade for this main question, if specified),
          answer: String (model answer for this question or empty if it has branch sub-questions),
          type: String (default is "text"),
          subQuestions: Array of branch/point objects:
            [
              {
                id: String,
                text: String (e.g. "أ) جد ناتج الضرب:"),
                grade: Number,
                answer: String (the calculated 100% correct model answer or formula result),
                type: String
              }
            ]
        }`;

    const extractionParts: any[] = [];
    examSheetImages.forEach((data: string) => {
      const cleanData = data.includes(',') ? data.split(',')[1] : data;
      extractionParts.push({ inlineData: { data: cleanData, mimeType: "image/jpeg" } });
    });
    extractionParts.push({ text: extractionPrompt });

    const extractionResponseText = await executeAiRequest(env, request.headers, {
      parts: extractionParts,
      systemInstruction: "أنت معلم رياضيات عراقي محترف ومدقق رصين للغاية. استخرج الأسئلة من صورة ورقة الامتحان المعطاة، وقم بحل كل مسألة أو عملية حسابية بدقة رياضية متناهية لتوليد الإجابة النموذجية الصحيحة (correctAnswer). لا تترك أي فروع أو أسئلة فرعية مطلقاً.",
      temperature: 0.1,
      responseMimeType: "application/json"
    });

    const extractionData = JSON.parse(cleanJson(extractionResponseText));
    let mainQuestions: any[] = [];
    if (extractionData && Array.isArray(extractionData.questions)) {
      mainQuestions = ensureTwoLevelHierarchy(extractionData.questions);
    }

    console.log("[GRADE-MATH-DIRECT] Flattening questions tree");

    const flattenedQuestions: any[] = [];
    const flatten = (qs: any[], parentText: string = "", path: string = "") => {
      qs.forEach((q, index) => {
        let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
        if (label.length > 15 || label.length === 0) label = `سؤال ${index + 1}`;
        const fullPath = path ? `${path} / ${label}` : label;
        const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;

        if (!q.subQuestions || q.subQuestions.length === 0) {
          flattenedQuestions.push({
            id: q.id || `q_direct_${Math.random().toString(36).substr(2, 4)}_${index}`,
            label: fullPath,
            text: combinedText,
            answer: q.answer || "",
            grade: Number(q.grade) || 0,
            type: q.type || 'text'
          });
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(mainQuestions);

    const specifiedGradesSum = flattenedQuestions.reduce((sum, fq) => sum + (fq.grade || 0), 0);
    if (specifiedGradesSum === 0 && flattenedQuestions.length > 0) {
      const averageGrade = parseFloat((totalExamGrade / flattenedQuestions.length).toFixed(1));
      flattenedQuestions.forEach(fq => { fq.grade = averageGrade; });
    }

    console.log("[GRADE-MATH-DIRECT] Stage 2: Grading Student Paper");

    const gradingResponseText = await gradingMath(env, request.headers, studentPaperImages, flattenedQuestions, totalExamGrade);
    const parsedGradingData = JSON.parse(cleanJson(gradingResponseText));

    const results = parsedGradingData.results || [];
    const finalResults = results.map((student: any) => {
      const studentGradings = (student.gradings || []).map((g: any) => {
        const match = flattenedQuestions.find(fq => fq.id === g.questionId);
        return {
          questionId: g.questionId,
          questionLabel: match ? match.label : "سؤال",
          questionText: match ? match.text : "",
          correctAnswer: match ? match.answer || "" : "",
          studentAnswer: g.studentAnswer || "",
          grade: g.grade !== undefined ? Number(g.grade) : 0,
          maxGrade: g.maxGrade !== undefined ? Number(g.maxGrade) : (match ? Number(match.grade) : 0),
          feedback: g.feedback || "",
          box: g.box || null,
          pageIndex: g.pageIndex !== undefined ? g.pageIndex : 0
        };
      });

      const computedTotalGrade = studentGradings.reduce((sum: number, sg: any) => sum + sg.grade, 0);
      const computedMaxGrade = studentGradings.reduce((sum: number, sg: any) => sum + sg.maxGrade, 0);

      return {
        studentName: student.studentName || "طالب غير معروف",
        totalGrade: computedTotalGrade,
        maxGrade: computedMaxGrade || totalExamGrade,
        gradings: studentGradings
      };
    });

    return jsonResponse({ results: finalResults });
  } catch (error: any) {
    console.error("Direct Math Grading error:", error);
    return jsonResponse({ error: error.message || "حدث خطأ غير متوقع أثناء التصحيح الرياضي المباشر." }, 500);
  }
};
