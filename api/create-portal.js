// api/create-portal.js
// Opens the Stripe Customer Portal for a paying user — where they can
// switch plans, update their card, or cancel. Prevents double-subscriptions.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  try {
    // Verify the logged-in user
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Please sign in first.' });

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: service, Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const user = await userRes.json();

    // Get their Stripe customer ID from profiles
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=stripe_customer`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` } }
    );
    const prof = await profRes.json();
    const customerId = Array.isArray(prof) && prof[0] && prof[0].stripe_customer;
    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found for this account.' });
    }

    // Create the portal session
    const params = new URLSearchParams();
    params.append('customer', customerId);
    params.append('return_url', 'https://studiosound.ai/app.html');

    const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    const session = await stripeRes.json();
    if (session.error) {
      console.error('Portal error:', session.error);
      return res.status(400).json({ error: session.error.message });
    }

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Portal error:', error);
    return res.status(500).json({ error: 'Failed to open billing portal' });
  }
}
