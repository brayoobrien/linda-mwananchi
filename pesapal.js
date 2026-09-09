// pesapal.js
// Thin wrapper around Pesapal API v3 (OAuth token, IPN registration, order submission, status check).
require('dotenv').config();
const axios = require('axios');

const BASE_URL =
  process.env.PESAPAL_ENV === 'live'
    ? 'https://pay.pesapal.com/v3'
    : 'https://cybqa.pesapal.com/pesapalv3'; // sandbox

let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedIpnId = null;

// 1. Get an OAuth bearer token (valid ~5 min, so we cache and refresh as needed)
async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) return cachedToken;

  const res = await axios.post(`${BASE_URL}/api/Auth/RequestToken`, {
    consumer_key: process.env.PESAPAL_CONSUMER_KEY,
    consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
  }, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  cachedToken = res.data.token;
  // Refresh a little early to be safe (token lasts ~5 minutes)
  cachedTokenExpiry = now + 4 * 60 * 1000;
  return cachedToken;
}

// 2. Register an IPN (Instant Payment Notification) URL — Pesapal calls this when payment status changes.
//    You only need to do this once per URL, but it's cheap to re-register and cache the id.
async function getIpnId() {
  if (cachedIpnId) return cachedIpnId;

  const token = await getToken();
  const res = await axios.post(
    `${BASE_URL}/api/URLSetup/RegisterIPN`,
    {
      url: `${process.env.BACKEND_PUBLIC_URL}/api/pesapal/ipn`,
      ipn_notification_type: 'GET',
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } }
  );

  cachedIpnId = res.data.ipn_id;
  return cachedIpnId;
}

// 3. Submit an order. Including a phone_number in billing_address is what triggers
//    the STK-style prompt on the donor's phone for M-Pesa (Pesapal calls this "Direct" mobile payment).
async function submitOrder({ amount, currency = 'KES', description, phoneNumber, email, firstName, lastName, reference }) {
  const token = await getToken();
  const ipnId = await getIpnId();

  const payload = {
    id: reference, // must be unique per transaction
    currency,
    amount,
    description,
    callback_url: process.env.FRONTEND_RETURN_URL,
    notification_id: ipnId,
    billing_address: {
      email_address: email || 'donor@example.com',
      phone_number: phoneNumber, // e.g. 2547XXXXXXXX
      first_name: firstName || 'Donor',
      last_name: lastName || '',
      country_code: 'KE',
    },
  };

  const res = await axios.post(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  return res.data; // contains order_tracking_id, redirect_url, merchant_reference
}

// 4. Check transaction status (poll this after submitting, or from your IPN handler)
async function getTransactionStatus(orderTrackingId) {
  const token = await getToken();
  const res = await axios.get(`${BASE_URL}/api/Transactions/GetTransactionStatus`, {
    params: { orderTrackingId },
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.data;
}

module.exports = { getToken, getIpnId, submitOrder, getTransactionStatus };
