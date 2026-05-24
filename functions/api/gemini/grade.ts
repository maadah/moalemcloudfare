// POST /api/gemini/grade
// Grade a student's answer paper against extracted questions.

import { Env } from "../../_shared/kimi";
import { cleanJson, jsonResponse, handleOptions } from "../../_shared/exam-helpers";
import { gradingMath, gradingStandard } from "../../_shared/grading";

interface Ctx { request: Request; env: Env; }

interface Question {
  id: string;
  text: string;
  answer: string;
  grade: number;
  type: string;
  subQuestions?: Question[];
}

export const onRequestOptions = () => handleOptions();

export const onRequestPost = async (context: Ctx): Promise<Response> => {
  try {
    const { request, env } = context;
    const body: any = await request.json();
    const { base64ImagesData, questions, totalExamGrade, requiredQuestionsCount, subject } = body;

    if (!base64ImagesData || !Array.isArray(base64ImagesData) || !questions) {
      return jsonResponse({ error: "بيانات الورقة المرفوعة والامتحان غير كاملة لبدء التصحيح." }, 400);
    }

    const flattenedQuestions: any[] = [];
    const flatten = (qs: Question[], parentText: string = "", path: string = "") => {
      qs.forEach((q, index) => {
        let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
        if (label.length > 15 || label.length === 0) label = `سؤال ${index + 1}`;
        const fullPath = path ? `${path} / ${label}` : label;
        const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;

        if (!q.subQuestions || q.subQuestions.length === 0) {
          flattenedQuestions.push({
            id: q.id, label: fullPath, text: combinedText,
            answer: q.answer, grade: q.grade, type: q.type
          });
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(questions);

    const subjectStr = String(subject || "");
    const isMath = subjectStr.includes('رياضيات') || subjectStr.toLowerCase().includes('math');

    let responseText: string;
    if (isMath) {
      responseText = await gradingMath(env, request.headers, base64ImagesData, flattenedQuestions, totalExamGrade);
    } else {
      responseText = await gradingStandard(env, request.headers, base64ImagesData, flattenedQuestions, totalExamGrade);
    }

    const data = JSON.parse(cleanJson(responseText));

    const results = data.results || (data.gradings ? [{ studentName: data.studentName || 'طالب غير معروف', gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    const finalResults = results.map((r: any) => {
      const gradingsWithMax = (r.gradings || []).map((g: any) => ({
        ...g,
        maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0
      }));
      const computedTotal = gradingsWithMax.reduce((acc: number, g: any) => acc + (g.grade || 0), 0);
      return {
        ...r,
        gradings: gradingsWithMax,
        totalGrade: r.totalGrade !== undefined ? r.totalGrade : computedTotal
      };
    });

    return jsonResponse({ results: finalResults });
  } catch (error: any) {
    console.error("Grading error:", error);
    return jsonResponse({ error: error.message || "حدث خطأ غير متوقع أثناء التصحيح الذكي لهده الورقة." }, 500);
  }
};
