// api/create-checkout.js
// Creates a Stripe Checkout session for the logged-in user.

const PRICES = {
  pro:     { monthly: 'price_1TqaG2Ab4vTz0BaxwrQhTwJp', yearly: 'price_1TqaHFAb4vTz0BaxbRPmgCuR' },
  premium: { monthly: 'price_1TqaIJAb4vTz0BaxMH9omyCY', yearly: 'price_1TqaJ8Ab4vTz0BaxkWh3suyj' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!supabaseUrl || !service || !stripeKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // Verify the logged-in user
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Please sign in first.' });

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: service, Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const user = await userRes.json();

    // Which price?
    const { plan, billing } = req.body || {};
    const priceId = PRICES[plan] && PRICES[plan][billing];
    if (!priceId) return res.status(400).json({ error: 'Invalid plan selection.' });

    // Create the Checkout session
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', 'https://studiosound.ai/app.html?upgraded=1');
    params.append('cancel_url', 'https://studiosound.ai/pricing.html');
    params.append('client_reference_id', user.id);
    params.append('customer_email', user.email);
    params.append('metadata[user_id]', user.id);
    params.append('metadata[plan]', plan);
    params.append('subscription_data[metadata][user_id]', user.id);
    params.append('subscription_data[metadata][plan]', plan);
    params.append('allow_promotion_codes', 'true');

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const session = await stripeRes.json();
    if (session.error) {
      console.error('Stripe error:', session.error);
      return res.status(400).json({ error: session.error.message });
    }

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Failed to start checkout', details: error.message });
  }
}
