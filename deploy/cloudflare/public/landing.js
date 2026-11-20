// Etusivu: Kokeile WhatsAppissa avaa ohjeen ottaa yhteyttä Eelikseen. Selainkeskustelun linkki /#whatsapp avaa sen suoraan.
const button = document.getElementById('wa-toggle');
const panel = document.getElementById('whatsapp');

function setOpen(open, reveal) {
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open && reveal) { panel.scrollIntoView({ block: 'center' }); panel.focus({ preventScroll: true }); }
}

button.addEventListener('click', () => setOpen(panel.hidden, true));
const fromHash = () => { if (location.hash === '#whatsapp') setOpen(true, true); };
window.addEventListener('hashchange', fromHash);
fromHash();
