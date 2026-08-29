// Firma kimlik bilgileri + AFG beyanı — EKRAN kopyası.
// Kaynak gerçeği backend'dir: config.py invoice_seller_* (belgeye oradan
// yazılır) ve pos_value_helpers.AFG_DECLARATION_* (C47-C50). Buradaki
// değerler onlarla eşleşmelidir; X3 placeholder'larının ("+45 00 00 00 00")
// yerine geçer. Beyan metni ÇEVİRİ KATMANI DIŞINDA sabit Danca'dır.

export const FIRMA = {
  navn: 'Sero Guld',
  tlf: '+45 22 25 55 04',
  cvr: '34093083',
  email: 'info@seroguld.dk',
  web: 'www.seroguld.dk',
} as const;

export const FIRMA_FOOTER_LINE = `${FIRMA.navn} · Tlf: ${FIRMA.tlf} · CVR: ${FIRMA.cvr}`;

export const AFG_DECLARATION_HEADER = 'Jeg bekræfter herved at:';
export const AFG_DECLARATION_ITEMS = [
  'Smykkerne/sølvtøjet er solgt frit og ubehæftet til Sero Guld ApS og kan ikke returneres.',
  'Varerne i denne handel er afregnet i henhold til dagsprisen på guld og sølv på www.seroguld.dk',
  'Jeg er ikke en politisk eksponeret person (PEP) eller nærtstående familiemedlem/partner, som er politisk eksponeret.',
] as const;
