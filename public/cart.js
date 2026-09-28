/* Cart page controller. Uses SnsCart + loadCatalog() + money() from site.js.
   Display only — the server revalidates every SKU, price and quantity at checkout. */
(function () {
  const root = document.getElementById("cartRoot");
  const SHIPPING_DOLLARS = 150; // flat delivery fee, display only — the Worker is the authority
  let catalog = null;

  async function ensureCatalog() {
    if (catalog) return catalog;
    catalog = await loadCatalog();
    return catalog;
  }

  function bySku(sku) {
    return (catalog || []).find((p) => p.sku === sku) || null;
  }

  async function render() {
    const lines = SnsCart.lines();
    if (!lines.length) {
      root.innerHTML =
        '<div class="cart-empty"><h2>Your cart is empty</h2>' +
        "<p>Browse the catalog and add furniture to get started.</p>" +
        '<p><a class="btn dark" href="catalog.html">BROWSE FURNITURE</a></p></div>';
      return;
    }

    let cat;
    try {
      cat = await ensureCatalog();
    } catch (e) {
      root.innerHTML =
        '<div class="cart-empty"><p class="catalog-error">Cart data could not be loaded. Please refresh.</p></div>';
      return;
    }

    let subtotal = 0;
    let priceable = 0;
    const rows = lines
      .map((l) => {
        const p = bySku(l.sku);
        if (!p || p.sale == null) {
          return (
            '<tr><td colspan="4"><div class="ci-name">' +
            esc(l.sku) +
            "</div><div class=\"ci-sku\">This item is no longer available online.</div>" +
            '<button class="link-btn" data-remove="' +
            esc(l.sku) +
            '">Remove</button></td></tr>'
          );
        }
        const line = p.sale * l.qty;
        subtotal += line;
        priceable += l.qty;
        return (
          "<tr>" +
          '<td><div class="ci-name">' +
          esc(p.name) +
          "</div>" +
          '<div class="ci-sku">' +
          esc(p.brand || "Furniture of America") +
          " · SKU " +
          esc(p.sku) +
          "</div>" +
          '<button class="link-btn" data-remove="' +
          esc(p.sku) +
          '">Remove</button></td>' +
          '<td class="ci-num ci-hide-sm">' +
          money(p.sale) +
          "</td>" +
          '<td class="ci-num"><input class="qty-input" type="number" min="1" max="25" value="' +
          l.qty +
          '" data-qty="' +
          esc(p.sku) +
          '" aria-label="Quantity for ' +
          esc(p.name) +
          '"></td>' +
          '<td class="ci-num">' +
          money(line) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    root.innerHTML =
      '<div class="cart-layout"><div><table class="cart-lines"><thead><tr>' +
      "<th>Item</th><th class=\"ci-num ci-hide-sm\">Unit price</th><th class=\"ci-num\">Qty</th><th class=\"ci-num\">Subtotal</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      '<p style="margin-top:16px"><a href="catalog.html">← Continue shopping</a></p></div>' +
      '<aside class="summary-box"><h2>ORDER SUMMARY</h2>' +
      '<div class="summary-row"><span>Merchandise subtotal</span><span>' +
      money(subtotal) +
      "</span></div>" +
      '<div class="summary-row"><span>Sales tax</span><span>Calculated at checkout</span></div>' +
      '<div class="summary-row"><span>Delivery (flat fee)</span><span>' +
      money(SHIPPING_DOLLARS) +
      "</span></div>" +
      '<div class="summary-row total"><span>Estimated today</span><span>' +
      money(subtotal + SHIPPING_DOLLARS) +
      " + tax</span></div>" +
      (priceable
        ? '<a class="btn dark" href="checkout.html">PROCEED TO CHECKOUT</a>'
        : "") +
      '<p class="muted">Online payment covers merchandise, applicable sales tax, and a flat $150 delivery fee. Checkout is available for California delivery addresses only. Orders remain subject to inventory and availability confirmation.</p>' +
      "</aside></div>";
  }

  root.addEventListener("change", (e) => {
    const qtyEl = e.target.closest("[data-qty]");
    if (qtyEl) {
      SnsCart.setQty(qtyEl.dataset.qty, parseInt(qtyEl.value, 10) || 0);
      render();
    }
  });
  root.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      SnsCart.remove(rm.dataset.remove);
      render();
    }
  });
  document.addEventListener("cart:change", render);

  render();
})();
