// Cardcom LowProfile checkout — creates a hosted payment session and sends the
// buyer to it. Credentials live in Vercel env vars, never in the repo.
//
//   CARDCOM_TERMINAL   מספר מסוף        (required)
//   CARDCOM_API_NAME   שם משתמש ל-API   (required)
//   WORKSHOP_PRICE_ILS total incl. VAT   (default 590)
//   CARDCOM_OPERATION  ChargeAndCreateDocument | ChargeOnly
//   SITE_URL           canonical https origin, e.g. https://workshop.gr8minds.co.il

const CARDCOM_API = 'https://secure.cardcom.solutions/api/v11/LowProfile/Create';

const PRODUCT = 'סדנת שלושה אייג׳נטים · 2 בספטמבר 2026';
const PRODUCT_ID = 'workshop-agents-2026-09-02';
const ILS = 1; // Cardcom ISOCoinId for shekel

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

function clean(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

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
  const name = clean(body.name, 80);
  const email = clean(body.email, 120);
  const phone = clean(body.phone, 30);

  const amount = Number(process.env.WORKSHOP_PRICE_ILS || 590);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(500).json({ error: 'bad_price' });
  }

  // ChargeAndCreateDocument needs a name + email to issue the invoice against.
  const canInvoice = Boolean(name && email);
  const operation =
    process.env.CARDCOM_OPERATION ||
    (canInvoice ? 'ChargeAndCreateDocument' : 'ChargeOnly');

  const base = origin(req);
  const orderId = `${PRODUCT_ID}-${crypto.randomUUID().slice(0, 8)}`;

  const payload = {
    TerminalNumber: Number(terminal),
    ApiName: apiName,
    Operation: operation,
    Amount: amount,
    ISOCoinId: ILS,
    Language: 'he',
    ProductName: PRODUCT,
    ReturnValue: orderId,
    SuccessRedirectUrl: `${base}/thanks.html`,
    FailedRedirectUrl: `${base}/?payment=failed`,
    WebHookUrl: `${base}/api/cardcom-webhook`,
  };

  if (operation === 'ChargeAndCreateDocument') {
    payload.Document = {
      DocumentTypeToCreate: 'Order',
      Name: name || 'לקוח',
      Email: email || undefined,
      Phone: phone || undefined,
      IsSendByEmail: Boolean(email),
      Products: [{ Description: PRODUCT, UnitCost: amount, Quantity: 1 }],
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

  // Browsers that posted a plain form (or followed a link) get a redirect;
  // the on-page modal asks for JSON and redirects itself.
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (wantsJson) return res.status(200).json({ url: data.Url });
  res.writeHead(303, { Location: data.Url });
  return res.end();
}
