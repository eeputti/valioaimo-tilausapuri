// Puhelimella kaikki sivut toimivat paitsi Keskustele: sen keskustelu käydään puhelimella oikeassa WhatsAppissa.
// Puhelimella html saa luokan is-phone (site.css piilottaa sillä Keskustele-linkit), ja Keskustele-sivulla näkyy ikkuna,
// josta voi soittaa Eelikselle tai palata etusivulle.
// Ladataan <head>-osassa ennen sivun sisältöä (tavallinen skripti), jotta sivu ei ehdi välähtää. Tyylit site.css:ssä.
(() => {
  const ua = navigator.userAgent || '';
  const phone = navigator.userAgentData?.mobile === true
    || /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile|Opera Mini|BlackBerry/i.test(ua)
    || (matchMedia('(pointer: coarse) and (hover: none)').matches && Math.min(screen.width, screen.height) < 600);
  if (!phone) return;
  document.documentElement.classList.add('is-phone');
  if (!/^\/keskustele(\.html|\/)?$/.test(location.pathname)) return;
  document.documentElement.classList.add('phone-gate');

  const ART = `<svg class="gate-art" viewBox="0 0 260 176" aria-hidden="true">
    <ellipse cx="124" cy="164" rx="104" ry="8" fill="#003c75" opacity=".08"/>
    <g class="gate-laptop">
      <rect x="40" y="26" width="160" height="106" rx="11" fill="#003c75"/>
      <rect x="49" y="35" width="142" height="88" rx="5" fill="#fff"/>
      <image href="/aimo-logo.png" x="62" y="57.5" width="116" height="40.3" preserveAspectRatio="xMidYMid meet"/>
      <path d="M24 134h192l-11 15a7 7 0 0 1-5.6 3H40.6a7 7 0 0 1-5.6-3z" fill="#1668e3"/>
      <rect x="104" y="134" width="32" height="5" rx="2.5" fill="#0d4fb8"/>
    </g>
    <g class="gate-bubble">
      <rect x="150" y="2" width="76" height="32" rx="13" fill="#003c75"/>
      <path d="M164 32l-7 11 16-9z" fill="#003c75"/>
      <text x="188" y="24" text-anchor="middle" font-family="Matter,Arial,sans-serif" font-size="16" font-weight="700" fill="#fff">Moi!</text>
    </g>
    <g class="gate-phone">
      <rect x="214" y="84" width="34" height="62" rx="7" fill="#101c26"/>
      <rect x="217.5" y="90" width="27" height="48" rx="3.5" fill="#25d366"/>
      <path d="M231 103a9 9 0 0 0-7.8 13.5l-1.2 4.5 4.6-1.2A9 9 0 1 0 231 103z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    </g>
  </svg>`;
  const PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.8l1.4 4.2-2 1.6a12 12 0 0 0 5.9 5.9l1.6-2 4.2 1.4v2.8a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 4.6 5.6a2 2 0 0 1 2-2.1z" fill="currentColor"/></svg>';

  function build() {
    const gate = document.createElement('div');
    gate.className = 'gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'gate-title');
    gate.setAttribute('aria-describedby', 'gate-text');
    gate.innerHTML = `<div class="gate-card">${ART}
      <h2 id="gate-title">Keskustele WhatsAppissa</h2>
      <p id="gate-text">Puhelimella tilausapurin kanssa jutellaan oikeassa WhatsAppissa. Olethan yhteydessä Eelikseen, niin pääset kokeilemaan sitä omassa WhatsAppissasi.</p>
      <a class="gate-call" href="tel:+358503260441">${PHONE}Soita Eelikselle 050 326 0441</a>
      <a class="gate-home" href="/">Etusivulle</a>
    </div>`;
    for (const child of document.body.children) { child.inert = true; child.setAttribute('aria-hidden', 'true'); }
    document.body.append(gate);
    gate.querySelector('.gate-call').focus({ preventScroll: true });
  }
  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build, { once: true });
})();
