// === Config côté front ===
const API_BASE = "https://server-links-1003174971455.europe-west1.run.app"; // ton Cloud Run
const RETURN_URL = (() => {
  const base =
    window.location.origin +
    window.location.pathname.replace(/pay\.html$/i, "");
  // on redirige vers success.html (dans le même dossier)
  return `${base}success.html`;
})();

let stripe, elements;

const qs = new URLSearchParams(window.location.search);
const CUSTOMER_ID = qs.get("customer_id"); // ex: cus_...
const PRICE_ID = qs.get("price_id"); // ex: price_...
const QTY = parseInt(qs.get("quantity") || "1", 10);

const $ = (sel) => document.querySelector(sel);
const msg = (t) => {
  $("#messages").textContent = t || "";
};

// Petit helper requêtes
async function getJSON(url) {
  const r = await fetch(url, { credentials: "omit" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

async function boot() {
  try {
    if (!CUSTOMER_ID) {
      msg("Paramètre manquant : customer_id");
      throw new Error(
        "customer_id manquant dans l’URL (ex: ?customer_id=cus_...&price_id=price_...)"
      );
    }

    // 1) Clé publique Stripe
    const { publishableKey } = await getJSON(`${API_BASE}/config`);
    if (!publishableKey) throw new Error("Clé publique introuvable");

    stripe = Stripe(publishableKey, { locale: "fr" });

    // 2) Data client (pour afficher contrat, prénom, etc.)
    const cdata = await getJSON(
      `${API_BASE}/customer-data/${encodeURIComponent(CUSTOMER_ID)}`
    );

    // Choix du price : param URL prioritaire, sinon metadata.price_id
    const priceId = PRICE_ID || cdata.price_id;
    if (!priceId) {
      msg(
        "Impossible de déterminer le price_id (ni dans l’URL ni dans les métadonnées)."
      );
      throw new Error("price_id manquant");
    }

    // Contrat
    const contractUrl = cdata.contractUrl || null;
    const prenom = cdata.prenom || "Client";
    $("#title").textContent = `Paiement d’abonnement — ${prenom}`;
    const $clink = $("#contract-link");
    if (contractUrl) {
      $clink.href = contractUrl;
    } else {
      $clink.removeAttribute("href");
      $clink.textContent = "contrat indisponible";
    }
    $("#customer-line").textContent = `Client : ${
      cdata.email || CUSTOMER_ID
    } — Durée : ${cdata.time_contract || "—"}`;

    // 3) Créer la subscription (incomplete) et récupérer client_secret
    const { clientSecret, subscriptionId } = await postJSON(
      `${API_BASE}/subscription/create`,
      {
        customerId: CUSTOMER_ID,
        priceId,
        quantity: isNaN(QTY) ? 1 : QTY,
      }
    );

    // 4) Initialiser Elements avec le clientSecret
    const appearance = { theme: "stripe" }; // simple, propre
    elements = stripe.elements({ clientSecret, appearance });

    const paymentElement = elements.create("payment");
    paymentElement.mount("#payment-element");

    // 5) Soumission
    $("#payment-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      msg("");

      // case à cocher obligatoire
      if (!$("#accept").checked) {
        msg("Vous devez accepter le contrat pour continuer.");
        return;
      }

      $("#submit").disabled = true;
      $("#spinner").classList.remove("hidden");

      // 3DS/redirect si nécessaire
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${RETURN_URL}?subscription_id=${encodeURIComponent(
            subscriptionId
          )}&customer_id=${encodeURIComponent(CUSTOMER_ID)}`,
        },
      });

      if (error) {
        msg(error.message || "Échec de la confirmation du paiement.");
        $("#submit").disabled = false;
        $("#spinner").classList.add("hidden");
      } else {
        // redirection en cours par Stripe si besoin (sinon webhook confirmera)
      }
    });
  } catch (e) {
    console.error(e);
    if (!$("#messages").textContent) msg(e.message || "Erreur de chargement.");
    $("#submit") && ($("#submit").disabled = true);
  }
}

document.addEventListener("DOMContentLoaded", boot);
