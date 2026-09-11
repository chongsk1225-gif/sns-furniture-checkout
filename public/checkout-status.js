/* Post-payment pages. mode is read from <body data-mode>.
   "paid" is shown ONLY when the Worker (which confirmed the transaction with
   Authorize.Net via a signature-verified webhook) reports status === "paid".
   The customer return URL alone never marks an order paid. */
(function () {
  const mode = document.body.dataset.mode;
  const params = new URLSearchParams(location.search);
  let ref = params.get("ref") || "";
  if (!ref) {
    try {
      ref = sessionStorage.getItem("sns_last_order") || "";
    } catch (e) {
      /* ignore */
    }
  }
  const root = document.getElementById("statusRoot");
  const cents = (c) => money(c / 100);

  function summaryCard(d) {
    const items = (d.items || [])
      .map(
        (i) =>
          '<div class="summary-row"><span>' +
          esc(i.name) +
          " <small>×" +
          i.qty +
          "</small><br><small class=\"ci-sku\">" +
          esc(i.brand || "") +
          " · SKU " +
          esc(i.sku) +
          "</small></span><span>" +
          cents(i.lineTotalCents) +
          "</span></div>",
      )
      .join("");
    const card = d.card ? esc(d.card.brand) + " ending " + esc(d.card.last4) : "—";
    const fulfil =
      "We will contact you to confirm availability, delivery details, and the delivery charge before scheduling delivery. Delivery, assembly and related services are billed separately from this payment.";
    return (
      '<div class="status-card">' +
      '<div class="summary-row"><span>Order number</span><span><b>' +
      esc(d.orderNumber) +
      "</b></span></div>" +
      (d.transactionRef
        ? '<div class="summary-row"><span>Authorize.Net transaction</span><span>' +
          esc(d.transactionRef) +
          "</span></div>"
        : "") +
      (d.authCode
        ? '<div class="summary-row"><span>Authorization code</span><span>' +
          esc(d.authCode) +
          "</span></div>"
        : "") +
      '<div class="summary-row"><span>Payment method</span><span>' +
      card +
      "</span></div>" +
      '<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">' +
      items +
      '<div class="summary-row"><span>Merchandise subtotal</span><span>' +
      cents(d.subtotalCents) +
      "</span></div>" +
      '<div class="summary-row"><span>Sales tax</span><span>' +
      cents(d.taxCents) +
      "</span></div>" +
      '<div class="summary-row total"><span>Paid today</span><span>' +
      cents(d.totalCents) +
      "</span></div>" +
      '<p class="co-note">' +
      fulfil +
      "</p>" +
      '<p class="co-note">Orders remain subject to inventory and availability confirmation. If a paid item is unavailable we will contact you to arrange a cancellation and refund consistent with our <a href="returns.html">Refund &amp; Return Policy</a> and <a href="terms.html">Terms &amp; Conditions</a>.</p>' +
      "</div>"
    );
  }

  async function fetchStatus() {
    if (!ref) return null;
    try {
      const r = await fetch("/api/checkout/confirm?ref=" + encodeURIComponent(ref));
      if (r.status === 404) return { status: "not_found" };
      if (!r.ok) return { status: "error" };
      return await r.json();
    } catch (e) {
      return { status: "error" };
    }
  }

  function paidView(d) {
    try {
      SnsCart.clear();
    } catch (e) {
      /* ignore */
    }
    root.innerHTML =
      '<span class="badge ok">PAYMENT CONFIRMED</span>' +
      "<h1>Thank you — your order is confirmed</h1>" +
      "<p>A confirmation has been sent to your email. Please keep your order number for reference.</p>" +
      summaryCard(d) +
      '<p><a class="btn dark" href="catalog.html">CONTINUE SHOPPING</a></p>';
  }

  function pendingView() {
    root.innerHTML =
      '<div class="spinner"></div>' +
      "<h1>Confirming your payment…</h1>" +
      "<p>This can take a few moments." +
      (ref ? " Your order number is <b>" + esc(ref) + "</b>." : "") +
      " You will receive a confirmation email once the payment settles. You can safely close this page.</p>" +
      '<p><a class="btn" href="index.html">RETURN HOME</a></p>';
  }

  function declinedView(d) {
    root.innerHTML =
      '<span class="badge bad">PAYMENT NOT COMPLETED</span>' +
      "<h1>Your payment was not completed</h1>" +
      "<p>No charge was made" +
      (d && d.orderNumber ? " for order <b>" + esc(d.orderNumber) + "</b>" : "") +
      ". Your cart has been kept so you can try again.</p>" +
      '<p><a class="btn dark" href="checkout.html">RETURN TO CHECKOUT</a> <a class="btn" href="cart.html">VIEW CART</a></p>' +
      '<p class="co-note">Need help? Text or call (424) 310-6199 or email info@snsfurniture.com.</p>';
  }

  function canceledView() {
    root.innerHTML =
      '<span class="badge warn">CHECKOUT CANCELED</span>' +
      "<h1>Checkout canceled</h1>" +
      "<p>You canceled before payment was completed and no charge was made. Your cart has been kept.</p>" +
      '<p><a class="btn dark" href="cart.html">RETURN TO CART</a> <a class="btn" href="catalog.html">CONTINUE SHOPPING</a></p>';
  }

  function notFoundView() {
    root.innerHTML =
      "<h1>Order not found</h1>" +
      "<p>We couldn't find that order. If you just paid, please check your email for confirmation or contact us at (424) 310-6199.</p>" +
      '<p><a class="btn" href="index.html">RETURN HOME</a></p>';
  }

  async function runApproved() {
    pendingView();
    let tries = 0;
    const tick = async () => {
      tries++;
      const d = await fetchStatus();
      if (d && d.status === "paid")
        return location.replace(
          "order-confirmation.html?ref=" + encodeURIComponent(d.orderNumber),
        );
      if (d && d.status === "failed")
        return location.replace(
          "checkout-declined.html?ref=" + encodeURIComponent(ref),
        );
      if (d && d.status === "canceled") return canceledView();
      if (tries >= 10) return pendingView();
      setTimeout(tick, 2000);
    };
    tick();
  }

  async function runConfirmation() {
    root.innerHTML = '<div class="spinner"></div><h1>Loading your order…</h1>';
    let tries = 0;
    const tick = async () => {
      tries++;
      const d = await fetchStatus();
      if (!d) return notFoundView();
      if (d.status === "paid") return paidView(d);
      if (d.status === "failed") return declinedView(d);
      if (d.status === "canceled") return canceledView();
      if (d.status === "not_found") return notFoundView();
      if (tries >= 8) return pendingView();
      setTimeout(tick, 2500);
    };
    tick();
  }

  async function runDeclined() {
    declinedView((await fetchStatus()) || {});
  }

  async function runCancel() {
    if (ref) {
      try {
        await fetch("/api/checkout/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ref }),
        });
      } catch (e) {
        /* best effort */
      }
    }
    canceledView();
  }

  ({
    approved: runApproved,
    confirmation: runConfirmation,
    declined: runDeclined,
    cancel: runCancel,
  }[mode] || runConfirmation)();
})();
