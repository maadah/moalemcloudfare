// ============================================================================
// Shared Kimi (Moonshot AI) API helper for Cloudflare Pages Functions
// ============================================================================
// Runs on Cloudflare Workers runtime (V8 isolates). Uses only fetch + standard
// Web APIs. No Node.js dependencies.
// ============================================================================

export const DEFAULT_KIMI_MODEL = "kimi-k2.6";
// On OpenRouter, must use a vision-capable model since this app processes
// student exam paper images. "moonshotai/kimi-k2" is text-only and will
// fail with "No endpoints found that support image input".
// Vision-capable Kimi models on OpenRouter: kimi-k2.6, kimi-k2.5, kimi-vl
export const DEFAULT_OPENROUTER_MODEL = "moonshotai/kimi-k2.6";
export const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface Env {
  MOONSHOT_API_KEY?: string;
  KIMI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  VITE_MOONSHOT_API_KEY?: string;
  VITE_KIMI_API_KEY?: string;
}

export interface KeyInfo {
  name: string;
  value: string;
  provider: 'moonshot' | 'openrouter';
}

export function cleanApiKey(val: string | undefined | null): string {
  if (!val) return "";
  let cleaned = String(val).trim();
  
  // Remove invisible/zero-width characters
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, "");
  
  // Handle pasted "export FOO=value" or "FOO=value" — BUT only if the prefix
  // looks like a variable name (uppercase + underscore), not just any "=".
  // This avoids breaking keys that legitimately contain "=".
  if (/^[A-Z_][A-Z0-9_]*\s*=/i.test(cleaned)) {
    const eqIdx = cleaned.indexOf('=');
    cleaned = cleaned.substring(eqIdx + 1).trim();
  }
  if (cleaned.toLowerCase().startsWith('export ')) {
    cleaned = cleaned.substring(7).trim();
  }
  
  // Strip surrounding quotes
  while ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  
  // Remove only outer whitespace (NOT internal — keys shouldn't have spaces
  // anyway, but if Cloudflare adds something weird, strip them).
  cleaned = cleaned.replace(/\s/g, '').trim();
  
  return cleaned;
}

export function isValidKimiApiKeyFormat(key: string): boolean {
  if (!key) return false;
  const k = key.trim();
  const uppercaseKey = k.toUpperCase();
  if (
    uppercaseKey === 'MY_KIMI_API_KEY' ||
    uppercaseKey === 'KIMI_API_KEY' ||
    uppercaseKey === 'MOONSHOT_API_KEY' ||
    uppercaseKey === 'OPENROUTER_API_KEY' ||
    uppercaseKey === 'VITE_KIMI_API_KEY' ||
    uppercaseKey === 'VITE_MOONSHOT_API_KEY' ||
    uppercaseKey.includes('YOUR_') ||
    uppercaseKey.includes('API_KEY_INSERT') ||
    uppercaseKey.includes('PLACEHOLDER') ||
    uppercaseKey.startsWith('<') ||
    uppercaseKey === '' ||
    uppercaseKey === 'UNDEFINED'
  ) {
    return false;
  }
  return k.length >= 20 && k.toLowerCase().startsWith('sk-');
}

export function getAllPotentialKeys(env: Env): KeyInfo[] {
  const list: KeyInfo[] = [];
  const moonshotNames = ['MOONSHOT_API_KEY', 'KIMI_API_KEY', 'VITE_MOONSHOT_API_KEY', 'VITE_KIMI_API_KEY'];
  moonshotNames.forEach(name => {
    const raw = (env as any)[name];
    const cleaned = cleanApiKey(raw);
    if (cleaned && isValidKimiApiKeyFormat(cleaned) && !list.some(x => x.value === cleaned)) {
      const provider: 'moonshot' | 'openrouter' = cleaned.toLowerCase().startsWith('sk-or-') ? 'openrouter' : 'moonshot';
      list.push({ name, value: cleaned, provider });
    }
  });
  const openrouterNames = ['OPENROUTER_API_KEY', 'VITE_OPENROUTER_API_KEY'];
  openrouterNames.forEach(name => {
    const raw = (env as any)[name];
    const cleaned = cleanApiKey(raw);
    if (cleaned && isValidKimiApiKeyFormat(cleaned) && !list.some(x => x.value === cleaned)) {
      list.push({ name, value: cleaned, provider: 'openrouter' });
    }
  });
  return list;
}

export function isApiKeyError(error: any): boolean {
  if (!error) return false;
  const msg = error.message ? String(error.message).toLowerCase() : "";
  return (
    msg.includes("api key") ||
    msg.includes("api_key") ||
    msg.includes("expired") ||
    msg.includes("suspended") ||
    msg.includes("not found") ||
    msg.includes("key_invalid") ||
    msg.includes("invalid_key") ||
    msg.includes("permission_denied") ||
    msg.includes("invalid argument") ||
    msg.includes("invalid_argument") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication") ||
    msg.includes("401") ||
    error.status === 400 ||
    error.status === 401 ||
    error.status === 403
  );
}

// Convert Gemini-style "parts" (text + inlineData images) to OpenAI-compatible
// "content" array (text + image_url) used by both Moonshot and OpenRouter.
export function mapPartsToOpenAIContent(parts: any[]): any[] {
  const contentArray: any[] = [];
  for (const part of parts) {
    if (part.text !== undefined) {
      if (typeof part.text === 'string' && part.text.trim()) {
        contentArray.push({ type: "text", text: part.text });
      }
    } else if (part.inlineData) {
      const mime = part.inlineData.mimeType || "image/jpeg";
      const base64 = part.inlineData.data;
      contentArray.push({
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${base64}`
        }
      });
    }
  }
  return contentArray;
}

export async function callKimiApi(opts: {
  apiKey: string;
  provider: 'moonshot' | 'openrouter';
  model: string;
  messages: any[];
  temperature: number;
  responseMimeType?: string;
}): Promise<string> {
  const { apiKey, provider, model, messages, temperature, responseMimeType } = opts;
  const baseUrl = provider === 'openrouter' ? OPENROUTER_BASE_URL : MOONSHOT_BASE_URL;
  const url = `${baseUrl}/chat/completions`;
  const headers: any = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };
  if (provider === 'openrouter') {
    headers["HTTP-Referer"] = "https://smart-grader.app";
    headers["X-Title"] = "Smart Grader - Iraqi Teacher Assistant";
  }
  const body: any = { model, messages, temperature };
  if (responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    let parsedErr: any = {};
    try { parsedErr = JSON.parse(errText); } catch {}
    const errMsg = parsedErr?.error?.message || parsedErr?.message || errText || "خطأ غير معروف";
    const err: any = new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'Kimi'} API Error: ${errMsg}`);
    err.status = res.status;
    throw err;
  }
  const jsonRes: any = await res.json();
  return jsonRes.choices?.[0]?.message?.content || "";
}

// Per-request failed-keys set (Workers are stateless per request).
export async function executeAiRequest(
  env: Env,
  reqHeaders: Headers,
  options: {
    model?: string;
    parts: any[];
    systemInstruction?: string;
    temperature?: number;
    responseMimeType?: string;
  }
): Promise<string> {
  let provider = (reqHeaders.get("x-ai-provider") || "moonshot").toLowerCase();
  if (provider === "kimi" || provider === "gemini") provider = "moonshot";
  const customKey = cleanApiKey(reqHeaders.get("x-ai-key"));
  const customModel = reqHeaders.get("x-ai-model");

  console.log(`[AI Request] Provider: ${provider}, Model: ${customModel || options.model || DEFAULT_KIMI_MODEL}`);

  const messages: any[] = [];
  if (options.systemInstruction) {
    messages.push({ role: "system", content: options.systemInstruction });
  }
  messages.push({ role: "user", content: mapPartsToOpenAIContent(options.parts) });

  const tempVal = options.temperature !== undefined ? options.temperature : 0.1;

  // Custom client-supplied key from header
  if (customKey && isValidKimiApiKeyFormat(customKey)) {
    const detectedProvider: 'moonshot' | 'openrouter' =
      provider === 'openrouter' || customKey.toLowerCase().startsWith('sk-or-') ? 'openrouter' : 'moonshot';
    let modelName = customModel || options.model;
    if (!modelName) {
      modelName = detectedProvider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_KIMI_MODEL;
    }
    console.log(`[Kimi] Using custom API key from headers (${detectedProvider}).`);
    return await callKimiApi({
      apiKey: customKey,
      provider: detectedProvider,
      model: modelName,
      messages,
      temperature: tempVal,
      responseMimeType: options.responseMimeType
    });
  }

  // Use env-configured keys with retry/fallback across keys
  const candidates = getAllPotentialKeys(env);
  if (candidates.length === 0) {
    throw new Error("⚠️ لم يتم العثور على أي مفتاح Kimi/Moonshot API صالح في متغيرات البيئة. يرجى إضافة MOONSHOT_API_KEY (يبدأ بـ sk-) في إعدادات Cloudflare Pages.");
  }

  const failedKeys = new Set<string>();
  let lastError: any = null;
  for (const candidate of candidates) {
    if (failedKeys.has(candidate.value)) continue;
    try {
      console.log(`[Kimi] Trying key from "${candidate.name}" via ${candidate.provider} (ends ...${candidate.value.substring(candidate.value.length - 4)})`);
      let modelName = customModel || options.model;
      if (!modelName) {
        modelName = candidate.provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_KIMI_MODEL;
      }
      return await callKimiApi({
        apiKey: candidate.value,
        provider: candidate.provider,
        model: modelName,
        messages,
        temperature: tempVal,
        responseMimeType: options.responseMimeType
      });
    } catch (err: any) {
      lastError = err;
      if (isApiKeyError(err)) {
        console.warn(`[Kimi] Key "${candidate.name}" failed. ${err.message || err}`);
        failedKeys.add(candidate.value);
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}
