// Cardcom LowProfile checkout — creates a hosted payment session and sends the
// buyer to it. Credentials live in Vercel env vars, never in the repo.
//
//   CARDCOM_TERMINAL   מספר מסוף        (required)
//   CARDCOM_API_NAME   שם משתמש ל-API   (required)
//   CARDCOM_OPERATION  ChargeAndCreateDocument | ChargeOnly
//   SITE_URL           canonical https origin, e.g. https://workshops.gr8minds.co.il

import { byId } from '../workshops.js';

const CARDCOM_API = 'https://secure.cardcom.solutions/api/v11/LowProfile/Create';
const ILS = 1; // Cardcom ISOCoinId for shekel

// The catalogue is the authority on price. The page sends only a product id —
// a browser can edit data-price, so that value is never trusted or read here.
// Adding a workshop means adding an entry to workshops.js, not touching this file.

function origin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return Object.fromEntries(new URLSearchParams(b));
    }
  }
  return b;
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  const terminal = process.env.CARDCOM_TERMINAL;
  const apiName = process.env.CARDCOM_API_NAME;

  if (!terminal || !apiName) {
    return res.status(503).json({
      error: 'checkout_not_configured',
      message:
        'חסרים פרטי קארדקום. יש להגדיר CARDCOM_TERMINAL ו-CARDCOM_API_NAME ב-Vercel.',
    });
  }

  const body = readBody(req);

  // A GET (the no-JS fallback link) carries the product in the query string.
  const url = new URL(req.url, 'http://localhost');
  const productId = clean(body.product || url.searchParams.get('product'), 60);
  const product = byId(productId);

  if (!product) {
    return res.status(400).json({
      error: 'unknown_product',
      message: 'הסדנה המבוקשת לא נמצאה. רעננו את העמוד ונסו שוב.',
    });
  }

  const name = clean(body.name, 80);
  const email = clean(body.email, 120);
  const phone = clean(body.phone, 30);

  // ChargeAndCreateDocument needs a name + email to issue the invoice against.
  const canInvoice = Boolean(name && email);
  const operation =
    process.env.CARDCOM_OPERATION ||
    (canInvoice ? 'ChargeAndCreateDocument' : 'ChargeOnly');

  const base = origin(req);
  const orderId = `${productId}-${crypto.randomUUID().slice(0, 8)}`;

  const payload = {
    TerminalNumber: Number(terminal),
    ApiName: apiName,
    Operation: operation,
    Amount: product.price,
    ISOCoinId: ILS,
    Language: 'he',
    ProductName: product.invoiceName,
    ReturnValue: orderId,
    SuccessRedirectUrl: `${base}/thanks?w=${product.slug}`,
    FailedRedirectUrl: `${base}/${product.slug}?payment=failed`,
    WebHookUrl: `${base}/api/cardcom-webhook`,
  };

  if (operation === 'ChargeAndCreateDocument') {
    payload.Document = {
      DocumentTypeToCreate: 'Order',
      Name: name || 'לקוח',
      Email: email || undefined,
      Phone: phone || undefined,
      IsSendByEmail: Boolean(email),
      Products: [{ Description: product.invoiceName, UnitCost: product.price, Quantity: 1 }],
    };
  }

  let data;
  try {
    const r = await fetch(CARDCOM_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await r.json();
  } catch (err) {
    console.error('cardcom request failed', err);
    return res.status(502).json({ error: 'cardcom_unreachable' });
  }

  // v11 signals success with ResponseCode === 0.
  if (data.ResponseCode !== 0 || !data.Url) {
    console.error('cardcom rejected', data.ResponseCode, data.Description);
    return res.status(502).json({
      error: 'cardcom_error',
      code: data.ResponseCode,
      message: data.Description || 'יצירת דף התשלום נכשלה',
    });
  }

  console.log('checkout created', orderId, data.LowProfileId);

  // Browsers that followed the plain link get a redirect; the on-page modal
  // asks for JSON and redirects itself.
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (wantsJson) return res.status(200).json({ url: data.Url });
  res.writeHead(303, { Location: data.Url });
  return res.end();
}
