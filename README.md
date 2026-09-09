# Linda Mwananchi — Pesapal STK Push Backend

This is the backend that lets your donation form send an M-Pesa **STK push** (a PIN prompt
that pops up on the donor's phone) via Pesapal, instead of asking donors to manually dial
a Till Number.

## Why you need this backend at all

Pesapal's API requires a **Consumer Secret** to authenticate. Secrets can never be placed
in frontend JavaScript (anyone could view-source and steal it), so a small server has to
sit between your website and Pesapal. This project is that server.

## 1. Get Pesapal credentials

1. Sign up at https://www.pesapal.com (or use the sandbox at https://developer.pesapal.com for testing).
2. In your merchant dashboard, go to **API Keys** and copy your **Consumer Key** and **Consumer Secret**.

## 2. Configure

```bash
cd pesapal-backend
npm install
cp .env.example .env
```

Edit `.env` and fill in:
- `PESAPAL_CONSUMER_KEY` / `PESAPAL_CONSUMER_SECRET` — from step 1
- `PESAPAL_ENV` — `sandbox` while testing, `live` when you go live
- `BACKEND_PUBLIC_URL` — the URL this server will be reachable at once deployed (Pesapal
  needs to call it back for IPN notifications)
- `FRONTEND_RETURN_URL` — where to send the donor after payment (e.g. a thank-you page on your site)

## How this actually works (important!)

Pesapal's e-commerce API does **not** fire an STK push directly from your server the moment
you submit an order — that's how Safaricom's own Daraja API works, but not Pesapal's. Instead:

1. Your backend calls `SubmitOrderRequest`, which returns a `redirect_url`.
2. The donor is shown that URL (embedded in an iframe on your site) — it's Pesapal's own
   hosted payment page.
3. The donor selects **M-Pesa** as their payment method *on that page*.
4. **That's** the moment Pesapal actually sends the STK push to their phone.
5. Your backend polls `GetTransactionStatus` (or waits for the IPN callback) to know when
   it's done.

So donors do briefly see a Pesapal-branded payment screen inside the iframe — there's no way
to skip straight from your own form to a phone buzzing, since Pesapal (not you) controls the
final "send STK push" step.

## Testing in sandbox

Pesapal's sandbox does **not** use a fixed test phone number like Safaricom's Daraja sandbox
does (e.g. `254708374149`). Instead, on the hosted payment page (the iframe), after choosing
a payment method, look for a link/text near the payment fields that says something like
"generate dummy codes" — clicking it fills in test values so you can simulate a successful
(or failed) payment without needing a real phone or moving real money.



```bash
npm start
```

This starts the server on `http://localhost:4000`. Note: Pesapal's IPN callback needs a
public HTTPS URL to reach you, so for local testing use a tunnel like `ngrok http 4000`
and put that ngrok URL in `BACKEND_PUBLIC_URL`.

## 4. Deploy

Any Node host works — e.g. **Render**, **Railway**, or **Fly.io** all have free tiers:

1. Push this `pesapal-backend` folder to a GitHub repo.
2. Create a new Web Service on Render (or similar), point it at the repo.
3. Set the environment variables from `.env` in the host's dashboard (never commit `.env` itself).
4. Once deployed, copy the live URL (e.g. `https://linda-mwananchi-api.onrender.com`) and:
   - Update `BACKEND_PUBLIC_URL` in the backend's environment variables to match.
   - Update `API_BASE` in `index.html`'s `<script>` (search for `YOUR-BACKEND-URL`) to match.

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

## 6. Test end-to-end

1. Open your site, click Donate, fill in a **real Safaricom number** (sandbox uses test numbers
   — Pesapal's docs list these), and an amount.
2. You should get a prompt on the phone within a few seconds.
3. The frontend polls `/api/donate/status/:reference` every 6 seconds until it's `COMPLETED`.

## Notes

- Donation records are stored in memory (`Map`) for simplicity — restart the server and history
  is lost. Swap in a real database (Postgres, SQLite, etc.) before going live so you have a
  permanent donation log.
- Add your own logging/alerting on the `/api/pesapal/ipn` endpoint — that's Pesapal's source of
  truth for payment status and should ideally be what marks a donation "complete" in your database,
  not just the frontend poll.
