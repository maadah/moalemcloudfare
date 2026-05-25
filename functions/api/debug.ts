// GET /api/debug
// Diagnostic endpoint - shows exactly what env vars Pages Functions can see.
// SAFE TO USE: only reveals first/last 4 characters of values.

interface Env {
  [key: string]: string | undefined;
}

interface Ctx { request: Request; env: Env; }

function preview(v: string | undefined): string {
  if (!v) return "(empty/undefined)";
  const s = String(v);
  if (s.length <= 8) return `(short, len=${s.length})`;
  return `${s.substring(0, 6)}...${s.substring(s.length - 4)} (len=${s.length})`;
}

export const onRequestGet = async (context: Ctx): Promise<Response> => {
  const env = context.env || {};
  
  // List ALL env keys we can see (just names, no values)
  const allKeys = Object.keys(env);
  
  // Show previews of likely AI-related ones
  const targets = [
    'MOONSHOT_API_KEY',
    'KIMI_API_KEY',
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
    'VITE_MOONSHOT_API_KEY',
    'VITE_KIMI_API_KEY',
    'VITE_OPENROUTER_API_KEY',
    'VITE_FIREBASE_API_KEY'
  ];
  
  const previews: any = {};
  targets.forEach(name => {
    previews[name] = preview(env[name]);
  });
  
  const result = {
    runtime: "cloudflare-pages-functions",
    timestamp: new Date().toISOString(),
    contextHasEnv: !!context.env,
    totalEnvKeysVisible: allKeys.length,
    allVisibleEnvKeyNames: allKeys.sort(),
    apiKeyPreviews: previews,
    diagnostic: allKeys.length === 0 
      ? "⚠️ Pages Functions يرى صفر متغيرات بيئة. إما لم تحفظها أو لم تعمل Re-deploy."
      : `✅ Pages Functions يرى ${allKeys.length} متغيراً.`
  };
  
  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
};
