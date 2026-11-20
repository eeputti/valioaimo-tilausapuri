// Ympäristöasetukset yhdessä paikassa. .env ladataan Noden --env-file-if-exists -lipulla (ks. package.json).
export const config = {
  llmProvider: 'anthropic',
  port: Number(process.env.PORT || 4747),
  valioKey: (process.env.VALIO_API_KEY || '').trim(),
  valioBase: (process.env.VALIO_API_BASE || 'https://junction26.valioaimo.fi').replace(/\/$/, ''),
  anthropicKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  deepModel: process.env.DEEP_MODEL || 'claude-opus-5-5',
  fastModel: process.env.FAST_MODEL || 'claude-haiku-5-5',
  customer: process.env.VALIO_CUSTOMER || '123', // challengessa asiakasnumero ei vaikuta vastaukseen
};

export const apiMode = () => (config.valioKey ? 'live' : 'sim');
export const llmEnabled = () => Boolean(config.anthropicKey);
