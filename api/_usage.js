// api/_usage.js
// Shared gatekeeper: identifies the user, checks their plan's monthly limit,
// and counts the generation. Files starting with "_" are NOT exposed as
// public API routes by Vercel — this is a private helper.

// NOTE: cover_art is counted per API request. Each "Generate" click fires
// 2 requests (Version A + Version B), so request limits are 2x the
// generation counts shown on the pricing page.
const LIMITS = {
  free:    { cover_art: 6,   release_plan: 1,    merch: 2,   lyrics: 3,   transcribe: 2,   forecast: 1,  chat: 20,   ads: 2,   master_preview: 10,  mastering: 1,   ar_check: 1,  report_card: 1  },
  pro:     { cover_art: 200, release_plan: 1000, merch: 50,  lyrics: 200, transcribe: 30,  forecast: 3,  chat: 400,  ads: 30,  master_preview: 100, mastering: 5,   ar_check: 10, report_card: 8  },
  premium: { cover_art: 600, release_plan: 1000, merch: 100, lyrics: 500, transcribe: 100, forecast: 10, chat: 1200, ads: 100, master_preview: 300, mastering: 100, ar_check: 30, report_card: 30 },
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

// ---------- managers ----------
// An artist can let managers work inside their account (Free 0, Pro 1, Premium 3).
// The Studio sends "X-Act-As: <artist user id>" while a manager is working as that artist.
// Everything then runs on the ARTIST's account: their plan, their monthly limits, their saved work.
export const MANAGER_LIMITS = { free: 0, pro: 1, premium: 3 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const svcHeaders = () => { const k = process.env.SUPABASE_SERVICE_ROLE_KEY; return { apikey: k, Authorization: `Bearer ${k}` }; };

export async function planOf(userId) {
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan`, { headers: svcHeaders() });
    const rows = await r.json();
    return (Array.isArray(rows) && rows[0] && rows[0].plan) || 'free';
  } catch (e) { return 'free'; }
}
// plan an artist's managers count against (founders always get the top plan)
export async function managerPlanOf(userId, email) {
  if (isFounder(email)) return 'premium';
  return await planOf(userId);
}

// Who signed in, and which account are they working in?
// -> { ok:true, user, accountId, accountEmail, actingAs }  or  { ok:false, status, error }
export async function resolveAccount(req) {
  const url = process.env.SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { ok: false, status: 500, error: 'Server configuration error' };
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { ok: false, status: 401, error: 'Please sign in to use this tool.' };
  let user = null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: service, Authorization: `Bearer ${token}` } });
    if (r.ok) user = await r.json();
  } catch (e) { user = null; }
  if (!user || !user.id) return { ok: false, status: 401, error: 'Session expired — please sign in again.' };

  const actAs = String((req.headers && (req.headers['x-act-as'] || req.headers['X-Act-As'])) || '').trim();
  if (!actAs || actAs === user.id) return { ok: true, user, accountId: user.id, accountEmail: user.email, actingAs: false };
  if (!UUID.test(actAs)) return { ok: false, status: 400, error: 'Pick an account again.' };

  let row = null;
  try {
    const r = await fetch(`${url}/rest/v1/managers?owner_id=eq.${actAs}&manager_id=eq.${user.id}&status=eq.active&select=owner_email`, { headers: svcHeaders() });
    const rows = r.ok ? await r.json() : [];
    row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) { row = null; }
  if (!row) return { ok: false, status: 403, error: 'not_manager', message: 'You\u2019re no longer a manager on that account. Switch back to your own account.' };
  const plan = await managerPlanOf(actAs, row.owner_email);
  if (!(MANAGER_LIMITS[plan] > 0)) return { ok: false, status: 403, error: 'manager_plan', message: 'This artist\u2019s plan doesn\u2019t include managers right now. Ask them to upgrade to Pro or Premium.' };
  return { ok: true, user, accountId: actAs, accountEmail: row.owner_email || null, actingAs: true, accountPlan: plan };
}

// For routes that need "the account" as a user-like object (Mastering, A&R Check):
// { id: account id, email: account email, actor_email } ; { denied, status, error } ; or null if not signed in
export async function accountUser(req) {
  const a = await resolveAccount(req);
  if (!a.ok) return a.status === 401 || a.status === 500 ? null : { denied: true, status: a.status, error: a.message || a.error };
  return { id: a.accountId, email: a.accountEmail, actor_email: a.user.email, acting_as: a.actingAs };
}

// opts.freeIf(accountId): return true to let this request through without using a credit
// (e.g. a TikTok or YouTube kit for a song that already has an ad kit this month).
export async function checkAndCount(req, tool, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 1. Who is asking, and which account are they working in? (a manager works in the artist's account)
  const acct = await resolveAccount(req);
  if (!acct.ok) return { ok: false, status: acct.status, error: acct.message || acct.error };
  const uid = acct.accountId;
  const who = { userId: uid, actorId: acct.user.id, actorEmail: acct.user.email, actingAs: acct.actingAs };

  let free = false;
  if (typeof opts.freeIf === 'function') { try { free = !!(await opts.freeIf(uid)); } catch (e) { free = false; } }

  // Founder accounts (comma-separated emails in FOUNDER_EMAILS env var) skip
  // limits entirely — testing your own platform shouldn't burn your quota.
  if (isFounder(acct.accountEmail)) {
    return { ok: true, ...who, plan: 'premium', founder: true };
  }

  // 2. What plan is the account on?
  const plan = acct.accountPlan || await planOf(uid);
  if (free) return { ok: true, ...who, plan, free: true };
  const limit = (LIMITS[plan] || LIMITS.free)[tool] ?? 0;

  // 3. How much have they used this month?
  const month = new Date().toISOString().slice(0, 7); // e.g. "2026-07"
  const useRes = await fetch(
    `${url}/rest/v1/usage?user_id=eq.${uid}&month=eq.${month}&tool=eq.${tool}&select=count`,
    { headers: { apikey: service, Authorization: `Bearer ${service}` } }
  );
  const rows = await useRes.json();
  const count = (Array.isArray(rows) && rows[0] && rows[0].count) || 0;

  // 4. At the limit? Stop BEFORE spending money on the AI call.
  if (count >= limit) {
    return { ok: false, status: 402, error: 'limit_reached', plan, limit, actingAs: acct.actingAs };
  }

  // 5. Count this generation (atomic increment via Postgres function)
  await fetch(`${url}/rest/v1/rpc/increment_usage`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user: uid, p_month: month, p_tool: tool })
  });

  return { ok: true, ...who, plan };
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
