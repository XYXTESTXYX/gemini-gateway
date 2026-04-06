# Gemini Gateway 🚀

Your personal Gemini API gateway. Add up to 10 keys, get one unified endpoint with automatic rotation.

## Setup (5 minutes)

### 1. Install
```bash
npm install
```

### 2. Configure
```bash
cp .env.example .env
# Edit .env and add your keys
```

### 3. Run
```bash
npm start
```

Your gateway is now live at `http://localhost:3000`

---

## API Usage

All requests need your secret key in the header:
```
Authorization: Bearer your-secret-key
```

---

### Endpoint 1 — Simple Prompt (easiest)
```bash
POST /v1/prompt

{
  "prompt": "What is the capital of Morocco?",
  "model": "gemini-2.0-flash"   # optional
}
```

Response:
```json
{
  "text": "The capital of Morocco is Rabat.",
  "model": "gemini-2.0-flash",
  "usedKeyId": 3
}
```

---

### Endpoint 2 — Chat (OpenAI-style messages)
```bash
POST /v1/chat

{
  "model": "gemini-2.0-flash",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

---

### Endpoint 3 — Raw Gemini Format
```bash
POST /v1/generate

{
  "model": "gemini-1.5-pro",
  "contents": [
    { "role": "user", "parts": [{ "text": "Hello!" }] }
  ]
}
```

---

### Pool Status (no auth needed)
```bash
GET /status
```
Returns which keys are active, cooling, how many requests each handled.

---

## Deploy Free Online

### Option A — Railway (recommended, easiest)
1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Add your env variables in the Railway dashboard
4. Done — Railway gives you a public URL

### Option B — Render
1. Push to GitHub
2. Go to render.com → New Web Service → Connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add env variables → Deploy

### Option C — Fly.io (free tier)
```bash
npm install -g flyctl
fly launch
fly secrets set MY_API_KEY=your-secret
fly secrets set GEMINI_KEY_1=AIza...
fly secrets set GEMINI_KEY_2=AIza...
fly deploy
```

### Option D — Docker (any VPS)
```bash
docker build -t gemini-gateway .
docker run -d \
  -p 3000:3000 \
  -e MY_API_KEY=your-secret \
  -e GEMINI_KEY_1=AIza... \
  -e GEMINI_KEY_2=AIza... \
  gemini-gateway
```

---

## Call It From Anywhere

### Python
```python
import requests

res = requests.post("https://your-gateway.railway.app/v1/prompt",
  headers={"Authorization": "Bearer your-secret-key"},
  json={"prompt": "Explain quantum computing in simple terms"}
)
print(res.json()["text"])
```

### JavaScript
```javascript
const res = await fetch("https://your-gateway.railway.app/v1/prompt", {
  method: "POST",
  headers: {
    "Authorization": "Bearer your-secret-key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ prompt: "Hello!" })
});
const { text } = await res.json();
```

### curl
```bash
curl -X POST https://your-gateway.railway.app/v1/prompt \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?"}'
```
