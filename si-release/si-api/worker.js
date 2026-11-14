// Cloudflare Worker entry. Secrets (GEMINI_API_KEY) are Worker secrets, never in the repo or the browser.
import { handleRequest } from './src/core.js';
export default { fetch: (req, env) => handleRequest(req, env) };
