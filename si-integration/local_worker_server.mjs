// Minimal Node HTTP wrapper around the release-candidate Worker for LOCAL wiring tests only.
// It has NO Workers AI binding, so every /v1/ask returns the evidence-only fallback.
// This is not a substitute for `npx wrangler dev --remote` (real model). Port: argv[2] or 8787.
import http from 'node:http';
import { handleRequest } from '../si/worker/src/core.js';
const env = { SI_PROVIDER: 'workers_ai', WORKERS_AI_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', SI_DAILY_CAP: '300', SI_PER_IP_PER_MIN: '60' };
const port = Number(process.argv[2] || 8787);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks);
  const r = await handleRequest(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`local SI worker (no AI binding) on http://127.0.0.1:${port}`));
