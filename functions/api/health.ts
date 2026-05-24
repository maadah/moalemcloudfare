// GET /api/health
import { jsonResponse, handleOptions } from "../_shared/exam-helpers";

export const onRequestOptions = () => handleOptions();
export const onRequestGet = () => jsonResponse({ status: "ok", runtime: "cloudflare-pages-functions" });
