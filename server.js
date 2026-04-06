import express from 'express';

const app = express();
app.use(express.json());

const KEYS = process.env.GEMINI_KEYS.split(',').map(k => k.trim());
const SECRET = process.env.MY_SECRET;
let idx = 0;
const cooldowns = {};

function getKey() {
  const now = Date.now();
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[(idx + i) % KEYS.length];
    if (!cooldowns[k] || now > cooldowns[k]) {
      idx = (idx + i + 1) % KEYS.length;
      return k;
    }
  }
  return null;
}

app.get('/', (_, res) => {
  res.json({ service: 'Gemini Gateway', keys: KEYS.length, status: 'ok' });
});

app.get('/health', (_, res) => {
  res.json({ status: 'ok', keys: KEYS.length });
});

app.get('/chat', (_, res) => {
  res.json({ message: 'chat endpoint alive — use POST with a body' });
});

app.post('/chat', async (req, res) => {
  if (req.headers['x-gateway-key'] !== SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const model = req.body.model || 'gemini-2.0-flash';

  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const key = getKey();
    if (!key) return res.status(429).json({ error: 'all keys cooling' });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      }
    );

    if (r.status === 429) {
      cooldowns[key] = Date.now() + 60000;
      continue;
    }
    return res.status(r.status).json(await r.json());
  }

  res.status(429).json({ error: 'all keys exhausted' });
});

app.listen(process.env.PORT || 3000);
console.log('Gateway running, keys:', KEYS.length);
