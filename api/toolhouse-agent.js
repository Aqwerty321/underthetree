// Vercel Serverless Function: /api/toolhouse-agent
// Proxies Toolhouse Agent API (used with the Toolhouse→Supabase linker/MCP), keeping any auth server-side.

export const config = {
  runtime: 'nodejs'
};

async function readRawBody(req) {
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body && typeof req.body === 'object') {
    // Vercel may pre-parse JSON for us.
    try {
      return Buffer.from(JSON.stringify(req.body), 'utf8');
    } catch {
      return null;
    }
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return null;
  return Buffer.concat(chunks);
}

function getHeader(req, name) {
  const key = String(name).toLowerCase();
  return req.headers?.[key] || null;
}

function isTruthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

function parseQuery(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }

  const agentUrl = process.env.TOOLHOUSE_AGENT_URL;
  const apiKey = process.env.TOOLHOUSE_AGENT_API_KEY || process.env.TOOLHOUSE_API_KEY || null;

  if (!agentUrl) {
    res.statusCode = 501;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'toolhouse_agent_not_configured' }));
    return;
  }

  const query = parseQuery(req);
  const runId = query.get('runId') || query.get('run_id') || null;

  if (req.method === 'PUT' && !runId) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'missing_run_id' }));
    return;
  }

  const raw = await readRawBody(req);
  const contentType = getHeader(req, 'content-type');
  let forwardBodyBuffer = raw;
  let forwardContentType = contentType;
  let stream = false;

  // If the client sent JSON, support the convenience shapes:
  // - { message: string } -> { message }
  // - { payload: object } -> payload object (exactly)
  // Also: { stream: true } enables streaming even if the payload is empty.
  if (raw && contentType && String(contentType).includes('application/json')) {
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      stream = Boolean(parsed?.stream);

      if (parsed && typeof parsed.payload === 'object' && parsed.payload) {
        forwardBodyBuffer = Buffer.from(JSON.stringify(parsed.payload), 'utf8');
        forwardContentType = 'application/json';
      } else if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        forwardBodyBuffer = Buffer.from(JSON.stringify({ message: parsed.message }), 'utf8');
        forwardContentType = 'application/json';
      } else if (!raw?.length) {
        forwardBodyBuffer = null;
      } else {
        // Forward JSON as-is.
        forwardBodyBuffer = raw;
        forwardContentType = contentType;
      }
    } catch {
      // If it claims JSON but isn't parseable, forward raw.
      forwardBodyBuffer = raw;
      forwardContentType = contentType;
    }
  }

  // Allow streaming even for empty-body POST (curl-style) via query or Accept header.
  const accept = getHeader(req, 'accept') || '';
  stream = stream || isTruthy(query.get('stream')) || String(accept).includes('text/event-stream');

  const upstreamUrl = req.method === 'PUT' ? `${agentUrl.replace(/\/$/, '')}/${encodeURIComponent(runId)}` : agentUrl;

  try {
    const upstreamHeaders = {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(forwardContentType ? { 'content-type': forwardContentType } : {}),
      ...(accept ? { accept: String(accept) } : {})
    };

    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body: forwardBodyBuffer ? forwardBodyBuffer : undefined
    });

    res.statusCode = upstream.status;
    const ct = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    res.setHeader('content-type', ct);

    const runHeader = upstream.headers.get('x-toolhouse-run-id') || upstream.headers.get('X-Toolhouse-Run-ID');
    if (runHeader) res.setHeader('x-toolhouse-run-id', runHeader);

    if (!stream) {
      const txt = await upstream.text();
      res.end(txt);
      return;
    }

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
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'upstream_failed', message: String(e?.message || e) }));
  }
}
