// Replaceable model providers. Keys come only from the server environment (env.*), never from the browser.
export class ProviderError extends Error { constructor(code, msg, status) { super(msg); this.code = code; this.status = status; } }

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['answered', 'partial', 'insufficient_evidence'] },
    direct_answer: { type: 'STRING' },
    key_findings: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, evidence_class: { type: 'STRING', enum: ['measured_data', 'report_derived', 'plan_or_metadata', 'calculated', 'interpretation'] }, citations: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['text', 'evidence_class', 'citations'] } },
    supporting_investigations: { type: 'ARRAY', items: { type: 'OBJECT', properties: { investigation_id: { type: 'STRING' }, role: { type: 'STRING' }, record_ids: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['investigation_id', 'role', 'record_ids'] } },
    experimental_conditions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, citations: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['text', 'citations'] } },
    limitations: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, citations: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['text', 'citations'] } },
    insufficient_evidence_reason: { type: 'STRING' },
  },
  required: ['status', 'direct_answer', 'key_findings', 'supporting_investigations', 'experimental_conditions', 'limitations', 'insufficient_evidence_reason'],
};
export const RESPONSE_SCHEMA = SCHEMA;
const lower = (o) => Array.isArray(o) ? o.map(lower) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : lower(v)])) : o;
export const JSON_SCHEMA = lower(SCHEMA);

async function post(fetchImpl, url, headers, body, timeoutMs) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try { res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal }); }
  catch (e) { throw new ProviderError(e.name === 'AbortError' ? 'timeout' : 'network_error', 'model request failed: ' + (e.name || 'error')); }
  finally { clearTimeout(t); }
  if (res.status === 429) throw new ProviderError('rate_limited', 'model rate limit reached', 429);
  if (res.status === 401 || res.status === 403) throw new ProviderError('auth_error', 'model key rejected', res.status);
  if (!res.ok) throw new ProviderError('provider_error', 'model returned HTTP ' + res.status, res.status);
  try { return await res.json(); } catch { throw new ProviderError('invalid_response', 'model returned non-JSON'); }
}

// A caller-supplied budget (the request deadline) may shorten, never lengthen, the configured per-call timeout.
const within = (timeoutMs, budgetMs) => Math.max(1, Math.min(timeoutMs, Number.isFinite(budgetMs) ? budgetMs : timeoutMs));

export function makeProvider(env, fetchImpl = fetch) {
  const kind = (env.SI_PROVIDER || 'gemini').toLowerCase();
  const timeoutMs = Number(env.SI_MODEL_TIMEOUT_MS || 25000);
  if (kind === 'gemini') {
    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const base = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
    return { name: 'gemini', model, configured: !!env.GEMINI_API_KEY, timeoutMs,
      async generate({ system, user, timeoutMs: budgetMs }) {
        if (!env.GEMINI_API_KEY) throw new ProviderError('no_key', 'GEMINI_API_KEY is not set on the server');
        const j = await post(fetchImpl, `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': env.GEMINI_API_KEY },
          { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: SCHEMA } }, within(timeoutMs, budgetMs));
        const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
        const text = parts && parts.map((p) => p.text || '').join('');
        if (!text) throw new ProviderError('invalid_response', 'model returned no text (blocked or empty)');
        return { text, usage: j.usageMetadata || null };
      } };
  }
  if (kind === 'openai_compat') { // any OpenAI-compatible endpoint (Groq, OpenRouter, local); proves the provider is replaceable
    const model = env.OPENAI_COMPAT_MODEL, base = env.OPENAI_COMPAT_BASE_URL;
    return { name: 'openai_compat', model, configured: !!(env.OPENAI_COMPAT_API_KEY && model && base), timeoutMs,
      async generate({ system, user, timeoutMs: budgetMs }) {
        if (!env.OPENAI_COMPAT_API_KEY || !model || !base) throw new ProviderError('no_key', 'OPENAI_COMPAT_* is not set on the server');
        const j = await post(fetchImpl, base.replace(/\/$/, '') + '/chat/completions', { authorization: 'Bearer ' + env.OPENAI_COMPAT_API_KEY },
          { model, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system + '\nRespond with a single JSON object matching the schema described.' }, { role: 'user', content: user }] }, within(timeoutMs, budgetMs));
        const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!text) throw new ProviderError('invalid_response', 'model returned no text');
        return { text, usage: j.usage || null };
      } };
  }
  if (kind === 'workers_ai') { // Cloudflare Workers AI through the Worker's AI binding: no API key exists anywhere
    const model = env.WORKERS_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    return { name: 'workers_ai', model, configured: !!(env.AI && env.AI.run), timeoutMs,
      // One time budget per generate() call (default SI_MODEL_TIMEOUT_MS = 25 s), shared by the json_schema attempt and
      // its schema-less retry, so one call can never wait longer than the budget. opts.timeoutMs can only shorten it.
      // On timeout the Worker STOPS WAITING. It does not cancel env.AI.run: the runtime gives no cancellation guarantee
      // here, so the abandoned generation may keep running and may still count against the Workers AI allocation.
      async generate({ system, user, timeoutMs: budgetMs }) {
        if (!env.AI || !env.AI.run) throw new ProviderError('no_key', 'Workers AI binding "AI" is not configured');
        const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
        const budget = within(timeoutMs, budgetMs); const start = Date.now();
        const call = (rf) => { let timer; const left = Math.max(1, budget - (Date.now() - start));
          return Promise.race([env.AI.run(model, { messages, max_tokens: 1800, temperature: 0.1, ...(rf ? { response_format: rf } : {}) }),
            new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), left); })]).finally(() => clearTimeout(timer)); };
        let r;
        try {
          try { r = await call({ type: 'json_schema', json_schema: JSON_SCHEMA }); }
          catch (e) { if (/json mode|json_schema|response_format|schema/i.test(String(e && e.message))) r = await call(null); else throw e; } // documented: "JSON Mode couldn't be met"
        } catch (e) { const m = String(e && e.message || e); throw new ProviderError(/timeout/i.test(m) ? 'timeout' : /neuron|limit|quota|capacity|429|3036|4006/i.test(m) ? 'rate_limited' : 'provider_error', 'Workers AI call failed'); }
        let text = r && (r.response !== undefined ? r.response : r.result && r.result.response);
        if (text && typeof text === 'object') text = JSON.stringify(text);
        if (!text || typeof text !== 'string') throw new ProviderError('invalid_response', 'model returned no text');
        return { text, usage: r.usage || null };
      } };
  }
  return { name: kind, model: null, configured: false, async generate() { throw new ProviderError('no_key', 'unknown SI_PROVIDER'); } };
}
