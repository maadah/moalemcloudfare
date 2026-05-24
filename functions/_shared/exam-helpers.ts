// ============================================================================
// Shared exam helpers: JSON cleaning, question hierarchy normalization
// (extracted verbatim from the original Express server, no AI calls here).
// ============================================================================

export const cleanJson = (text: string): string => {
  if (!text) return '{}';
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  }
  cleaned = cleaned.trim();

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIdx = -1;
  let endChar = '';
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endChar = '}';
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endChar = ']';
  }
  if (startIdx !== -1) {
    const lastEnd = cleaned.lastIndexOf(endChar);
    if (lastEnd !== -1 && lastEnd > startIdx) {
      cleaned = cleaned.substring(startIdx, lastEnd + 1);
    }
  }

  cleaned = cleaned.replace(/\[\s*ymin\s*,\s*xmin\s*,\s*ymax\s*,\s*xmax\s*\]/gi, 'null');

  let isInsideString = false;
  let result = "";
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const prevChar = i > 0 ? cleaned[i - 1] : '';
    if (char === '"' && prevChar !== '\\') {
      isInsideString = !isInsideString;
      result += char;
    } else if (isInsideString) {
      if (char === '\n') result += '\\n';
      else if (char === '\r') result += '\\r';
      else result += char;
    } else {
      result += char;
    }
  }
  cleaned = result;
  cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1');

  const map: { [key: string]: string } = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  cleaned = cleaned.replace(/[٠١٢٣٤٥٦٧٨٩]/g, (d) => map[d] || d);
  return cleaned;
};

export function isGeneralExamNote(text: string): boolean {
  if (!text) return false;
  const cleaned = text.trim();
  const hasNotePrefix = /^(ملاحظة|ملاحظه|تنبيه|تنبيهات)/.test(cleaned);
  const containsExamInstruction = /أجب عن|الاجابة|الإجابة|أسئلة فقط|سؤال فقط|درجة|درجات|اسئلة|اسئله|اجابة/i.test(cleaned);
  return hasNotePrefix && containsExamInstruction;
}

export function parseNumberFromText(text: string): number | undefined {
  const countMap: { [key: string]: number } = {
    'واحد': 1, 'واحدة': 1, 'واحده': 1, 'اثنان': 2, 'اثنين': 2, 'ثلاثة': 3, 'ثلاث': 3, 'ثلاثه': 3, 'اربعة': 4, 'أربعة': 4, 'اربعه': 4, 'أربعه': 4, 'خمسة': 5, 'خمس': 5, 'خمسه': 5, 'ستة': 6, 'ست': 6, 'سته': 6, 'سبعة': 7, 'سبعه': 7, 'ثمانية': 8, 'ثمانيه': 8, 'تسعة': 9, 'تسعه': 9, 'عشرة': 10, 'عشره': 10,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '١٠': 10
  };
  const normalize = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/[ة]/g, 'ه').replace(/[،,.:]/g, '').trim();
  const words = text.split(/\s+/);
  for (const w of words) {
    const nw = normalize(w);
    if (countMap[nw]) return countMap[nw];
    if (countMap[w]) return countMap[w];
  }
  return undefined;
}

function collapseSingleOvernestedQuestion(q: any): any {
  if (!q) return q;
  const subQs = q.subQuestions || q.subquestions || [];
  if (subQs.length === 1) {
    const singleSub = subQs[0];
    const singleSubQs = singleSub.subQuestions || singleSub.subquestions || [];
    if (singleSubQs.length > 0) {
      return collapseSingleOvernestedQuestion({
        ...q,
        text: singleSub.text || q.text,
        grade: q.grade || singleSub.grade,
        answer: q.answer || singleSub.answer,
        subQuestions: singleSubQs
      });
    }
  }
  if (subQs.length > 0) {
    return { ...q, subQuestions: subQs.map((sq: any) => collapseSingleOvernestedQuestion(sq)) };
  }
  return q;
}

function fixInlineSubQuestions(q: any, parentId?: string, level: number = 1, index: number = 0): any {
  const id = q.id || `${parentId || 'q'}_${Math.random().toString(36).substr(2, 4)}`;
  let text = q.text || '';
  if (level === 1 && (!text || text.trim() === '')) {
    const arabicNames = [
      "السؤال الأول", "السؤال الثاني", "السؤال الثالث", "السؤال الرابع",
      "السؤال الخامس", "السؤال السادس", "السؤال السابع", "السؤال الثامن",
      "السؤال التاسع", "السؤال العاشر"
    ];
    text = arabicNames[index] || `السؤال ${index + 1}`;
  }
  if (q.subQuestions && q.subQuestions.length > 0) {
    return {
      ...q,
      id,
      text,
      subQuestions: q.subQuestions.map((sq: any, i: number) => fixInlineSubQuestions(sq, `${id}_${i}`, level + 1, i))
    };
  }
  return { ...q, id, text };
}

function filterAndCleanGeneralNotes(questions: any[]): any[] {
  if (!questions || !Array.isArray(questions)) return [];
  const result: any[] = [];
  questions.forEach((q: any) => {
    if (!q) return;
    const text = q.text || '';
    if (isGeneralExamNote(text)) {
      const subQs = q.subQuestions || q.subquestions || [];
      if (subQs.length > 0) {
        result.push({ ...q, text: "السؤال الأول", subQuestions: subQs });
      }
    } else {
      result.push(q);
    }
  });
  return result;
}

function normalizeParsedQuestions(questions: any[]): any[] {
  if (!questions || !Array.isArray(questions)) return [];
  return questions.map((q: any) => {
    if (!q) return null;
    if (typeof q === 'string') {
      return {
        id: `q_${Math.random().toString(36).substr(2, 4)}`,
        text: q, answer: '', grade: 0, type: 'text', subQuestions: []
      };
    }
    const text = q.text || q.question || q.text_arabic || '';
    const rawSubQs = q.subQuestions || q.subquestions || q.sub_questions || [];
    const normalizedSubQs = (Array.isArray(rawSubQs) ? rawSubQs : []).map((sq: any) => {
      if (!sq) return null;
      if (typeof sq === 'string') {
        return {
          id: `sq_${Math.random().toString(36).substr(2, 4)}`,
          text: sq, answer: '', grade: 0, type: 'text', subQuestions: []
        };
      }
      const sqText = sq.text || sq.question || sq.text_arabic || sq.title || '';
      const sqSubQs = sq.subQuestions || sq.subquestions || sq.sub_questions || [];
      return {
        id: sq.id || sq.questionId || `sq_${Math.random().toString(36).substr(2, 4)}`,
        text: sqText,
        answer: sq.answer || '',
        grade: Number(sq.grade) || 0,
        type: sq.type || 'text',
        options: sq.options || [],
        subQuestions: Array.isArray(sqSubQs) && sqSubQs.length > 0 ? normalizeParsedQuestions(sqSubQs) : [],
        subStyle: sq.subStyle || 'numbers'
      };
    }).filter(Boolean);
    return {
      id: q.id || `q_${Math.random().toString(36).substr(2, 4)}`,
      text,
      answer: q.answer || '',
      grade: Number(q.grade) || 0,
      type: q.type || 'text',
      options: q.options || [],
      subQuestions: normalizedSubQs,
      requiredSubCount: q.requiredSubCount || q.requiredSubquestionsCount,
      subStyle: q.subStyle || (normalizedSubQs.length > 0 ? 'letters' : undefined)
    };
  }).filter(Boolean);
}

function splitInlinePointsIfAny(q: any): any {
  if (!q) return q;
  if (q.subQuestions && q.subQuestions.length > 0) {
    return { ...q, subQuestions: q.subQuestions.map((sq: any) => splitInlinePointsIfAny(sq)) };
  }
  const textVal = q.text || '';
  const answerVal = q.answer || '';
  const patternHindi = /(?:\(|^|\s|-)(١|٢|٣|٤|٥|٦|٧|٨|٩|1|2|3|4|5|6|7|8|9|أولاً|ثانياً|ثالثاً|رابعاً|خامساً)(?:\)|\s*-|\s*\.|\s+|:)/g;
  const matches: { index: number; text: string; num: string }[] = [];
  let match;
  patternHindi.lastIndex = 0;
  while ((match = patternHindi.exec(answerVal)) !== null) {
    matches.push({ index: match.index, text: match[0], num: match[1] });
  }
  if (matches.length >= 2) {
    const newSubQuestions: any[] = [];
    const totalGrade = q.grade || 0;
    const partGrade = totalGrade > 0 ? parseFloat((totalGrade / matches.length).toFixed(1)) : 0;
    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const start = currentMatch.index;
      const end = (i + 1 < matches.length) ? matches[i + 1].index : answerVal.length;
      const fullPart = answerVal.substring(start, end).trim();
      let partText = `${q.text} (${currentMatch.num})`;
      let partAnswer = fullPart;
      const eqIndex = fullPart.indexOf('=');
      if (eqIndex !== -1) {
        partText = `${q.text} ${fullPart.substring(0, eqIndex + 1).trim()}`;
        partAnswer = fullPart.substring(eqIndex + 1).trim();
      } else {
        const eqMatch = fullPart.match(/(=|يساوي|ناتج)/);
        if (eqMatch && eqMatch.index !== undefined) {
          partText = `${q.text} ${fullPart.substring(0, eqMatch.index + eqMatch[0].length).trim()}`;
          partAnswer = fullPart.substring(eqMatch.index + eqMatch[0].length).trim();
        }
      }
      newSubQuestions.push({
        id: `${q.id}_pt_${i + 1}`,
        text: partText, answer: partAnswer, grade: partGrade,
        type: q.type || 'text', subQuestions: []
      });
    }
    return { ...q, answer: '', subQuestions: newSubQuestions };
  }
  const textMatches: { index: number; text: string; num: string }[] = [];
  patternHindi.lastIndex = 0;
  while ((match = patternHindi.exec(textVal)) !== null) {
    textMatches.push({ index: match.index, text: match[0], num: match[1] });
  }
  if (textMatches.length >= 2) {
    const newSubQuestions: any[] = [];
    const totalGrade = q.grade || 0;
    const partGrade = totalGrade > 0 ? parseFloat((totalGrade / textMatches.length).toFixed(1)) : 0;
    for (let i = 0; i < textMatches.length; i++) {
      const currentMatch = textMatches[i];
      const start = currentMatch.index;
      const end = (i + 1 < textMatches.length) ? textMatches[i + 1].index : textVal.length;
      const partText = textVal.substring(start, end).trim();
      let partAnswer = '';
      if (answerVal) {
        const lines = answerVal.split(/\s{2,}|\n/);
        if (lines.length === textMatches.length) {
          partAnswer = lines[i].trim();
        } else {
          patternHindi.lastIndex = 0;
          const ansMatches: { index: number; text: string; num: string }[] = [];
          while ((match = patternHindi.exec(answerVal)) !== null) {
            ansMatches.push({ index: match.index, text: match[0], num: match[1] });
          }
          if (ansMatches.length === textMatches.length) {
            const aStart = ansMatches[i].index;
            const aEnd = (i + 1 < ansMatches.length) ? ansMatches[i + 1].index : answerVal.length;
            partAnswer = answerVal.substring(aStart, aEnd).trim();
          } else {
            partAnswer = answerVal;
          }
        }
      }
      newSubQuestions.push({
        id: `${q.id}_pt_${i + 1}`,
        text: partText, answer: partAnswer, grade: partGrade,
        type: q.type || 'text', subQuestions: []
      });
    }
    const mainInstruction = textVal.substring(0, textMatches[0].index).trim();
    return { ...q, text: mainInstruction || q.text, answer: '', subQuestions: newSubQuestions };
  }
  return q;
}

export function ensureTwoLevelHierarchy(questions: any[]): any[] {
  if (!questions || !Array.isArray(questions)) return [];
  const normalized = normalizeParsedQuestions(questions);
  const cleaned = filterAndCleanGeneralNotes(normalized);
  const mapped = cleaned.map((q: any, idx: number) => {
    const collapsed = collapseSingleOvernestedQuestion(q);
    return fixInlineSubQuestions(collapsed, undefined, 1, idx);
  });
  return mapped.map(q => splitInlinePointsIfAny(q));
}

// CORS / response helpers
export function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-ai-provider, x-ai-key, x-ai-model"
    }
  });
}

export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-ai-provider, x-ai-key, x-ai-model",
      "Access-Control-Max-Age": "86400"
    }
  });
}
