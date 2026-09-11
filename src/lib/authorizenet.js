/**
 * Authorize.Net Accept Hosted integration (server-side only).
 *
 *  • getHostedPaymentPageToken  — creates the hosted-form token (card data is
 *    entered on Authorize.Net's page, never on snsfurniture.com).
 *  • getTransactionDetails      — authoritative server-side confirmation.
 *  • verifyWebhookSignature     — HMAC-SHA512 check with the Signature Key.
 *
 * Credentials come only from env secrets and are never logged or returned.
 */
import { hmac, hexToBytes, bytesToHex, timingSafeEqual } from "./security.js";

export function anetEnvironment(env) {
  return String(env.AUTHORIZE_NET_ENVIRONMENT || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

export function hostedPaymentFormUrl(env) {
  return anetEnvironment(env) === "production"
    ? "https://accept.authorize.net/payment/payment"
    : "https://test.authorize.net/payment/payment";
}

function apiEndpoint(env) {
  return anetEnvironment(env) === "production"
    ? "https://api.authorize.net/xml/v1/request.api"
    : "https://apitest.authorize.net/xml/v1/request.api";
}

function merchantAuth(env) {
  const name = env.AUTHORIZE_NET_API_LOGIN_ID;
  const transactionKey = env.AUTHORIZE_NET_TRANSACTION_KEY;
  if (!name || !transactionKey) {
    throw new Error("Authorize.Net API credentials are not configured");
  }
  return { name, transactionKey };
}

async function callApi(env, payload) {
  const res = await fetch(apiEndpoint(env), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  // Authorize.Net JSON responses are prefixed with a UTF-8 BOM.
  const clean = text.replace(/^﻿/, "").trim();
  let data;
  try {
    data = JSON.parse(clean);
  } catch {
    throw new Error(`Authorize.Net returned a non-JSON response (${res.status})`);
  }
  return data;
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

function truncate(value, max) {
  return String(value ?? "").slice(0, max);
}

/**
 * @returns {Promise<{token:string}>}
 */
export async function getHostedPaymentPageToken(env, opts) {
  const { orderNumber, amountCents, items, customerEmail, returnUrl, cancelUrl } = opts;

  const lineItem = items.slice(0, 30).map((it) => ({
    itemId: truncate(it.sku, 31),
    name: truncate(it.name || it.sku, 31),
    description: truncate(`${it.brand ? it.brand + " · " : ""}${it.name || ""}`, 255),
    quantity: String(it.qty),
    unitPrice: money(it.unitPriceCents),
  }));

  const settings = [
    {
      settingName: "hostedPaymentReturnOptions",
      settingValue: JSON.stringify({
        showReceipt: false,
        url: returnUrl,
        urlText: "Return to Sash & Shade",
        cancelUrl,
        cancelUrlText: "Cancel and return",
      }),
    },
    {
      settingName: "hostedPaymentButtonOptions",
      settingValue: JSON.stringify({ text: "Pay merchandise + tax" }),
    },
    {
      settingName: "hostedPaymentOrderOptions",
      settingValue: JSON.stringify({ show: true, merchantName: "Sash & Shade" }),
    },
    {
      settingName: "hostedPaymentPaymentOptions",
      settingValue: JSON.stringify({
        cardCodeRequired: true,
        showCreditCard: true,
        showBankAccount: false,
      }),
    },
    {
      // Accept Hosted collects the cardholder's BILLING address + billing ZIP on
      // Authorize.Net's page, for AVS. It is NOT prefilled from the delivery
      // address and may legitimately differ from it.
      settingName: "hostedPaymentBillingAddressOptions",
      settingValue: JSON.stringify({ show: true, required: true }),
    },
    {
      settingName: "hostedPaymentCustomerOptions",
      settingValue: JSON.stringify({ showEmail: false, requiredEmail: false }),
    },
    {
      settingName: "hostedPaymentSecurityOptions",
      settingValue: JSON.stringify({ captcha: false }),
    },
  ];

  const payload = {
    getHostedPaymentPageRequest: {
      merchantAuthentication: merchantAuth(env),
      refId: truncate(orderNumber, 20),
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: money(amountCents),
        currencyCode: "USD",
        order: {
          invoiceNumber: truncate(orderNumber, 20),
          description: truncate("Sash & Shade merchandise + applicable sales tax", 255),
        },
        lineItems: { lineItem },
        customer: customerEmail ? { email: truncate(customerEmail, 255) } : undefined,
        // No billTo: the billing address is entered by the customer on the
        // Authorize.Net hosted page (see hostedPaymentBillingAddressOptions).
      },
      hostedPaymentSettings: { setting: settings },
    },
  };

  const data = await callApi(env, payload);
  const ok = data?.messages?.resultCode === "Ok" && data?.token;
  if (!ok) {
    const msg = data?.messages?.message?.[0];
    throw new Error(
      `Authorize.Net token request failed: ${msg?.code || "?"} ${msg?.text || "unknown error"}`,
    );
  }
  return { token: data.token };
}

/**
 * @returns {Promise<null | {
 *   transId:string, invoiceNumber:string, responseCode:number,
 *   transactionStatus:string, authCode:string, settleAmountCents:number,
 *   cardBrand:string, cardLast4:string
 * }>}
 */
export async function getTransactionDetails(env, transId) {
  if (!/^\d{1,20}$/.test(String(transId || ""))) {
    throw new Error("invalid transId");
  }
  const data = await callApi(env, {
    getTransactionDetailsRequest: {
      merchantAuthentication: merchantAuth(env),
      transId: String(transId),
    },
  });
  if (data?.messages?.resultCode !== "Ok" || !data?.transaction) return null;
  const t = data.transaction;
  const masked = t?.payment?.creditCard?.cardNumber || "";
  const amount = Number(t.settleAmount ?? t.authAmount ?? 0);
  return {
    transId: String(t.transId),
    invoiceNumber: String(t.order?.invoiceNumber || ""),
    responseCode: Number(t.responseCode),
    transactionStatus: String(t.transactionStatus || ""),
    authCode: String(t.authCode || ""),
    settleAmountCents: Math.round(amount * 100),
    cardBrand: String(t?.payment?.creditCard?.cardType || ""),
    cardLast4: masked.replace(/[^0-9]/g, "").slice(-4),
  };
}

const APPROVED_STATUSES = new Set([
  "authorizedPendingCapture",
  "capturedPendingSettlement",
  "settledSuccessfully",
  "approvedReview",
]);

export function isApproved(details) {
  return (
    !!details &&
    details.responseCode === 1 &&
    APPROVED_STATUSES.has(details.transactionStatus)
  );
}

/**
 * Verify an Authorize.Net webhook. Header form: "X-ANET-Signature: sha512=<HEX>".
 * The Signature Key (hex) is decoded to bytes before the HMAC, per Authorize.Net.
 */
export async function verifyWebhookSignature(signatureKeyHex, rawBody, headerValue) {
  if (!signatureKeyHex || !headerValue) return false;
  const m = /sha512=([0-9a-fA-F]+)/.exec(headerValue);
  if (!m) return false;
  let keyBytes;
  try {
    keyBytes = hexToBytes(signatureKeyHex);
  } catch {
    return false;
  }
  const digest = bytesToHex(await hmac(keyBytes, rawBody, "SHA-512"));
  return timingSafeEqual(digest.toLowerCase(), m[1].toLowerCase());
}
