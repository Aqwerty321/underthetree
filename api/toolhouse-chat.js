// Vercel Serverless Function: /api/toolhouse-chat
// Proxies Toolhouse (OpenAI-compatible chat completions) so API keys stay server-side.

export const config = {
  runtime: 'nodejs'
};

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }

  const endpoint = process.env.TOOLHOUSE_URL;
  const apiKey = process.env.TOOLHOUSE_API_KEY;
  const model = process.env.TOOLHOUSE_MODEL || undefined;

  if (!endpoint || !apiKey) {
    res.statusCode = 501;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'toolhouse_not_configured' }));
    return;
  }

  const body = await readJson(req);
  if (!body) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
    return;
  }

  // Only forward known fields.
  const forward = {
    model: body.model || model,
    stream: Boolean(body.stream),
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.0,
    top_p: typeof body.top_p === 'number' ? body.top_p : 1.0,
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 256,
    messages: Array.isArray(body.messages) ? body.messages : []
  };

  // If the client didn't pass a model and none configured, let provider decide.
  if (!forward.model) delete forward.model;

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(forward)
    });

    res.statusCode = upstream.status;

    // Pass through content-type if present.
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('content-type', ct);

    // Streaming: pipe as-is (SSE).
    if (forward.stream) {
      res.setHeader('cache-control', 'no-cache, no-transform');
      res.setHeader('connection', 'keep-alive');
      const reader = upstream.body?.getReader?.();
      if (!reader) {
        const txt = await upstream.text();
        res.end(txt);
        return;
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    const txt = await upstream.text();
    res.end(txt);
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'upstream_failed', message: String(e?.message || e) }));
  }
}
