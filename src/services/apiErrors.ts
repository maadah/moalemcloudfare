// ─────────────────────────────────────────────────────────────────────────────
// apiErrors.ts  —  Friendly error messages for Kimi (Moonshot AI) API failures
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
 * Matches Kimi (sk-...), Google (AIza...), OpenAI (sk-proj-...), and generic tokens.
 */
function sanitize(text: string): string {
  return text
    .replace(/api[_-]?key[:\s'"]+[A-Za-z0-9_\-]{10,}/gi, 'api_key:***')
    .replace(/AIza[A-Za-z0-9_\-]{30,}/g, 'AIza***')
    .replace(/sk-[A-Za-z0-9_\-]{20,}/g, 'sk-***')
    .replace(/[A-Za-z0-9_\-]{35,}/g, '***');
}

/**
 * Parses any thrown error and returns a user-friendly Arabic error object.
 * Raw messages are sanitized and never shown as-is.
 */
export function parseApiError(error: unknown): ApiErrorInfo {
  const raw = error instanceof Error ? error.message : String(error);

  // Try to extract structured info from JSON embedded in the message
  let code: number | null = null;
  let status: string | null = null;

  try {
    const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      code   = parsed?.error?.code   ?? null;
      status = parsed?.error?.status ?? null;
    }
  } catch { /* plain text */ }

  // ── Suspended / Permission denied (key revoked or banned) ─────────────────
  if (raw.includes('suspended') || raw.includes('Permission denied') || raw.includes('has been suspended')) {
    return {
      icon: '🚫',
      title: 'مفتاح API موقوف',
      message: 'تم إيقاف مفتاح API المستخدم من قِبل مزود الخدمة.',
      suggestion: 'افتح إعدادات التطبيق (⚙️) وأدخل مفتاح API جديداً.',
      canRetry: false,
    };
  }

  // ── 402 / Insufficient balance  (Kimi pay-as-you-go) ──────────────────────
  if (code === 402 || raw.includes('insufficient') || raw.includes('balance') || raw.includes('billing') || raw.includes('payment')) {
    return {
      icon: '💳',
      title: 'الرصيد غير كافٍ',
      message: 'رصيد حساب Kimi API نفد أو غير مفعّل.',
      suggestion: 'افتح platform.moonshot.ai وقم بشحن رصيد الحساب، ثم أعد المحاولة.',
      canRetry: false,
    };
  }

  // ── 503 / UNAVAILABLE  (high demand / overloaded) ─────────────────────────
  if (code === 503 || status === 'UNAVAILABLE' || raw.includes('high demand') || raw.includes('UNAVAILABLE') || raw.includes('overloaded')) {
    return {
      icon: '🔄',
      title: 'الخادم مشغول حالياً',
      message: 'النموذج يعاني من ضغط عالٍ في الوقت الحالي. هذا وضع مؤقت وليس خطأ في إعداداتك.',
      suggestion: 'انتظر دقيقة أو دقيقتين ثم أعد المحاولة. إذا استمر الخطأ، حاول في وقت لاحق من اليوم.',
      canRetry: true,
    };
  }

  // ── 429 / RESOURCE_EXHAUSTED  (rate limit / quota) ────────────────────────
  if (code === 429 || status === 'RESOURCE_EXHAUSTED' || raw.includes('quota') || raw.includes('rate limit') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('rate_limit') || raw.includes('too many')) {
    return {
      icon: '⏳',
      title: 'تم تجاوز حد الاستخدام',
      message: 'تم الوصول إلى الحد الأقصى لطلبات API لهذا المفتاح أو هذه الفترة الزمنية.',
      suggestion: 'انتظر بضع دقائق ثم أعد المحاولة، أو تحقق من حصة مفتاح API الخاص بك على لوحة التحكم.',
      canRetry: true,
    };
  }

  // ── 401 / UNAUTHENTICATED  (wrong or invalid key) ─────────────────────────
  if (code === 401 || status === 'UNAUTHENTICATED' || raw.includes('UNAUTHENTICATED') || raw.includes('Unauthorized') || (raw.includes('invalid') && raw.includes('key'))) {
    return {
      icon: '🔑',
      title: 'مفتاح API غير صحيح',
      message: 'مفتاح API المُدخل غير صالح أو منتهي الصلاحية.',
      suggestion: 'افتح إعدادات التطبيق (⚙️) وتأكد من إدخال مفتاح API الصحيح.',
      canRetry: false,
    };
  }

  // ── 403 / Forbidden ───────────────────────────────────────────────────────
  if (code === 403 || raw.includes('Forbidden') || raw.includes('forbidden')) {
    return {
      icon: '⛔',
      title: 'الوصول مرفوض',
      message: 'لا يملك المفتاح الصلاحية لاستخدام هذا النموذج.',
      suggestion: 'تأكد من تفعيل النموذج المطلوب في حسابك على لوحة التحكم.',
      canRetry: false,
    };
  }

  // ── 400 / INVALID_ARGUMENT  (bad request) ─────────────────────────────────
  if (code === 400 || status === 'INVALID_ARGUMENT' || raw.includes('INVALID_ARGUMENT') || raw.includes('Bad Request')) {
    return {
      icon: '⚠️',
      title: 'خطأ في البيانات المُرسلة',
      message: 'تعذّر على النموذج معالجة الصور أو البيانات المُرسلة.',
      suggestion: 'تأكد من أن الصور واضحة وغير تالفة، ثم أعد المحاولة.',
      canRetry: true,
    };
  }

  // ── 500 / INTERNAL  (server-side crash) ───────────────────────────────────
  if (code === 500 || status === 'INTERNAL' || raw.includes('INTERNAL') || raw.includes('Internal Server')) {
    return {
      icon: '🛠️',
      title: 'خطأ داخلي في الخادم',
      message: 'حدث خطأ داخلي في خادم Kimi. هذا ليس خطأ في التطبيق.',
      suggestion: 'أعد المحاولة بعد لحظات. إذا تكرر، قلّل عدد الصور أو الأسئلة وحاول مجدداً.',
      canRetry: true,
    };
  }

  // ── Network / fetch failures ───────────────────────────────────────────────
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('network') || raw.includes('internet')) {
    return {
      icon: '🌐',
      title: 'انقطع الاتصال بالإنترنت',
      message: 'تعذّر الوصول إلى خادم Kimi. تحقق من اتصالك بالإنترنت.',
      suggestion: 'تأكد من اتصالك بالإنترنت ثم أعد المحاولة.',
      canRetry: true,
    };
  }

  // ── JSON parse failure ────────────────────────────────────────────────────
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

  // ── Fallback — NEVER expose raw message ──────────────────────────────────
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
