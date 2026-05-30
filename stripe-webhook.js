import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const priceToPlan = {
  [process.env.STRIPE_PRICE_STARTER]: "Starter",
  [process.env.STRIPE_PRICE_INVESTOR]: "Investor",
  [process.env.STRIPE_PRICE_PROFESSIONAL]: "Professional"
};

export const config = {
  api: {
    bodyParser: false
  }
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      let email = null;
      let priceId = null;
      let subscriptionId = null;
      let customerId = null;

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        email =
          session.customer_details?.email ||
          session.customer_email ||
          session.metadata?.email ||
          null;

        subscriptionId = session.subscription;
        customerId = session.customer;

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          priceId = subscription.items.data[0]?.price?.id || null;
        } else if (session.line_items) {
          priceId = session.line_items.data[0]?.price?.id || null;
        }
      } else {
        const subscription = event.data.object;
        subscriptionId = subscription.id;
        customerId = subscription.customer;
        priceId = subscription.items.data[0]?.price?.id || null;

        const customer = await stripe.customers.retrieve(customerId);
        email = customer?.email || null;
      }

      const plan = priceToPlan[priceId];

      if (!email || !plan) {
        console.warn("Missing email or plan", { email, plan, priceId });
        return res.status(200).json({ received: true, skipped: true });
      }

      const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      if (listError) throw listError;

      const user = users.users.find(
        (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
      );

      if (!user) {
        console.warn("No Supabase user found for Stripe email:", email);
        return res.status(200).json({ received: true, user_found: false });
      }

      const { error: upsertError } = await supabaseAdmin
        .from("member_profiles")
        .upsert({
          id: user.id,
          email,
          plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          updated_at: new Date().toISOString()
        });

      if (upsertError) throw upsertError;

      console.log(`Updated ${email} to ${plan}`);
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const { error } = await supabaseAdmin
        .from("member_profiles")
        .update({
          plan: "Starter",
          stripe_subscription_id: null,
          updated_at: new Date().toISOString()
        })
        .eq("stripe_customer_id", customerId);

      if (error) throw error;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler failed:", err);
    return res.status(500).json({ error: err.message });
  }
}
