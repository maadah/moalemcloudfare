// Note: This service was originally built around Google Gemini. It has been
// migrated to use Kimi (Moonshot AI). The function/file names are preserved
// to minimize changes across the rest of the codebase — they now route all
// AI requests through Cloudflare Pages Functions which proxy to Kimi/Moonshot.

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
  // Try various common environment variable patterns for Vite/Cloudflare
  const viteKey = (import.meta as any).env?.VITE_KIMI_API_KEY || (import.meta as any).env?.VITE_MOONSHOT_API_KEY;
  if (viteKey && viteKey !== 'undefined' && viteKey !== '') return viteKey.trim();

  // Fallback to process.env if available (usually during dev or if polyfilled)
  try {
    const proc: any = (globalThis as any).process;
    const envKey = proc?.env?.KIMI_API_KEY || proc?.env?.MOONSHOT_API_KEY || proc?.env?.VITE_KIMI_API_KEY;
    if (envKey && envKey !== 'undefined' && envKey !== '') return envKey.trim();
  } catch (e) {
    // process might not be defined in browser
  }
  
  return (localStorage.getItem('KIMI_API_KEY_FALLBACK') || localStorage.getItem('GEMINI_API_KEY_FALLBACK') || '').trim();
};

const getApiKeyErrorMessage = () => {
  const host = window.location.hostname;
  const isCloudflare = host.includes('pages.dev') || host.includes('workers.dev');
  if (isCloudflare) {
    return 'مفتاح API غير مضبوط. إذا كنت تستخدم Cloudflare Pages، تأكد من إضافة المفتاح باسم MOONSHOT_API_KEY في إعدادات البيئة (Environment Variables) في لوحة تحكم Cloudflare. يمكنك أيضاً إدخاله يدوياً من أيقونة الإعدادات (⚙️) في الأعلى.';
  }
  return 'مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) في الأعلى وإدخال مفتاح Kimi (Moonshot) API للمتابعة.';
};

function compressImage(input: string, maxWidth: number, maxHeight: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    const cleanInput = input.includes(',') ? input.split(',')[1] : input;
    const img = new Image();
    if (input.startsWith('http://') || input.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.src = (input.startsWith('data:') || input.startsWith('blob:') || input.startsWith('http://') || input.startsWith('https://')) 
      ? input 
      : `data:image/jpeg;base64,${input}`;
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        // Extract base64 representation of the canvas content
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const commaIndex = dataUrl.indexOf(',');
        resolve(commaIndex !== -1 ? dataUrl.substring(commaIndex + 1) : dataUrl);
      } else {
        resolve(cleanInput);
      }
    };
    img.onerror = () => {
      resolve(cleanInput);
    };
  });
}

const cleanJson = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : text;
  
  // Convert Arabic/Hindi digits (٠-٩) to English digits (0-9) to ensure valid JSON parsing
  const map: { [key: string]: string } = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  return jsonStr.replace(/[٠١٢٣٤٥٦٧٨٩]/g, (d) => map[d] || d);
};

function translateGeminiErrorMessage(rawMsg: string, fallbackMessage: string): string {
  if (!rawMsg) return fallbackMessage;
  
  const lowerMsg = rawMsg.toLowerCase();
  
  // 1. Insufficient balance / credits
  if (
    lowerMsg.includes("insufficient") || 
    lowerMsg.includes("balance") || 
    lowerMsg.includes("credits are depleted") || 
    lowerMsg.includes("depleted") ||
    lowerMsg.includes("credits") ||
    lowerMsg.includes("billing")
  ) {
    return "⚠️ رصيد حساب Kimi/Moonshot قد نفد.\n\nيرجى تعبئة الرصيد من خلال:\nhttps://platform.moonshot.ai/console/account\n\n(رمز الخطأ: INSUFFICIENT_BALANCE)";
  }
  
  // 2. Rate limit / Quota
  if (
    lowerMsg.includes("rate_limit") || 
    lowerMsg.includes("rate limit") || 
    lowerMsg.includes("quota exceeded") || 
    lowerMsg.includes("too many requests") ||
    lowerMsg.includes("429")
  ) {
    return "⚠️ تم تجاوز الحد الأقصى للاستخدام المسموح به حالياً (Rate Limit).\n\nمن فضلك انتظر دقيقة واحدة وأعد المحاولة، أو قم بترقية حسابك في منصة Moonshot لزيادة سقف الاستهلاك.";
  }
  
  // 3. API Key Invalid / Not Found
  if (
    lowerMsg.includes("key_invalid") || 
    lowerMsg.includes("invalid_argument") || 
    lowerMsg.includes("key not found") || 
    lowerMsg.includes("api key not found") || 
    lowerMsg.includes("api_key_invalid") ||
    lowerMsg.includes("invalid api key") ||
    lowerMsg.includes("invalid_api_key") ||
    lowerMsg.includes("authentication") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("401")
  ) {
    return "⚠️ مفتاح Kimi/Moonshot API المستخدم غير صالح أو تم إيقافه.\n\nيرجى التأكد من كتابة مفتاح صحيح (يبدأ بـ sk-) في متغيرات البيئة على Cloudflare (MOONSHOT_API_KEY).";
  }
  
  // 4. Overloaded / Service Unavailable
  if (lowerMsg.includes("overloaded") || lowerMsg.includes("service unavailable") || lowerMsg.includes("temporarily") || lowerMsg.includes("503") || lowerMsg.includes("502")) {
    return "⚠️ خوادم Kimi/Moonshot متوقفة حالياً أو تواجه ضغطاً كبيراً. من فضلك انتظر بضع ثوانٍ ثم أعد المحاولة.";
  }

  return rawMsg;
}

async function safeFetchJson(url: string, options: RequestInit, errorMessage: string): Promise<any> {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = errorMessage;
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        let rawError = parsed.error || detail;
        
        // Handle nested error objects
        if (rawError && typeof rawError === "object") {
          rawError = rawError.message || JSON.stringify(rawError);
        }
        
        detail = translateGeminiErrorMessage(String(rawError), errorMessage);
      } catch {
        if (text && (text.includes("<!doctype html>") || text.includes("<html") || text.includes("<!DOCTYPE"))) {
          detail = `${errorMessage} (حدث خطأ داخلي في الخادم وتم تلقي رد بصيغة HTML).`;
        } else if (text) {
          detail = translateGeminiErrorMessage(text, errorMessage);
        }
      }
    } catch {
      // ignore text error
    }
    throw new Error(detail);
  }
  return await response.json();
}

export async function extractExamFromDualImages(
  questionImages: string[],
  answerImages: string[]
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    return await safeFetchJson("/api/gemini/extract-dual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionImages, answerImages }),
    }, "حدث خطأ أثناء الاتصال بالخادم لاستخراج بيانات الامتحان.");
  } catch (error) {
    console.error("Extraction error:", error);
    throw error;
  }
}

export async function extractExamFromImages(base64Images: string[]): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    return await safeFetchJson("/api/gemini/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Images }),
    }, "حدث خطأ أثناء الاتصال بالخادم لاستخراج الأسئلة.");
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
    if (onProgress) onProgress(0, imageUrls.length, 'compressing');
    
    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const compressed = await compressImage(imageUrls[i], 1200, 1200, 0.75);
      base64ImagesData.push(compressed);
      if (onProgress) onProgress(i + 1, imageUrls.length, 'compressing');
    }

    if (onProgress) onProgress(0, 100, 'grading');
    
    const result = await safeFetchJson("/api/gemini/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base64ImagesData,
        questions,
        totalExamGrade,
        requiredQuestionsCount,
        subject
      }),
    }, "حدث خطأ أثناء الاتصال بالخادم لتصحيح ورقة الطالب.");

    if (onProgress) onProgress(100, 100, 'grading');
    return result;
  } catch (error) {
    console.error("Error in gradeStudentPaper:", error);
    throw error;
  }
}

export async function gradeMathDirect(
  examSheetImageUrls: string[],
  studentPaperImageUrls: string[],
  totalExamGrade: number = 100,
  onProgress?: (current: number, total: number, phase: 'compressing' | 'grading') => void
): Promise<{ results: { studentName: string; totalGrade: number; maxGrade: number; gradings: any[] }[] }> {
  try {
    const totalImages = examSheetImageUrls.length + studentPaperImageUrls.length;
    let compressedCount = 0;
    if (onProgress) onProgress(0, totalImages, 'compressing');
    
    // Compress exam sheets
    const examSheetImages: string[] = [];
    for (let i = 0; i < examSheetImageUrls.length; i++) {
      const compressed = await compressImage(examSheetImageUrls[i], 1200, 1200, 0.75);
      examSheetImages.push(compressed);
      compressedCount++;
      if (onProgress) onProgress(compressedCount, totalImages, 'compressing');
    }

    // Compress student papers
    const studentPaperImages: string[] = [];
    for (let i = 0; i < studentPaperImageUrls.length; i++) {
      const compressed = await compressImage(studentPaperImageUrls[i], 1200, 1200, 0.75);
      studentPaperImages.push(compressed);
      compressedCount++;
      if (onProgress) onProgress(compressedCount, totalImages, 'compressing');
    }

    if (onProgress) onProgress(0, 100, 'grading');
    
    const result = await safeFetchJson("/api/gemini/grade-math-direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examSheetImages,
        studentPaperImages,
        totalExamGrade
      }),
    }, "حدث خطأ أثناء الاتصال بالخادم للتصحيح المباشر.");

    if (onProgress) onProgress(100, 100, 'grading');
    return result;
  } catch (error) {
    console.error("Error in gradeMathDirect:", error);
    throw error;
  }
}

function flattenOvernestedQuestions(questions: any[]): any[] {
  if (!questions || !Array.isArray(questions)) return [];
  
  const result: any[] = [];
  
  questions.forEach((q: any) => {
    if (!q) return;
    
    // Normalize target properties
    const qSubQs = q.subQuestions || q.subquestions || [];
    
    // Check if any sub-question itself has sub-questions (3-level hierarchy: Parent -> Branch -> Points)
    const hasThreeLevels = qSubQs.some((sq: any) => {
      const sqSubQs = sq ? (sq.subQuestions || sq.subquestions || []) : [];
      return sqSubQs.length > 0;
    });
    
    if (hasThreeLevels) {
      // Elevate each branch (Level 2) into its own top-level question card
      qSubQs.forEach((sq: any) => {
        if (!sq) return;
        
        const sqSubQs = sq.subQuestions || sq.subquestions || [];
        
        // Extract parent prefix like "س ١" or "السؤال الأول"
        let parentPrefix = '';
        if (q.text) {
          const match = q.text.match(/^(س\s*\d+|السؤال\s+[^\s:]+)/i);
          if (match) {
            parentPrefix = match[1];
          } else if (q.text.includes(':')) {
            parentPrefix = q.text.split(':')[0].trim();
          } else if (q.text.length < 25) {
            parentPrefix = q.text.trim();
          }
        }
        
        let newQuestionText = sq.text || '';
        if (parentPrefix && !newQuestionText.includes(parentPrefix)) {
          const cleanPrefix = parentPrefix.replace(/[:،,]-?\s*$/, '').trim();
          if (cleanPrefix) {
            newQuestionText = `${cleanPrefix} : ${newQuestionText}`;
          }
        }
        
        result.push({
          id: sq.id || `q_split_${Math.random().toString(36).substr(2, 4)}`,
          text: newQuestionText,
          answer: sq.answer || '',
          grade: sq.grade || q.grade || 0,
          type: sq.type || q.type || 'text',
          options: sq.options || q.options || [],
          subQuestions: sqSubQs.map((ssq: any) => ({
            id: ssq.id || `sq_${Math.random().toString(36).substr(2, 4)}`,
            text: ssq.text || '',
            answer: ssq.answer || '',
            grade: ssq.grade || 0,
            type: ssq.type || 'text',
            options: ssq.options || []
          })),
          subStyle: sq.subStyle || (sqSubQs.some((ssq: any) => ssq.text && /^[أبجدهو]/.test(ssq.text.trim())) ? 'letters' : 'numbers')
        });
      });
    } else {
      // Keep as standard 2-level structure
      result.push({
        ...q,
        subQuestions: qSubQs
      });
    }
  });
  
  return result;
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
    return {
      ...q,
      subQuestions: subQs.map((sq: any) => collapseSingleOvernestedQuestion(sq))
    };
  }
  
  return q;
}

function fixInlineSubQuestions(q: any, parentId?: string, level: number = 1, index: number = 0): any {
  const id = q.id || `${parentId || 'q'}_${Math.random().toString(36).substr(2, 4)}`;
  
  let text = q.text || '';
  if (level === 1 && (!text || text.trim() === '')) {
    const arabicNames = [
      "السؤال الأول",
      "السؤال الثاني",
      "السؤال الثالث",
      "السؤال الرابع",
      "السؤال الخامس",
      "السؤال السادس",
      "السؤال السابع",
      "السؤال الثامن",
      "السؤال التاسع",
      "السؤال العاشر"
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

function isGeneralExamNote(text: string): boolean {
  if (!text) return false;
  const cleaned = text.trim();
  const hasNotePrefix = /^(ملاحظة|ملاحظه|تنبيه|تنبيهات)/.test(cleaned);
  const containsExamInstruction = /أجب عن|الاجابة|الإجابة|أسئلة فقط|سؤال فقط|درجة|درجات|اسئلة|اسئله|اجابة/i.test(cleaned);
  return hasNotePrefix && containsExamInstruction;
}

function parseNumberFromText(text: string): number | undefined {
  const countMap: { [key: string]: number } = {
    'واحد': 1, 'واحدة': 1, 'واحده': 1, 'اثنان': 2, 'اثنين': 2, 'ثلاثة': 3, 'ثلاث': 3, 'ثلاثه': 3, 'اربعة': 4, 'أربعة': 4, 'اربعه': 4, 'أربعه': 4, 'خمسة': 5, 'خمس': 5, 'خمسه': 5, 'ستة': 6, 'ست': 6, 'سته': 6, 'سبعة': 7, 'سبعه': 7, 'ثمانية': 8, 'ثمانيه': 8, 'تسعة': 9, 'تسعه': 9, 'عشرة': 10, 'عشره': 10,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '١٠': 10
  };
  const normalize = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/[ة]/g, 'ه').replace(/[،,.:]/g, '').trim();
  const words = text.split(/\s+/);
  for (const w of words) {
    const nw = normalize(w);
    if (countMap[nw]) {
      return countMap[nw];
    }
    if (countMap[w]) {
      return countMap[w];
    }
  }
  return undefined;
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
        // Fallback: convert the note container to a proper question if branches are grouped inside it
        result.push({
          ...q,
          text: "السؤال الأول",
          subQuestions: subQs
        });
      } else {
        console.log("Filtered out general exam note:", text);
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
        text: q,
        answer: '',
        grade: 0,
        type: 'text',
        subQuestions: []
      };
    }
    
    const text = q.text || q.question || q.text_arabic || '';
    const rawSubQs = q.subQuestions || q.subquestions || q.sub_questions || [];
    
    const normalizedSubQs = (Array.isArray(rawSubQs) ? rawSubQs : []).map((sq: any) => {
      if (!sq) return null;
      if (typeof sq === 'string') {
        return {
          id: `sq_${Math.random().toString(36).substr(2, 4)}`,
          text: sq,
          answer: '',
          grade: 0,
          type: 'text',
          subQuestions: []
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
      text: text,
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
    return {
      ...q,
      subQuestions: q.subQuestions.map((sq: any) => splitInlinePointsIfAny(sq))
    };
  }

  const textVal = q.text || '';
  const answerVal = q.answer || '';

  const patternHindi = /(?:\(|^|\s|-)(١|٢|٣|٤|٥|٦|٧|٨|٩|1|2|3|4|5|6|7|8|9|أولاً|ثانياً|ثالثاً|رابعاً|خامساً)(?:\)|\s*-|\s*\.|\s+|:)/g;
  
  const matches: { index: number; text: string; num: string }[] = [];
  let match;
  patternHindi.lastIndex = 0;
  while ((match = patternHindi.exec(answerVal)) !== null) {
    matches.push({
      index: match.index,
      text: match[0],
      num: match[1]
    });
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
        text: partText,
        answer: partAnswer,
        grade: partGrade,
        type: q.type || 'text',
        subQuestions: []
      });
    }

    return {
      ...q,
      answer: '',
      subQuestions: newSubQuestions
    };
  }

  const textMatches: { index: number; text: string; num: string }[] = [];
  patternHindi.lastIndex = 0;
  while ((match = patternHindi.exec(textVal)) !== null) {
    textMatches.push({
      index: match.index,
      text: match[0],
      num: match[1]
    });
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
        text: partText,
        answer: partAnswer,
        grade: partGrade,
        type: q.type || 'text',
        subQuestions: []
      });
    }

    const mainInstruction = textVal.substring(0, textMatches[0].index).trim();

    return {
      ...q,
      text: mainInstruction || q.text,
      answer: '',
      subQuestions: newSubQuestions
    };
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

export async function testApiConnection(): Promise<{ success: boolean; source: string; preview: string; message: string; errorDetails?: string }> {
  try {
    const response = await fetch("/api/gemini/test-connection");
    if (!response.ok) {
      const err: any = await response.json().catch(() => ({}));
      return {
        success: false,
        source: "Unknown",
        preview: "",
        message: err.error || "حدث خطأ أثناء الاتصال بالخادم لاختبار المفتاح."
      };
    }
    return await response.json() as any;
  } catch (error: any) {
    console.error("Test API Connection Error:", error);
    return {
      success: false,
      source: "ClientError",
      preview: "",
      message: "فشل الاتصال بالخادم لإجراء اختبار الاتصال الرئيسي.",
      errorDetails: error?.message || String(error)
    };
  }
}

