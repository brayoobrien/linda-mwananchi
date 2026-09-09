// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const pesapal = require('./pesapal');

const app = express();
app.use(cors()); // lock this down to your site's domain in production, see note below
app.use(express.json());

// In-memory store for demo purposes. Swap for a real database (Postgres, SQLite, etc.) in production.
const donations = new Map(); // reference -> { status, amount, phoneNumber, orderTrackingId, ... }

// Normalize Kenyan phone numbers to the 2547XXXXXXXX format Pesapal expects.
function normalizePhone(raw) {
  let p = raw.replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  return p;
}

// POST /api/donate  { amount, phoneNumber, name?, email? }
app.post('/api/donate', async (req, res) => {
  try {
    const { amount, phoneNumber, name, email } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'A valid donation amount is required.' });
    }
    if (!phoneNumber) {
      return res.status(400).json({ error: 'A phone number is required.' });
    }

    const reference = crypto.randomUUID();
    const normalizedPhone = normalizePhone(phoneNumber);

    const order = await pesapal.submitOrder({
      amount: Number(amount),
      description: 'Donation to Linda Mwananchi',
      phoneNumber: normalizedPhone,
      email,
      firstName: name || 'Donor',
      reference,
    });

    donations.set(reference, {
      status: 'PENDING',
      amount,
      phoneNumber: normalizedPhone,
      orderTrackingId: order.order_tracking_id,
    });

    // Frontend should poll GET /api/donate/status/:reference to know when the
    // STK prompt has been accepted/confirmed on the donor's phone.
    res.json({
      reference,
      orderTrackingId: order.order_tracking_id,
      redirectUrl: order.redirect_url, // fallback: some payment methods still need this page
    });
  } catch (err) {
    console.error('Donate error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not start the payment. Please try again.' });
  }
});

// GET /api/donate/status/:reference — frontend polls this
app.get('/api/donate/status/:reference', async (req, res) => {
  const record = donations.get(req.params.reference);
  if (!record) return res.status(404).json({ error: 'Unknown reference.' });

  try {
    const status = await pesapal.getTransactionStatus(record.orderTrackingId);
    // status_code: 0 = INVALID, 1 = COMPLETED, 2 = FAILED, 3 = REVERSED
    const map = { 0: 'INVALID', 1: 'COMPLETED', 2: 'FAILED', 3: 'REVERSED' };
    record.status = map[status.status_code] || 'PENDING';
    donations.set(req.params.reference, record);
    res.json({ status: record.status, raw: status });
  } catch (err) {
    console.error('Status check error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not check payment status.' });
  }
});

// GET /api/pesapal/ipn — Pesapal calls this automatically when a payment's status changes.
app.get('/api/pesapal/ipn', async (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  console.log('IPN received:', req.query);

  try {
    const status = await pesapal.getTransactionStatus(OrderTrackingId);
    const map = { 0: 'INVALID', 1: 'COMPLETED', 2: 'FAILED', 3: 'REVERSED' };
    const record = donations.get(OrderMerchantReference);
    if (record) {
      record.status = map[status.status_code] || 'PENDING';
      donations.set(OrderMerchantReference, record);
    }
    // Pesapal expects a 200 response acknowledging receipt
    res.json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId: OrderTrackingId,
      orderMerchantReference: OrderMerchantReference,
      status: 200,
    });
  } catch (err) {
    console.error('IPN handling error:', err.response?.data || err.message);
    res.status(500).end();
  }
});

app.get('/', (req, res) => res.send('Linda Mwananchi Pesapal backend is running.'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
