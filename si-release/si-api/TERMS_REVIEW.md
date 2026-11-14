# Inference provider terms review (checked 2026-11-14)

## Gemini API (Google)
Source: Gemini API Additional Terms of Service, https://ai.google.dev/gemini-api/terms (effective March 23, 2026; page last updated April 28, 2026). The live URL redirects to a host my tools could not open, so the wording was read from the ai.google.dev copy and the 12/18/2025 archive; the age clause was identical in both.
- "You must be 18 years of age or older to use the APIs."
- You may not use the Services as part of an API client "that is directed towards or is likely to be accessed by individuals under the age of 18."
- Unpaid (free) Services: Google uses submitted content and responses to improve its products, and human reviewers may read it. "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
- No exception for verified adults was found. Google's developer forum has open questions on this clause with no official answer.

Finding: creating a key does not establish permission. A public educational NASA Space Apps site is reasonably "likely to be accessed" by under-18s (I could not confirm the Space Apps age rules from the supplied files). I therefore do NOT recommend a public deployment on the Gemini API without written confirmation from Google or legal advice. This is not legal advice. The Gemini provider remains in the code for adult-only, local or authorised use.

## Cloudflare Workers AI (chosen primary for the public demo)
- Runs inside the same Worker through an AI binding, so there is no API key to leak. Free: 10,000 neurons per day, reset 00:00 UTC; on the Free plan, further calls fail until reset (https://developers.cloudflare.com/workers-ai/platform/pricing/).
- Model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`: 24,000-token context; listed as zero data retention; Meta Llama 3.3 license.
- Estimated capacity: roughly 40 to 60 questions per day on the free allocation (about 3,000 to 8,000 input tokens each). When exhausted the page shows evidence only.
- NOT verified: Cloudflare's own terms on end users under 18 and the Llama 3.3 license / acceptable-use terms for an educational public demo. The account holder must read and accept them; I did not.
- NOT tested: real Workers AI output (no network or Cloudflare account here). JSON-mode support for this model is not confirmed on its model page; the verifier rejects malformed output and the page falls back.

## Other options
- Browser WebGPU inference (for example WebLLM): no server, no key, no data leaves the browser, so no API age clause. Costs: a 1 to 4 GB model download on the user's device, needs a WebGPU browser, small models are weaker at structured, cited JSON (more fallbacks), and retrieval plus the verifier would have to be bundled into the page. About 1 to 2 days of work; not started, not testable in this workspace.
- Evidence-only mode (no model): already works and is honestly labelled.
