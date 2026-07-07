// api/_usage.js
// Shared gatekeeper: identifies the user, checks their plan's monthly limit,
// and counts the generation. Files starting with "_" are NOT exposed as
// public API routes by Vercel — this is a private helper.

// NOTE: cover_art is counted per API request. Each "Generate" click fires
// 2 requests (Version A + Version B), so request limits are 2x the
// generation counts shown on the pricing page.
const LIMITS = {
  free:    { cover_art: 6,   release_plan: 1,    merch: 2   },
  pro:     { cover_art: 200, release_plan: 1000, merch: 50  },
  premium: { cover_art: 600, release_plan: 1000, merch: 100 },
};

export async function checkAndCount(req, tool) {
  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !service) {
    return { ok: false, status: 500, error: 'Server configuration error' };
  }

  // 1. Who is asking? (token comes from the logged-in browser session)
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    return { ok: false, status: 401, error: 'Please sign in to use this tool.' };
  }

  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: service, Authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) {
    return { ok: false, status: 401, error: 'Session expired — please sign in again.' };
  }
  const user = await userRes.json();

  // 2. What plan are they on?
  const profRes = await fetch(
    `${url}/rest/v1/profiles?id=eq.${user.id}&select=plan`,
    { headers: { apikey: service, Authorization: `Bearer ${service}` } }
  );
  const prof = await profRes.json();
  const plan = (Array.isArray(prof) && prof[0] && prof[0].plan) || 'free';
  const limit = (LIMITS[plan] || LIMITS.free)[tool] ?? 0;

  // 3. How much have they used this month?
  const month = new Date().toISOString().slice(0, 7); // e.g. "2026-07"
  const useRes = await fetch(
    `${url}/rest/v1/usage?user_id=eq.${user.id}&month=eq.${month}&tool=eq.${tool}&select=count`,
    { headers: { apikey: service, Authorization: `Bearer ${service}` } }
  );
  const rows = await useRes.json();
  const count = (Array.isArray(rows) && rows[0] && rows[0].count) || 0;

  // 4. At the limit? Stop BEFORE spending money on the AI call.
  if (count >= limit) {
    return { ok: false, status: 402, error: 'limit_reached', plan, limit };
  }

  // 5. Count this generation (atomic increment via Postgres function)
  await fetch(`${url}/rest/v1/rpc/increment_usage`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user: user.id, p_month: month, p_tool: tool })
  });

  return { ok: true, userId: user.id, plan };
}
