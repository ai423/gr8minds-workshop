// Cardcom payment notification. Cardcom POSTs here after a transaction ends.
//
// The webhook body is public-facing input, so we never trust it on its own —
// we take the LowProfileId from it and re-ask Cardcom what actually happened.
// Only a payment Cardcom itself confirms is forwarded to the registration
// sheet, so nobody can add themselves to the list by POSTing here.
//
//   SHEET_WEBHOOK_URL     Apps Script web-app URL that records the registration
//   SHEET_WEBHOOK_TOKEN   shared secret it checks before accepting a row

import { byId } from '../workshops.js';

const VERIFY_API = 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult';

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

// checkout.js builds ReturnValue as `<productId>-<8 hex>`.
const productIdFrom = (returnValue) =>
  String(returnValue || '').replace(/-[0-9a-f]{8}$/i, '');

// Cardcom reports the buyer's details in more than one shape depending on the
// operation, so read whichever arrived rather than assuming one.
function buyerFrom(result) {
  const doc = result.DocumentInfo || {};
  const ui = result.UIValues || {};
  return {
    name: doc.Name || ui.CardOwnerName || '',
    email: doc.Email || ui.CardOwnerEmail || '',
    phone: doc.Phone || ui.CardOwnerPhone || '',
  };
}

async function recordRegistration(result) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url) return; // not configured yet: payment still succeeded

  const workshop = byId(productIdFrom(result.ReturnValue));
  const buyer = buyerFrom(result);

  const row = {
    token: process.env.SHEET_WEBHOOK_TOKEN || '',
    orderId: result.ReturnValue || '',
    transactionId: result.TranzactionId || '',
    amount: result.TranzactionInfo?.Amount ?? workshop?.price ?? '',
    name: buyer.name,
    email: buyer.email,
    phone: buyer.phone,
    // Workshop details travel with the row so the email can be written once
    // and stay correct for workshops added later.
    workshopId: workshop?.id || '',
    workshopTitle: workshop?.title || '',
    workshopWhen: workshop?.whenLong || '',
    workshopPlace: workshop?.place || '',
    workshopUrl: workshop ? `https://workshops.gr8minds.co.il/${workshop.slug}` : '',
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`sheet responded ${r.status}`);
  console.log('registration recorded', row.orderId, row.email);
}

export default async function handler(req, res) {
  const body = readBody(req);
  const lowProfileId = body.LowProfileId || body.lowprofilecode || body.LowProfileCode;

  // Always 200 back to Cardcom: a non-2xx makes it retry, and a malformed
  // ping is not something a retry will fix.
  if (!lowProfileId) {
    console.warn('webhook without LowProfileId');
    return res.status(200).json({ received: true });
  }

  const terminal = process.env.CARDCOM_TERMINAL;
  const apiName = process.env.CARDCOM_API_NAME;
  if (!terminal || !apiName) {
    console.error('webhook: cardcom credentials missing');
    return res.status(200).json({ received: true });
  }

  try {
    const r = await fetch(VERIFY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TerminalNumber: Number(terminal),
        ApiName: apiName,
        LowProfileId: lowProfileId,
      }),
    });
    const result = await r.json();

    if (result.ResponseCode === 0) {
      console.log(
        'payment confirmed',
        result.ReturnValue,
        result.TranzactionId,
        result.TranzactionInfo?.Amount
      );
      // A failure here must not lose the payment, so it is logged loudly and
      // swallowed. The money is already taken; the row can be added by hand.
      try {
        await recordRegistration(result);
      } catch (err) {
        console.error('REGISTRATION NOT RECORDED', result.ReturnValue, err);
      }
    } else {
      console.warn('payment not completed', result.ResponseCode, result.Description);
    }
  } catch (err) {
    console.error('webhook verification failed', err);
  }

  return res.status(200).json({ received: true });
}
