// supabase/functions/moderate-wish/index.ts
// Moderation stub for public wishes.
//
// This is intentionally a stub: wire it to your moderation provider of choice.
// Expected behavior (per spec):
// - Check wishes where is_public=true
// - If approved, set moderated=true and moderated_at=now()
// - Never rely on the local model as the only moderation

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // You can parse the wish payload here and call a moderation API.
  // For now, we always reject by default.
  return new Response(JSON.stringify({ ok: false, moderated: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
});
