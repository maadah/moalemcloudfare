// POST /api/gemini/extract-dual
// Extract questions + model answers from two image sets (questions sheet + answer key sheet).

import { Env, executeAiRequest } from "../../_shared/kimi";
import {
  cleanJson,
  ensureTwoLevelHierarchy,
  isGeneralExamNote,
  parseNumberFromText,
  jsonResponse,
  handleOptions
} from "../../_shared/exam-helpers";

interface Ctx { request: Request; env: Env; }

export const onRequestOptions = () => handleOptions();

export const onRequestPost = async (context: Ctx): Promise<Response> => {
  try {
    const { request, env } = context;
    const body: any = await request.json();
    const { questionImages, answerImages } = body;

    if (!questionImages || !answerImages) {
      return jsonResponse({ error: "الرجاء رفع صور الأسئلة والأجوبة النموذجية للتصحيح." }, 400);
    }

    const prompt = `Extract questions and model answers precisely from this Iraqi exam paper.
      Each top-level question card in the 'questions' array MUST represent exactly ONE complete main question on the paper (e.g., "س ١", "س ٢", "س ٣", "س ٤", "س ٥", "س ٦" or "السؤال الأول", etc.).
      NEVER split the same main question (like "س ١") into multiple different top-level cards. Instead, put all its branches (أ, ب, ج...) as its direct sub-questions (Level 2).
      
      Output a JSON object with:
      - title: String (the exam title/subject parsed from the top of the paper, e.g. "الرياضيات")
      - requiredQuestionsCount: Number (the number of questions to answer, e.g., if note says "أجب عن خمسة أسئلة فقط" then requiredQuestionsCount is 5)
      - questions: Array of objects conforming EXACTLY to this 3-LEVEL hierarchy matching the exam paper layout:
        {
          text: String (the identifier/label of the main question, e.g. "س ١" or "السؤال الأول"),
          grade: Number (total grade for this main question, if specified),
          answer: String (empty for Level 1),
          type: String (default is "text"),
          subQuestions: Array of branch objects (Level 2, e.g., branch أ, branch ب, branch ج):
            [
              {
                text: String (the branch instruction or question text, e.g. "أ) جد ناتج الضرب أو القسمة ( لاثنين فقط ) مما يأتي :" or "ب) حدد القيمة المتطرفة ..."),
                grade: Number (grade for this branch, if specified),
                answer: String (model answer for this branch or empty if it has nested points),
                type: String,
                subQuestions: Array of nested point objects (Level 3, the numbered points/formulas under this branch, if any. e.g., "١", "٢", "٣"):
                  [
                    {
                      text: String (the specific sub-point or math formula text, e.g. "(١) (-٤٨) ÷ (-٦) ="),
                      grade: Number (grade for this point),
                      answer: String (the model answer or final result of this specific calculation/point, e.g. "8" or "٨" or "-17"),
                      type: String
                    }
                  ]
              }
            ]
        }

      CRITICAL PARSING AND HIERARCHY RULES FOR IRAQI EXAMS (STRICT 3-LEVEL ARCHITECTURE):
      1. EXAM LEVEL 1: Main Questions on Paper ("س ١", "س ٢", "س ٣", etc.)
         - Each "س" must be exactly ONE card in the top-level 'questions' array.
         - Do NOT split different branches of the same question card (e.g. "س ١ : أ" and "س ١ : ب") into separate top-level cards! They MUST reside in the SAME top-level card under the 'subQuestions' array as Level 2 branches.
      2. EXAM LEVEL 2: Branches ("أ", "ب", "ج", etc.)
         - Branches representing the letters "أ", "ب", "ج" are the direct sub-questions of Level 1.
         - Place the branch text (e.g., "أ) جد ناتج الضرب...") in the 'text' field of the Level 2 object.
      3. EXAM LEVEL 3: Sub-points/Formulas ("١", "٢", "٣", etc. / "أولاً", "ثانياً", etc.)
         - If a branch (Level 2) contains specific sub-points or math expressions to solve, do NOT keep them inline in the Branch text.
         - Place each point in the 'subQuestions' array of that Branch (Level 3), containing the precise mathematical expression exactly as printed.
      
      4. GENERAL EXAM INSTRUCTION NOTES MUST NOT BE QUESTIONS:
         - General instructions/notes written at the very top of the exam paper (such as 'ملاحظة: الإجابة عن خمسة أسئلة فقط ، ولكل سؤال ٢٠ درجة') are general metadata.
         - You MUST NOT include this general note as an item in the 'questions' array.
         - Instead, parse the required questions count from it (e.g., 5) and set 'requiredQuestionsCount' to that value.
         
      5. GRADE EXTRACTION: Copy original grades exactly. DO NOT divide grades or invent grades yourself.
      6. Ensure all mathematical expressions, Arabic/Hindi digits (٠-٩), and symbols are preserved exactly.
      
      IMPORTANT: Be extremely careful not to lose any questions, branches, or nested points. In math exams, some points are written horizontally or in multi-column tables. Scan the paper thoroughly and capture every single sub-item. Ensure all mathematical expressions, Arabic/Hindi digits (٠-٩), and symbols are preserved with 100% accuracy.`;

    const parts: any[] = [];
    parts.push({ text: "QUESTIONS IMAGES:" });
    questionImages.forEach((data: string) => {
      const cleanData = data.includes(',') ? data.split(',')[1] : data;
      parts.push({ inlineData: { data: cleanData, mimeType: "image/jpeg" } });
    });
    parts.push({ text: "MODEL ANSWERS IMAGES:" });
    answerImages.forEach((data: string) => {
      const cleanData = data.includes(',') ? data.split(',')[1] : data;
      parts.push({ inlineData: { data: cleanData, mimeType: "image/jpeg" } });
    });
    parts.push({ text: prompt });

    const responseText = await executeAiRequest(env, request.headers, {
      parts,
      systemInstruction: "You are an expert Iraqi teacher. Extract exam data precisely into JSON. Follow the strict 3-level hierarchical structure: Main Questions (Level 1) -> Branches (Level 2) -> Points (Level 3). Ensure all branches of the same question are grouped together under one main question card. General instructions/notes at the top must never be treated as questions. Preserve all mathematical formulas, numbers, and symbols exactly as written.",
      temperature: 0.1,
      responseMimeType: "application/json"
    });

    const data = JSON.parse(cleanJson(responseText));

    if (data && Array.isArray(data.questions)) {
      const generalNote = data.questions.find((q: any) => q && isGeneralExamNote(q.text));
      if (generalNote && (!data.requiredQuestionsCount || data.requiredQuestionsCount === 0)) {
        const parsed = parseNumberFromText(generalNote.text);
        if (parsed) data.requiredQuestionsCount = parsed;
      }
      data.questions = ensureTwoLevelHierarchy(data.questions);
    }

    return jsonResponse(data || { title: "", questions: [] });
  } catch (error: any) {
    console.error("Extraction dual error:", error);
    return jsonResponse({ error: error.message || "حدث خطأ أثناء معالجة واستخراج بيانات الامتحان." }, 500);
  }
};
