/* Checkout page controller — delivery only, California delivery addresses only.
   - No card data is handled here: on success the browser is POSTed to the
     Authorize.Net hosted payment page with a one-time token.
   - All amounts shown are advisory; the Worker recomputes subtotal + tax from
     the delivery address and will not issue a token if tax is unavailable.
   - No delivery charge is collected in this checkout. */
(function () {
  const form = document.getElementById("checkoutForm");
  const errEl = document.getElementById("coError");
  const payBtn = document.getElementById("payBtn");
  let csrf = null;
  let catalog = null;
  let lines = [];
  let taxState = null;
  let busy = false;

  const cents = (c) => money(c / 100);
  const FULFILLMENT = "delivery";

  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.add("show");
    errEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function clearError() {
    errEl.textContent = "";
    errEl.classList.remove("show");
  }

  const ERR = {
    tax_unavailable:
      "Sales tax can't be calculated for this delivery address right now, so online checkout is unavailable. Please call (424) 310-6199 and we'll help you complete your order.",
    address_unverifiable:
      "We couldn't verify that delivery address. Please double-check the street, city and ZIP, or call (424) 310-6199.",
    ca_delivery_only:
      "Online checkout is currently available for California delivery addresses only. Please call (424) 310-6199 for deliveries outside California.",
    policies_not_accepted:
      "Please accept the Terms & Conditions and the Refund & Return Policy to continue.",
    rate_limited: "Too many attempts. Please wait a minute and try again.",
    invalid_sku:
      "One of the items in your cart is no longer available. Please review your cart.",
    cart_empty: "Your cart is empty.",
    cart_total_out_of_range: "This order total is outside the range we can accept online.",
    origin_not_allowed: "Your session could not be verified. Please reload the page.",
    csrf_failed: "Your session expired. Please reload the page and try again.",
    payment_init_failed:
      "We couldn't start the payment session. Please try again in a moment.",
    server_error: "Something went wrong on our side. Please try again.",
  };
  function messageFor(data) {
    if (data && data.error === "invalid_field")
      return 'Please check the "' + (data.field || "form") + '" field.';
    return (data && ERR[data.error]) || "Something went wrong. Please try again.";
  }

  async function api(path, opts) {
    const res = await fetch("/api/checkout/" + path, opts || {});
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* ignore */
    }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  const readCartLines = () => SnsCart.lines().map((l) => ({ sku: l.sku, qty: l.qty }));
  const deliveryPayload = () => ({
    line1: form.line1.value.trim(),
    line2: form.line2.value.trim(),
    city: form.city.value.trim(),
    state: form.state.value.trim(),
    zip: form.zip.value.trim(),
    country: form.country.value.trim() || "United States",
  });
  const zipReady = () => /^\d{5}(-\d{4})?$/.test(form.zip.value.trim());

  async function renderSummary() {
    catalog = catalog || (await loadCatalog());
    document.getElementById("coLines").innerHTML = lines
      .map((l) => {
        const p = catalog.find((x) => x.sku === l.sku);
        const name = p ? p.name : l.sku;
        const price = p && p.sale != null ? money(p.sale) : "—";
        return (
          '<div class="summary-row"><span>' +
          esc(name) +
          " <small>×" +
          l.qty +
          "</small></span><span>" +
          price +
          "</span></div>"
        );
      })
      .join("");
  }

  function setTaxIdle(message) {
    taxState = null;
    document.getElementById("coTax").textContent = message || "Enter delivery ZIP";
    document.getElementById("coTotal").textContent = "—";
    document.getElementById("coTaxRate").textContent = "";
    payBtn.disabled = true;
  }

  async function refreshTax() {
    if (!csrf) return;
    if (!zipReady()) {
      setTaxIdle("Enter delivery ZIP");
      clearError();
      return;
    }
    const r = await api("tax-quote", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({
        lines: readCartLines(),
        fulfillment: FULFILLMENT,
        delivery: deliveryPayload(),
      }),
    });
    if (r.ok) {
      taxState = r.data;
      document.getElementById("coSubtotal").textContent = cents(r.data.subtotalCents);
      document.getElementById("coTax").textContent = cents(r.data.taxCents);
      document.getElementById("coTotal").textContent = cents(r.data.totalCents);
      document.getElementById("coTaxRate").textContent =
        r.data.taxRate != null
          ? "(" + (r.data.taxRate * 100).toFixed(3).replace(/\.?0+$/, "") + "%)"
          : "";
      payBtn.disabled = false;
      clearError();
    } else {
      taxState = null;
      document.getElementById("coTax").textContent = "Unavailable";
      document.getElementById("coTotal").textContent = "—";
      payBtn.disabled = true;
      showError(messageFor(r.data));
    }
  }

  form.addEventListener("change", (e) => {
    if (["dZip", "dState"].includes(e.target.id)) refreshTax();
  });
  form.addEventListener("input", (e) => {
    if (e.target.id === "dZip") refreshTax();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    clearError();

    const required = ["name", "email", "phone", "line1", "city", "zip"];
    if (required.some((n) => !form[n].value.trim())) {
      return showError("Please complete all required contact and delivery fields.");
    }
    if (form.state.value.trim().toUpperCase() !== "CA") {
      return showError(ERR.ca_delivery_only);
    }
    if (
      !document.getElementById("okTerms").checked ||
      !document.getElementById("okRefund").checked
    ) {
      return showError(ERR.policies_not_accepted);
    }
    if (!taxState) {
      await refreshTax();
      if (!taxState) return;
    }

    busy = true;
    payBtn.disabled = true;
    payBtn.textContent = "STARTING SECURE PAYMENT…";

    const r = await api("create-token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({
        lines: readCartLines(),
        customer: {
          name: form.name.value.trim(),
          email: form.email.value.trim(),
          phone: form.phone.value.trim(),
        },
        delivery: deliveryPayload(),
        fulfillment: FULFILLMENT,
        acceptTerms: document.getElementById("okTerms").checked,
        acceptRefundPolicy: document.getElementById("okRefund").checked,
      }),
    });

    if (!r.ok || !r.data.token) {
      busy = false;
      payBtn.disabled = false;
      payBtn.textContent = "CONTINUE TO PAYMENT";
      return showError(messageFor(r.data));
    }

    try {
      sessionStorage.setItem("sns_last_order", r.data.orderNumber);
    } catch (e) {
      /* ignore */
    }

    const f = document.createElement("form");
    f.method = "POST";
    f.action = r.data.hostedPaymentUrl;
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = "token";
    i.value = r.data.token;
    f.appendChild(i);
    document.body.appendChild(f);
    f.submit();
  });

  (async function init() {
    lines = readCartLines();
    if (!lines.length) {
      location.replace("cart.html");
      return;
    }
    try {
      await renderSummary();
      const s = await api("session", { method: "GET" });
      csrf = s.data.csrfToken || null;
      if (!csrf) {
        showError("Your checkout session could not be started. Please reload the page.");
        return;
      }
      setTaxIdle("Enter delivery ZIP");
    } catch (e) {
      showError("Checkout could not be loaded. Please reload the page.");
    }
  })();
})();
