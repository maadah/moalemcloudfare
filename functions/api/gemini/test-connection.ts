// GET /api/gemini/test-connection
// Test API key configuration and connectivity to Kimi/Moonshot or OpenRouter.

import {
  Env,
  cleanApiKey,
  isValidKimiApiKeyFormat,
  getAllPotentialKeys,
  callKimiApi,
  DEFAULT_KIMI_MODEL
} from "../../_shared/kimi";
import { jsonResponse, handleOptions } from "../../_shared/exam-helpers";

interface Ctx { request: Request; env: Env; }

export const onRequestOptions = () => handleOptions();

export const onRequestGet = async (context: Ctx): Promise<Response> => {
  const { env } = context;

  const priorityNames = [
    'MOONSHOT_API_KEY',
    'KIMI_API_KEY',
    'OPENROUTER_API_KEY',
    'VITE_MOONSHOT_API_KEY',
    'VITE_KIMI_API_KEY',
    'VITE_OPENROUTER_API_KEY'
  ];

  const detectedKeys: any[] = [];
  priorityNames.forEach(name => {
    const raw = (env as any)[name];
    const val = cleanApiKey(raw);
    const exists = !!val;
    const isFormatValid = exists ? isValidKimiApiKeyFormat(val) : false;
    const preview = (exists && val.length > 8) ? `${val.substring(0, 4)}...${val.substring(val.length - 4)}` : (exists ? "قصير" : "غير موجود");
    detectedKeys.push({
      name, exists, isFormatValid, preview,
      length: exists ? val.length : 0
    });
  });

  const potentialKeys = getAllPotentialKeys(env);
  const testResults: Array<{ name: string; preview: string; success: boolean; error?: string; code?: string }> = [];

  for (const cand of potentialKeys) {
    const preview = cand.value.length > 8 ? `${cand.value.substring(0, 4)}...${cand.value.substring(cand.value.length - 4)}` : "قصير";
    try {
      const modelName = cand.provider === 'openrouter' ? 'moonshotai/kimi-k2' : DEFAULT_KIMI_MODEL;
      const reply = await callKimiApi({
        apiKey: cand.value,
        provider: cand.provider,
        model: modelName,
        messages: [{ role: "user", content: "Hi, respond with 'OK' only." }],
        temperature: 0
      });

      if (reply && reply.trim()) {
        testResults.push({ name: cand.name, preview, success: true });
      } else {
        testResults.push({
          name: cand.name, preview, success: false,
          error: "تمت الاستجابة ولكن الاستجابة فارغة."
        });
      }
    } catch (err: any) {
      let errMsg = err.message || String(err);
      let errCode = "UNKNOWN";
      const lowerMsg = errMsg.toLowerCase();
      let arMsg = errMsg;
      if (lowerMsg.includes("suspended")) {
        arMsg = "⚠️ معطّل بالكامل (Suspended)";
        errCode = "SUSPENDED";
      } else if (lowerMsg.includes("expired")) {
        arMsg = "⚠️ منتهي الصلاحية (Expired)";
        errCode = "EXPIRED";
      } else if (lowerMsg.includes("not found") || lowerMsg.includes("key_invalid") || lowerMsg.includes("invalid_argument") || lowerMsg.includes("invalid api") || lowerMsg.includes("401")) {
        arMsg = "⚠️ مفتاح خاطئ أو غير صالح (Invalid Key)";
        errCode = "INVALID_KEY";
      } else if (lowerMsg.includes("429") || lowerMsg.includes("rate") || lowerMsg.includes("quota")) {
        arMsg = "⚠️ تم تجاوز الحد الأقصى (Rate Limit/Quota)";
        errCode = "RATE_LIMITED";
      }
      testResults.push({ name: cand.name, preview, success: false, error: arMsg, code: errCode });
    }
  }

  const successResult = testResults.find(r => r.success);
  if (successResult) {
    return jsonResponse({
      success: true,
      source: successResult.name,
      preview: successResult.preview,
      message: `تم الاتصال بنجاح باستخدام المفتاح المعرّف في ${successResult.name}`,
      detectedKeys
    });
  } else {
    const firstError = testResults[0];
    return jsonResponse({
      success: false,
      source: firstError?.name || "None",
      preview: firstError?.preview || "",
      message: firstError?.error || "فشل الاتصال بجميع مفاتيح Kimi API. يرجى التحقق من إعدادات المفاتيح في Cloudflare Pages.",
      errorDetails: JSON.stringify(testResults),
      detectedKeys
    });
  }
};
