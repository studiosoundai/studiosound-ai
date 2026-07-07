// api/stripe-webhook.js
// Receives events from Stripe and updates the user's plan in Supabase.
// Authenticity: we re-fetch every event from Stripe's API by its ID before
// acting on it, so forged requests are ignored (they won't exist at Stripe).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  try {
    const incoming = req.body;
    if (!incoming || !incoming.id || !String(incoming.id).startsWith('evt_')) {
      return res.status(400).json({ error: 'Invalid event' });
    }

    // Verify: fetch the real event straight from Stripe
    const verifyRes = await fetch(`https://api.stripe.com/v1/events/${incoming.id}`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    });
    if (!verifyRes.ok) {
      return res.status(400).json({ error: 'Event not found at Stripe' });
    }
    const event = await verifyRes.json();

    const patchProfile = async (query, fields) => {
      await fetch(`${supabaseUrl}/rest/v1/profiles?${query}`, {
        method: 'PATCH',
        headers: {
          apikey: service,
          Authorization: `Bearer ${service}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(fields)
      });
    };

    // Payment completed → upgrade the user
    if (event.type === 'checkout.session.completed') {
      const sess = event.data.object;
      const userId = sess.client_reference_id || (sess.metadata && sess.metadata.user_id);
      const plan = (sess.metadata && sess.metadata.plan) || 'pro';
      if (userId) {
        await patchProfile(`id=eq.${userId}`, {
          plan: plan,
          stripe_customer: sess.customer || null,
          stripe_subscription: sess.subscription || null
        });
        console.log(`Upgraded user ${userId} to ${plan}`);
      }
    }

    // Subscription cancelled/ended → back to free
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const userId = sub.metadata && sub.metadata.user_id;
      if (userId) {
        await patchProfile(`id=eq.${userId}`, { plan: 'free', stripe_subscription: null });
      } else if (sub.id) {
        await patchProfile(`stripe_subscription=eq.${sub.id}`, { plan: 'free', stripe_subscription: null });
      }
      console.log('Subscription ended, user downgraded to free');
    }

    // Plan switched (e.g. Pro -> Premium) via Stripe
    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const userId = sub.metadata && sub.metadata.user_id;
      const plan = sub.metadata && sub.metadata.plan;
      if (userId && plan && sub.status === 'active') {
        await patchProfile(`id=eq.${userId}`, { plan: plan });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
