// Registration modal, shared by every workshop page.
//
// A page opts in with nothing but these two tags:
//
//   <link rel="stylesheet" href="/assets/checkout.css">
//   <script type="module" src="/assets/checkout.js"></script>
//
// The workshop is identified by the data-product on the page's own CTAs, so
// this file never needs editing when a workshop is added.

import { byId } from '/workshops.js';

const ctas = document.querySelectorAll('[data-checkout]');
if (ctas.length) {
  const productId = ctas[0].dataset.product;
  const workshop = byId(productId);

  if (!workshop) {
    // Unknown id: leave the links alone rather than wiring a broken modal.
    console.error('checkout: no workshop matches data-product', productId);
  } else {
    build(workshop, ctas);
  }
}

function build(workshop, ctas) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'register';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="reg-title">
      <button class="modal-x" type="button" data-close aria-label="סגירה">&times;</button>
      <h3 id="reg-title">שמירת מקום בסדנה</h3>
      <p class="modal-sub"></p>
      <form id="reg-form" method="POST" action="/api/checkout">
        <label>שם מלא
          <input name="name" type="text" required autocomplete="name" maxlength="80">
        </label>
        <label>אימייל
          <input name="email" type="email" required autocomplete="email" maxlength="120">
        </label>
        <label>טלפון
          <input name="phone" type="tel" required autocomplete="tel" maxlength="30"
                 inputmode="tel" pattern="[0-9+\\-\\(\\) ]{9,}">
        </label>
        <p class="modal-err" id="reg-err" hidden></p>
        <button class="btn" type="submit" id="reg-submit">מעבר לתשלום מאובטח</button>
        <p class="modal-fine">
          התשלום מאובטח ומתבצע בדף של קארדקום. חשבונית נשלחת במייל.
          ביטול עד 48 שעות לפני מזכה בהחזר מלא.
        </p>
      </form>
    </div>`;
  // textContent, not innerHTML: workshop copy is data, never markup.
  modal.querySelector('.modal-sub').textContent = workshop.whenShort;
  document.body.appendChild(modal);

  const form = modal.querySelector('#reg-form');
  const errBox = modal.querySelector('#reg-err');
  const submit = modal.querySelector('#reg-submit');
  const SUBMIT_LABEL = submit.textContent;
  let lastFocus = null;

  const open = (e) => {
    if (e) e.preventDefault();
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('input')?.focus();
  };
  const close = () => {
    modal.hidden = true;
    document.body.style.overflow = '';
    lastFocus?.focus();
  };
  const fail = (msg) => {
    errBox.textContent = msg;
    errBox.hidden = false;
    submit.disabled = false;
    submit.textContent = SUBMIT_LABEL;
  };

  ctas.forEach((a) => a.addEventListener('click', open));
  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    submit.disabled = true;
    submit.textContent = 'רגע, פותחים תשלום מאובטח...';

    const get = (n) => form.querySelector(`[name=${n}]`).value.trim();
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          product: workshop.id,
          name: get('name'),
          email: get('email'),
          phone: get('phone'),
        }),
      });
      const data = await r.json();
      if (r.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      fail(data.message || 'לא הצלחנו לפתוח את דף התשלום. נסו שוב, או כתבו לנו ל-ai@gr8minds.co.il');
    } catch {
      fail('בעיית תקשורת. נסו שוב, או כתבו לנו ל-ai@gr8minds.co.il');
    }
  });

  // Returning from a declined or abandoned payment.
  if (/[?&]payment=failed/.test(location.search)) {
    open();
    fail('התשלום לא הושלם. אפשר לנסות שוב.');
  }
}
