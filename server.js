// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(cors()); // lock this down to your site's domain in production

// In-memory store for demo purposes. Swap for a real database (Postgres, SQLite, etc.) in production.
const donations = new Map(); // reference -> { status, amount, email, ... }

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// The webhook route needs the RAW request body to verify Paystack's signature,
// so it must be registered BEFORE express.json() runs on it.
app.post(
  '/api/paystack/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    try {
      const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(req.body)
        .digest('hex');

      if (hash !== req.headers['x-paystack-signature']) {
        console.warn('Webhook signature mismatch — ignoring request.');
        return res.sendStatus(401);
      }

      const event = JSON.parse(req.body.toString('utf8'));

      if (event.event === 'charge.success') {
        const { reference, amount, customer, status } = event.data;
        donations.set(reference, {
          status: status === 'success' ? 'COMPLETED' : 'FAILED',
          amount: amount / 100, // convert back from kobo/cents to KES
          email: customer.email,
        });
        console.log(`Donation ${reference} confirmed via webhook.`);
        // TODO: send a thank-you email / update your own database here
      }

      res.sendStatus(200);
    } catch (err) {
      console.error('Webhook handling error:', err.message);
      res.sendStatus(500);
    }
  }
);

// All routes below this line can safely parse JSON as usual.
app.use(express.json());

// POST /api/verify-payment  { reference }
// Called by the frontend right after Paystack's popup reports success.
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ error: 'A transaction reference is required.' });
    }

    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      }
    );

    const { status, amount, customer } = response.data.data;
    const success = status === 'success';

    donations.set(reference, {
      status: success ? 'COMPLETED' : 'FAILED',
      amount: amount / 100,
      email: customer.email,
    });

    res.json({ success });
  } catch (err) {
    console.error('Verify error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not verify the payment. Please try again.' });
  }
});

// GET /api/donate/status/:reference — optional, useful if you want to check status later
app.get('/api/donate/status/:reference', (req, res) => {
  const record = donations.get(req.params.reference);
  if (!record) return res.status(404).json({ error: 'Unknown reference.' });
  res.json(record);
});

app.get('/', (req, res) => res.send('Linda Mwananchi Paystack backend is running.'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
