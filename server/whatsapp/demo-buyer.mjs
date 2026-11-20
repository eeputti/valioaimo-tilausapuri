// Demon ostaja päätellään vain palvelimen asetuksista. Selain tai viesti ei voi itse valita, kenen nimissä se tilaa.
import { phoneNumber } from './store.mjs';

const BUYER_ID_SHAPE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function createDemoBuyerResolver(env = process.env) {
  const fixedBuyer = String(env.WHATSAPP_DEMO_BUYER_ID ?? '').trim();
  const fixedPhoneSetting = String(env.WHATSAPP_DEMO_PHONE ?? '').trim();
  let fixedPhone = null;
  if (fixedBuyer) {
    const usable = fixedPhoneSetting && BUYER_ID_SHAPE.test(fixedBuyer);
    if (!usable) throw new Error('WHATSAPP_DEMO_BUYER_ID tarvitsee kelvollisen ostajatunnuksen ja WHATSAPP_DEMO_PHONE-numeron.');
    fixedPhone = phoneNumber(fixedPhoneSetting);
  }
  return function buyerForMember(member) {
    const ownId = `whatsapp-demo:${member.binding}`;
    if (fixedBuyer && member.phone === fixedPhone) {
      // Kiinnitetty ostaja saa oman asiakastunnuksensa: aiemman asiakkaan luonnos, tarjous tai vahvistus ei siirry sille.
      return { buyerId: fixedBuyer, customerId: `${ownId}:buyer:${fixedBuyer}`, mapped: true };
    }
    return { buyerId: `whatsapp-demo-${member.binding}`, customerId: ownId, mapped: false };
  };
}
