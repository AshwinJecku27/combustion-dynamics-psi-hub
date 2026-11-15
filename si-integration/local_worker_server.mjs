// Minimal Node HTTP wrapper around the SI Worker code for LOCAL wiring and UI tests only.
// Default: NO Workers AI binding, so every /v1/ask returns the evidence-only fallback.
// --mock-ai: a MOCK model that returns one canned answer (below), passed through the real Worker pipeline (retrieval,
// validator, Evidence Support). It exists only so browser tests can render a model answer. It is not a model, says
// nothing about real model quality, and is never used by the deployed Worker or the GitHub Pages build.
// Not a substitute for `npx wrangler dev --remote` (real model). Usage: node local_worker_server.mjs [port] [--mock-ai]
import http from 'node:http';
import { handleRequest } from '../si/worker/src/core.js';

// Canned answer for "How did flow direction relate to burn time in the SAFFIRE samples?" (every id, number and material
// is in that question's evidence pack). A question containing "markup test" gets the same answer with HTML-like text in
// it, so tests can check that answer text is rendered as text, never as markup.
export const MOCK_ANSWER = {
  status: 'partial',
  direct_answer: 'In SAFFIRE-I the single concurrent-flow sample burned for 420 s and the single opposed-flow sample for 70 s, but with one sample per direction this is an observation, not an established flow-direction effect.',
  key_findings: [
    { text: 'SAFFIRE-I sample S1 (concurrent flow) has a recorded burn time of 420 s; sample S2 (opposed flow) has 70 s.', evidence_class: 'measured_data', citations: ['PSI-98:sample:S1', 'PSI-98:sample:S2'] },
    { text: 'In SAFFIRE-II, sample 2-4 is the only opposed-flow sample; like the other silicone samples, its burn time is recorded as Insignificant.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-4', 'PSI-99:sample:2-1'] },
    { text: 'Because flow direction changes together with other sample variables and each condition was run once, these results mark flow direction as a variable worth repeated, controlled testing rather than showing how it changes flame spread.', evidence_class: 'interpretation', citations: ['PSI-98:sample:S1', 'PSI-99:sample:2-4'] },
  ],
  supporting_investigations: [
    { investigation_id: 'PSI-98', role: 'Two fabric samples burned in concurrent and opposed flow', record_ids: ['PSI-98:sample:S1', 'PSI-98:sample:S2'] },
    { investigation_id: 'PSI-99', role: 'Nine samples, one opposed-flow', record_ids: ['PSI-99:sample:2-4'] },
  ],
  experimental_conditions: [{ text: 'Both SAFFIRE-I samples were SIBAL Fabric with air flow recorded as 20.', citations: ['PSI-98:sample:S1', 'PSI-98:sample:S2'] }],
  limitations: [
    { text: 'Only two SAFFIRE-I observations, differing in flow direction; the difference is not a statistically supported effect.', citations: ['LIM-007'] },
    { text: 'SAFFIRE-II has one sample per condition, with several variables changing at once.', citations: ['LIM-010'] },
  ],
  insufficient_evidence_reason: 'There is no repeated, controlled comparison of flow direction in the evidence store.',
};
const markup = () => ({ ...MOCK_ANSWER, direct_answer: MOCK_ANSWER.direct_answer + ' <img src=x onerror="window.__xss=true"> <b>bold</b>' });

const mock = process.argv.includes('--mock-ai');
const env = { SI_PROVIDER: 'workers_ai', WORKERS_AI_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', SI_DAILY_CAP: '300', SI_PER_IP_PER_MIN: '60',
  ...(mock ? { AI: { run: async (_m, inp) => ({ response: /markup test/i.test(inp.messages[1].content) ? markup() : MOCK_ANSWER }) } } : {}) };
const port = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8787);
if (process.argv[1] && process.argv[1].endsWith('local_worker_server.mjs'))
  http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await handleRequest(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(port, '127.0.0.1', () => console.log(`local SI worker (${mock ? 'MOCK AI: canned answer, not a model' : 'no AI binding'}) on http://127.0.0.1:${port}`));
