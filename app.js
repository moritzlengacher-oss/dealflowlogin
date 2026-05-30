/*
  DealFlow Schweiz - echter Login mit Supabase + Paywall

  Prinzip:
  - Nutzer können ein Konto erstellen.
  - Zugriff auf den Mitgliederbereich gibt es erst, wenn subscription_status = active ist.
  - Stripe Webhook setzt bezahlte Mitglieder automatisch auf active.
  - Falls jemand bezahlt, bevor er ein Konto erstellt, wird die Zahlung in paid_memberships gespeichert
    und beim ersten Login automatisch dem Account zugeordnet.

  In Supabase müssen ausgeführt sein:
  - supabase-schema.sql
  - supabase-paywall-fix.sql

  In dieser Datei sind deine Supabase Frontend Keys bereits eingetragen.
*/

const SUPABASE_URL = "https://zguxggwetwwkduhwbiwc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Tclg3wsRB1eqyObr5oZLpg_Kh0KlF7W";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let authMode = "login";
let currentUser = null;
let currentProfile = null;

const plans = {
  Starter: 1,
  Investor: 2,
  Professional: 3
};

const demoDeals = [
  {
    id: "it-service",
    title: "IT-Dienstleister Deutschschweiz",
    meta: "Umsatz: CHF 3.2M · EBITDA positiv · Nachfolge offen",
    minPlan: "Starter"
  },
  {
    id: "b2b-services",
    title: "B2B-Services Unternehmen",
    meta: "Umsatz: CHF 2.8M · 20+ Jahre Marktpräsenz · Verkäufer offen für Übergabe",
    minPlan: "Starter"
  },
  {
    id: "industrie-zulieferer",
    title: "Industrie-Zulieferer Ostschweiz",
    meta: "Umsatz: CHF 7.5M · stabile Kundenbasis · strategischer Käufer gesucht",
    minPlan: "Investor"
  },
  {
    id: "buy-side-target",
    title: "Exklusives Buy-Side Target",
    meta: "Nur für Professional Mitglieder · individuelle Freigabe erforderlich",
    minPlan: "Professional"
  }
];

document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session?.user) {
    await handleLoggedIn(data.session.user);
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      await handleLoggedIn(session.user);
    } else {
      handleLoggedOut();
    }
  });
});

function openAuth() {
  document.getElementById("authModal").style.display = "flex";
}

function closeAuth() {
  document.getElementById("authModal").style.display = "none";
  setStatus("authStatus", "", "");
}

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById("loginTab").classList.toggle("active", mode === "login");
  document.getElementById("signupTab").classList.toggle("active", mode === "signup");
  document.getElementById("authSubmit").textContent = mode === "login" ? "Einloggen" : "Konto nach Zahlung erstellen";
  document.querySelectorAll(".signup-only").forEach(el => el.classList.toggle("hidden", mode !== "signup"));
  setStatus("authStatus", "", "");
}

async function submitAuth() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  if (!email || !password) {
    setStatus("authStatus", "Bitte E-Mail und Passwort eingeben.", "err");
    return;
  }

  setStatus("authStatus", "Wird verarbeitet...", "");

  try {
    if (authMode === "signup") {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      setStatus(
        "authStatus",
        "Account erstellt. Wichtig: Zugriff wird nur freigeschaltet, wenn diese E-Mail bereits über Stripe bezahlt hat. Falls E-Mail-Bestätigung aktiv ist, bitte Postfach prüfen.",
        "ok"
      );
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAuth();
    }
  } catch (error) {
    setStatus("authStatus", error.message || "Ein Fehler ist aufgetreten.", "err");
  }
}

async function handleLoggedIn(user) {
  currentUser = user;

  // Falls Nutzer schon bezahlt hat, aber erst danach Konto erstellt, wird hier automatisch aktiviert.
  try {
    await supabaseClient.rpc("activate_paid_membership_for_current_user");
  } catch (err) {
    console.warn("Paid membership activation check failed:", err);
  }

  const { data: profile, error } = await supabaseClient
    .from("member_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    console.warn(error);
    await supabaseClient.auth.signOut();
    openAuth();
    setStatus("authStatus", "Dein Mitgliederprofil wurde noch nicht erstellt. Bitte versuche es erneut.", "err");
    return;
  }

  currentProfile = profile;

  if (currentProfile.subscription_status !== "active") {
    await supabaseClient.auth.signOut();
    openAuth();
    setStatus(
      "authStatus",
      "Zugriff noch nicht freigeschaltet. Bitte zuerst ein Paket über Stripe kaufen und danach mit derselben E-Mail einloggen.",
      "err"
    );
    return;
  }

  document.getElementById("loginBtn").classList.add("hidden");
  document.getElementById("logoutBtn").classList.remove("hidden");
  document.getElementById("memberNavLink").classList.remove("hidden");
  document.getElementById("mitgliederbereich").style.display = "block";
  document.getElementById("memberPlanBadge").textContent = `${currentProfile.plan || "Starter"} Mitglied · Aktiv`;

  await loadProfileForm();
  renderDeals();
  renderNdaList();

  if (window.location.hash === "#mitgliederbereich") {
    document.getElementById("mitgliederbereich").scrollIntoView({ behavior: "smooth" });
  }
}

function handleLoggedOut() {
  currentUser = null;
  currentProfile = null;
  document.getElementById("loginBtn").classList.remove("hidden");
  document.getElementById("logoutBtn").classList.add("hidden");
  document.getElementById("memberNavLink").classList.add("hidden");
  document.getElementById("mitgliederbereich").style.display = "none";
}

async function logoutMember() {
  await supabaseClient.auth.signOut();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showPortalTab(tab, btn) {
  document.querySelectorAll(".portal-section").forEach(s => s.classList.remove("active"));
  document.getElementById("portal-" + tab).classList.add("active");
  document.querySelectorAll(".portal-nav button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

function canAccess(minPlan) {
  const userPlan = currentProfile?.plan || "Starter";
  return plans[userPlan] >= plans[minPlan];
}

function renderDeals() {
  const list = document.getElementById("dealList");
  list.innerHTML = "";

  demoDeals.forEach(deal => {
    const allowed = canAccess(deal.minPlan);
    const div = document.createElement("div");
    div.className = "member-deal" + (allowed ? "" : " locked");
    div.innerHTML = `
      <div>
        <h3>${deal.title}</h3>
        <small>${allowed ? deal.meta : `Nur für ${deal.minPlan} Mitglieder sichtbar`}</small>
      </div>
      ${
        allowed
          ? `<button class="btn secondary" onclick="requestNda('${deal.id}', '${deal.title}')">NDA / Details anfragen</button>`
          : `<button class="btn" onclick="openUpgradeFor('${deal.minPlan}')">Upgrade</button>`
      }
    `;
    list.appendChild(div);
  });
}

function openUpgradeFor(plan) {
  if (plan === "Investor") {
    openPayment("Investor", "CHF 249 / Monat", "https://buy.stripe.com/fZu8wO1Nnfo548f8fqdUY01");
  } else {
    openPayment("Professional", "CHF 499 / Monat", "https://buy.stripe.com/7sY8wO9fPcbT0W3gLWdUY02");
  }
}

async function requestNda(dealId, dealTitle) {
  if (!currentUser || currentProfile?.subscription_status !== "active") return openAuth();

  const { error } = await supabaseClient
    .from("nda_requests")
    .insert({
      user_id: currentUser.id,
      deal_id: dealId,
      deal_title: dealTitle,
      status: "angefragt"
    });

  if (error) {
    alert(error.message);
    return;
  }

  alert("NDA-/Detailanfrage wurde gespeichert.");
  renderNdaList();
}

async function renderNdaList() {
  const list = document.getElementById("ndaList");
  if (!currentUser) return;

  const { data, error } = await supabaseClient
    .from("nda_requests")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<li>${error.message}</li>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = "<li>Noch keine NDA-Anfragen vorhanden.</li>";
    return;
  }

  list.innerHTML = data.map(item => `<li><strong>${item.deal_title}</strong> — Status: ${item.status}</li>`).join("");
}

async function loadProfileForm() {
  if (!currentUser) return;

  const { data } = await supabaseClient
    .from("search_profiles")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (data) {
    document.getElementById("profileIndustries").value = data.industries || "";
    document.getElementById("profileRegion").value = data.region || "";
    document.getElementById("profileRevenue").value = data.revenue_range || "";
    document.getElementById("profileDealType").value = data.deal_type || "";
    document.getElementById("profileNotes").value = data.notes || "";
  }
}

async function saveProfile() {
  if (!currentUser || currentProfile?.subscription_status !== "active") return openAuth();

  const payload = {
    user_id: currentUser.id,
    industries: document.getElementById("profileIndustries").value,
    region: document.getElementById("profileRegion").value,
    revenue_range: document.getElementById("profileRevenue").value,
    deal_type: document.getElementById("profileDealType").value,
    notes: document.getElementById("profileNotes").value,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseClient
    .from("search_profiles")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    setStatus("profileStatus", error.message, "err");
  } else {
    setStatus("profileStatus", "Suchprofil gespeichert.", "ok");
  }
}

async function submitCapitalRequest() {
  if (!currentUser || currentProfile?.subscription_status !== "active") return openAuth();

  const { error } = await supabaseClient
    .from("capital_requests")
    .insert({
      user_id: currentUser.id,
      company: document.getElementById("capitalCompany").value,
      amount: document.getElementById("capitalAmount").value,
      description: document.getElementById("capitalDescription").value,
      status: "eingereicht"
    });

  if (error) {
    setStatus("capitalStatus", error.message, "err");
  } else {
    setStatus("capitalStatus", "Kapitalanfrage gespeichert.", "ok");
    document.getElementById("capitalCompany").value = "";
    document.getElementById("capitalAmount").value = "";
    document.getElementById("capitalDescription").value = "";
  }
}

function openPayment(plan, price, link) {
  document.getElementById("paymentPlan").textContent = plan + " Mitgliedschaft";
  document.getElementById("paymentPrice").textContent = price;
  document.getElementById("paymentLink").href = link;
  document.getElementById("paymentModal").style.display = "flex";
}

function closePayment() {
  document.getElementById("paymentModal").style.display = "none";
}

function setStatus(id, message, type) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = "status" + (type ? " " + type : "");
}

document.getElementById("authModal").addEventListener("click", event => {
  if (event.target.id === "authModal") closeAuth();
});

document.getElementById("paymentModal").addEventListener("click", event => {
  if (event.target.id === "paymentModal") closePayment();
});
