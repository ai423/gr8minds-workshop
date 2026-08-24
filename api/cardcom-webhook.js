// Cardcom payment notification. Cardcom POSTs here after a transaction ends.
//
// The webhook body is public-facing input, so we never trust it on its own —
// we take the LowProfileId from it and re-ask Cardcom what actually happened.

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
      // Paid and verified. Seat confirmed for result.ReturnValue.
      console.log(
        'payment confirmed',
        result.ReturnValue,
        result.TranzactionId,
        result.TranzactionInfo?.Amount
      );
      // Next step when the list outgrows the Cardcom dashboard: persist the
      // order here and fire the confirmation email.
    } else {
      console.warn('payment not completed', result.ResponseCode, result.Description);
    }
  } catch (err) {
    console.error('webhook verification failed', err);
  }

  return res.status(200).json({ received: true });
}
