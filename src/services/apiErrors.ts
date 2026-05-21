// ─────────────────────────────────────────────────────────────────────────────
// apiErrors.ts  —  Friendly error messages for Gemini API failures
// SECURITY: Raw error messages are NEVER exposed to the user — they may
//           contain sensitive data such as API keys.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiErrorInfo {
  title: string;
  message: string;
  suggestion: string;
  canRetry: boolean;
  icon: string;
}

/**
 * Strips any API key patterns from a string so they are never shown to users.
 * Matches common Gemini/Google key formats (39-char alphanumeric after "key:").
 */
function sanitize(text: string): string {
  return text
    // Remove "api_key:XXXXX" patterns (as seen in "Consumer 'api_key:AIza...'")
    .replace(/api[_-]?key[:\s'"]+[A-Za-z0-9_\-]{10,}/gi, 'api_key:***')
    // Remove bare AIza... keys (Google API key prefix)
    .replace(/AIza[A-Za-z0-9_\-]{30,}/g, 'AIza***')
    // Remove generic long alphanumeric tokens that look like secrets
    .replace(/[A-Za-z0-9_\-]{35,}/g, '***');
}

/**
 * Parses any thrown error from Gemini API calls and returns a user-friendly
 * Arabic error object. Raw messages are sanitized and never shown as-is.
 */
export function parseApiError(error: unknown): ApiErrorInfo {
  const raw = error instanceof Error ? error.message : String(error);

  // Try to extract structured info from JSON Gemini embeds in the message
  let code: number | null = null;
  let status: string | null = null;

  try {
    const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      code   = parsed?.error?.code   ?? null;
      status = parsed?.error?.status ?? null;
    }
  } catch {
    // plain text message — fall through to keyword matching
  }

  // ── Suspended / Permission denied (key revoked or banned) ─────────────────
  if (raw.includes('suspended') || raw.includes('Permission denied') || raw.includes('has been suspended')) {
    return {
      icon: '🚫',
      title: 'مفتاح API موقوف',
      message: 'تم إيقاف مفتاح Gemini API المستخدم من قِبل Google.',
      suggestion: 'افتح إعدادات التطبيق (⚙️) وأدخل مفتاح API جديداً من Google AI Studio.',
      canRetry: false,
    };
  }

  // ── 503 / UNAVAILABLE  (high demand / overloaded) ─────────────────────────
  if (code === 503 || status === 'UNAVAILABLE' || raw.includes('high demand') || raw.includes('UNAVAILABLE')) {
    return {
      icon: '🔄',
      title: 'الخادم مشغول حالياً',
      message: 'النموذج يعاني من ضغط عالٍ في الوقت الحالي. هذا وضع مؤقت وليس خطأ في إعداداتك.',
      suggestion: 'انتظر دقيقة أو دقيقتين ثم أعد المحاولة. إذا استمر الخطأ، حاول في وقت لاحق من اليوم.',
      canRetry: true,
    };
  }

  // ── 429 / RESOURCE_EXHAUSTED  (rate limit / quota) ────────────────────────
  if (code === 429 || status === 'RESOURCE_EXHAUSTED' || raw.includes('quota') || raw.includes('rate limit') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      icon: '⏳',
      title: 'تم تجاوز حد الاستخدام',
      message: 'تم الوصول إلى الحد الأقصى لطلبات API لهذا المفتاح أو هذه الفترة الزمنية.',
      suggestion: 'انتظر بضع دقائق ثم أعد المحاولة، أو تحقق من حصة مفتاح API الخاص بك على Google AI Studio.',
      canRetry: true,
    };
  }

  // ── 401 / UNAUTHENTICATED  (wrong or invalid key) ─────────────────────────
  if (code === 401 || status === 'UNAUTHENTICATED' || raw.includes('UNAUTHENTICATED') || raw.includes('invalid') && raw.includes('key')) {
    return {
      icon: '🔑',
      title: 'مفتاح API غير صحيح',
      message: 'مفتاح Gemini API المُدخل غير صالح أو منتهي الصلاحية.',
      suggestion: 'افتح إعدادات التطبيق (⚙️) وتأكد من إدخال مفتاح API الصحيح من Google AI Studio.',
      canRetry: false,
    };
  }

  // ── 400 / INVALID_ARGUMENT  (bad request) ─────────────────────────────────
  if (code === 400 || status === 'INVALID_ARGUMENT' || raw.includes('INVALID_ARGUMENT')) {
    return {
      icon: '⚠️',
      title: 'خطأ في البيانات المُرسلة',
      message: 'تعذّر على النموذج معالجة الصور أو البيانات المُرسلة.',
      suggestion: 'تأكد من أن الصور واضحة وغير تالفة، ثم أعد المحاولة.',
      canRetry: true,
    };
  }

  // ── 500 / INTERNAL  (server-side crash) ───────────────────────────────────
  if (code === 500 || status === 'INTERNAL' || raw.includes('INTERNAL')) {
    return {
      icon: '🛠️',
      title: 'خطأ داخلي في الخادم',
      message: 'حدث خطأ داخلي في خادم Gemini. هذا ليس خطأ في التطبيق.',
      suggestion: 'أعد المحاولة بعد لحظات. إذا تكرر، قلّل عدد الصور أو الأسئلة وحاول مجدداً.',
      canRetry: true,
    };
  }

  // ── Network / fetch failures ───────────────────────────────────────────────
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('network') || raw.includes('internet')) {
    return {
      icon: '🌐',
      title: 'انقطع الاتصال بالإنترنت',
      message: 'تعذّر الوصول إلى خادم Gemini. تحقق من اتصالك بالإنترنت.',
      suggestion: 'تأكد من اتصالك بالإنترنت ثم أعد المحاولة.',
      canRetry: true,
    };
  }

  // ── JSON parse failure (model returned garbage) ───────────────────────────
  if (raw.includes('JSON') || raw.includes('SyntaxError') || raw.includes('Unexpected token')) {
    return {
      icon: '📄',
      title: 'فشل في قراءة نتيجة التصحيح',
      message: 'أعاد النموذج استجابة غير مفهومة. هذا يحدث أحياناً عند ضغط النموذج العالي.',
      suggestion: 'أعد المحاولة مرة أخرى. إذا تكرر، قلّل عدد الصور المرفوعة.',
      canRetry: true,
    };
  }

  // ── Timeout ───────────────────────────────────────────────────────────────
  if (raw.includes('timeout') || raw.includes('timed out') || raw.includes('AbortError')) {
    return {
      icon: '⌛',
      title: 'انتهت مهلة الطلب',
      message: 'استغرق الطلب وقتاً طويلاً ولم يكتمل.',
      suggestion: 'قلّل عدد الصور المرفوعة أو اختر صوراً بجودة أقل، ثم أعد المحاولة.',
      canRetry: true,
    };
  }

  // ── Fallback — NEVER expose raw message (may contain API key) ────────────
  // Log to console for debugging (server-side only, not visible to users)
  console.error('[apiErrors] Unclassified error (sanitized):', sanitize(raw));
  return {
    icon: '❌',
    title: 'حدث خطأ غير متوقع',
    message: 'تعذّرت العملية بسبب خطأ غير معروف.',
    suggestion: 'أعد المحاولة. إذا استمر الخطأ، تحقق من إعدادات مفتاح API أو تواصل مع الدعم.',
    canRetry: true,
  };
}

/**
 * Formats an ApiErrorInfo into a single readable Arabic string.
 * Safe to display to users — never contains raw error data or API keys.
 */
export function formatApiError(error: unknown): string {
  const info = parseApiError(error);
  return `${info.icon} ${info.title}\n\n${info.message}\n\n💡 ${info.suggestion}`;
}
