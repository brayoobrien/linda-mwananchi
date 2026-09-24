# Linda Mwananchi — Paystack M-Pesa Backend

This is the backend that supports your donation form's M-Pesa payments via Paystack.
The M-Pesa STK push (the PIN prompt on the donor's phone) fires directly from Paystack's
own popup on your site — this server's job is just to **verify** that a payment really
went through, using your secret key, before you treat a donation as confirmed.

## Why you need this backend at all

Verifying a transaction requires your **Secret Key**. Secret keys can never be placed
in frontend JavaScript (anyone could view-source and steal it), so a small server has to
sit between your website and Paystack. This project is that server.

## 1. Get your Paystack keys

1. Log in to your Paystack dashboard.
2. Go to **Settings -> API Keys & Webhooks**.
3. Copy your **Test Secret Key** (for building) and **Test Public Key** (goes in `index.html`, not here).
4. Make sure **Mobile Money** is enabled under **Settings -> Preferences -> Accept payments via**.

## 2. Configure

```bash
cd paystack-backend
npm install
cp .env.example .env
```

Edit `.env` and fill in:
- `PAYSTACK_SECRET_KEY` — from step 1 (use the `sk_test_...` key while testing, `sk_live_...` when live)

## How this actually works

1. On your site, clicking "Continue to Payment" opens **Paystack's own popup** (loaded via
   `js.paystack.co/v2/inline.js` in `index.html`) — no redirect, no iframe.
2. The donor selects M-Pesa in that popup and enters their phone number. **That's** the
   moment the STK push fires to their phone.
3. Once they enter their PIN, Paystack's popup fires an `onSuccess` callback in the browser.
4. The frontend immediately calls this backend's `/api/verify-payment` with the transaction
   reference, which checks with Paystack's API that the payment is genuinely confirmed
   (never trust the frontend callback alone — always verify server-side).
5. Separately, Paystack also calls this backend's `/api/paystack/webhook` endpoint
   whenever a payment succeeds. This is more reliable than the frontend callback (e.g. if
   the donor closes the tab right after paying), so treat the webhook as your real
   source of truth for marking a donation complete.

## 3. Run locally

```bash
npm start
```

This starts the server on `http://localhost:4000`. Paystack's webhook needs a public HTTPS
URL to reach you, so for local testing use a tunnel like `ngrok http 4000` and set that
ngrok URL as your webhook URL in the Paystack dashboard while testing.

## 4. Deploy

Any Node host works — e.g. **Render**, **Railway**, or **Fly.io** all have free tiers:

1. Push this `paystack-backend` folder to a GitHub repo.
2. Create a new Web Service on Render (or similar), point it at the repo.
3. Set `PAYSTACK_SECRET_KEY` in the host's dashboard environment variables (never commit `.env` itself).
4. Once deployed, copy the live URL (e.g. `https://linda-mwananchi-api.onrender.com`) and:
   - Update `API_BASE` in `index.html`'s `<script>` (search for `YOUR-BACKEND-URL`) to match.
   - Set your webhook URL in **Settings -> API Keys & Webhooks** to
     `https://linda-mwananchi-api.onrender.com/api/paystack/webhook`.

## 5. Lock down CORS (important before going live)

In `server.js`, replace:
```js
app.use(cors());
```
with:
```js
app.use(cors({ origin: 'https://your-actual-site-domain.com' }));
```
so only your website can call this API.

## 6. Go live

1. Swap `sk_test_...` for `sk_live_...` in this backend's environment variables.
2. Swap `pk_test_...` for `pk_live_...` in `index.html`.
3. Update the webhook URL in the dashboard if it differs between test/live setups.
4. Do one small real donation yourself to confirm the whole flow before announcing it.

## Notes

- Donation records are stored in memory (`Map`) for simplicity — restart the server and history
  is lost. Swap in a real database (Postgres, SQLite, etc.) before going live so you have a
  permanent donation log.
- The webhook handler checks Paystack's signature (`x-paystack-signature`) on every request —
  never skip this check, or anyone could fake a "successful payment" call.
