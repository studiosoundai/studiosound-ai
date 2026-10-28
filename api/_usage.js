// api/_usage.js
// Shared gatekeeper: identifies the user, checks their plan's monthly limit,
// and counts the generation. Files starting with "_" are NOT exposed as
// public API routes by Vercel — this is a private helper.

// NOTE: cover_art is counted per API request. Each "Generate" click fires
// 2 requests (Version A + Version B), so request limits are 2x the
// generation counts shown on the pricing page.
const LIMITS = {
  free:    { cover_art: 6,   release_plan: 1,    merch: 2,   lyrics: 3,   transcribe: 2,   forecast: 1,  chat: 20,   ads: 2,   master_preview: 10,  mastering: 1  },
  pro:     { cover_art: 200, release_plan: 1000, merch: 50,  lyrics: 200, transcribe: 30,  forecast: 3,  chat: 400,  ads: 30,  master_preview: 100, mastering: 5  },
  premium: { cover_art: 600, release_plan: 1000, merch: 100, lyrics: 500, transcribe: 100, forecast: 10, chat: 1200, ads: 100, master_preview: 300, mastering: 100 },
};

// ---------- who's who ----------
// FOUNDER_EMAILS: accounts that skip limits and see every tool before launch.
// OWNER_EMAILS:   accounts that can manage the Team page (if not set, the first FOUNDER_EMAILS address).
// Team members (managed on the Team page, stored in the "team" table): Premium + early access to new tools.
const emails = (v) => String(v || '').toLowerCase().split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
export function isFounder(email) { return !!email && emails(process.env.FOUNDER_EMAILS).includes(String(email).toLowerCase()); }
export function isOwner(email) {
  if (!email) return false;
  const owners = emails(process.env.OWNER_EMAILS);
  const list = owners.length ? owners : emails(process.env.FOUNDER_EMAILS).slice(0, 1);
  return list.includes(String(email).toLowerCase());
}
export async function isTeam(email) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!email || !url || !key) return false;
  try {
    const r = await fetch(`${url}/rest/v1/team?email=eq.${encodeURIComponent(String(email).toLowerCase())}&select=email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const rows = r.ok ? await r.json() : [];
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return false; }
}
// Founders and team members see tools that aren't public yet
export async function hasEarlyAccess(email) { return isFounder(email) || await isTeam(email); }

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

  // Founder accounts (comma-separated emails in FOUNDER_EMAILS env var) skip
  // limits entirely — testing your own platform shouldn't burn your quota.
  if (isFounder(user.email)) {
    return { ok: true, userId: user.id, plan: 'premium', founder: true };
  }

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

// Log every generation (inputs + outputs) — builds the StudioSound dataset
export async function logGeneration(userId, tool, inputs, output) {
  try {
    const url = process.env.SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    await fetch(`${url}/rest/v1/generations`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ user_id: userId, tool: tool, inputs: inputs, output: output })
    });
  } catch (e) { console.error('logGeneration failed', e); }
}
