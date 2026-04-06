import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── Key Pool ────────────────────────────────────────────────────────────────

const COOLDOWN_MS = 60_000; // 1 min cooldown after 429
const RPM_DEFAULT = parseInt(process.env.RPM_PER_KEY || "15");

const RAW_KEYS = Object.entries(process.env)
  .filter(([k]) => k.startsWith("GEMINI_KEY_"))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, v]) => v.trim())
  .filter(Boolean);

if (!RAW_KEYS.length) {
  console.error("❌  No GEMINI_KEY_* variables found in .env");
  process.exit(1);
}

const pool = RAW_KEYS.map((key, i) => ({
  id: i + 1,
  key,
  rpm: RPM_DEFAULT,
  used: 0,
  minuteBucket: 0,
  coolUntil: 0,
  totalRequests: 0,
  totalErrors: 0,
}));

console.log(`✅  Loaded ${pool.length} Gemini key(s)`);

function currentMinute() {
  return Math.floor(Date.now() / 60_000);
}

function resetBucketIfNeeded(k) {
  const m = currentMinute();
  if (k.minuteBucket !== m) {
    k.used = 0;
    k.minuteBucket = m;
  }
}

function pickKey() {
  const now = Date.now();
  const available = pool.filter((k) => {
    resetBucketIfNeeded(k);
    return now >= k.coolUntil && k.used < k.rpm;
  });
  if (!available.length) return null;
  // pick least-loaded key
  return available.sort((a, b) => a.used / a.rpm - b.used / b.rpm)[0];
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

const MY_API_KEY = process.env.MY_API_KEY;
if (!MY_API_KEY) {
  console.error("❌  MY_API_KEY not set in .env");
  process.exit(1);
}

function auth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token !== MY_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── Core Routing Logic ───────────────────────────────────────────────────────

async function callGemini(key, model, payload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res;
}

async function routeRequest(model, payload) {
  const tried = new Set();

  while (true) {
    const k = pickKey();

    if (!k || tried.has(k.id)) {
      return {
        status: 429,
        body: {
          error: "All keys are rate limited. Try again shortly.",
          retryAfter: 60,
        },
      };
    }

    tried.add(k.id);
    k.used++;
    k.totalRequests++;

    const res = await callGemini(k.key, model, payload);

    if (res.status === 429) {
      k.coolUntil = Date.now() + COOLDOWN_MS;
      k.totalErrors++;
      console.log(`⚠️  Key ${k.id} rate limited — cooling for 60s, rotating...`);
      continue;
    }

    if (!res.ok) {
      k.totalErrors++;
      const err = await res.json().catch(() => ({}));
      console.log(`❌  Key ${k.id} error ${res.status}:`, err?.error?.message);
      return { status: res.status, body: err };
    }

    const data = await res.json();
    return { status: 200, body: data, usedKeyId: k.id };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// OpenAI-compatible chat endpoint
app.post("/v1/chat", auth, async (req, res) => {
  const { model = "gemini-2.0-flash", messages, ...rest } = req.body;

  // convert OpenAI messages format → Gemini format
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const payload = { contents, ...rest };
  const result = await routeRequest(model, payload);

  res.status(result.status).json({
    ...result.body,
    _gateway: { usedKeyId: result.usedKeyId },
  });
});

// Raw Gemini format endpoint
app.post("/v1/generate", auth, async (req, res) => {
  const { model = "gemini-2.0-flash", ...payload } = req.body;
  const result = await routeRequest(model, payload);
  res.status(result.status).json({
    ...result.body,
    _gateway: { usedKeyId: result.usedKeyId },
  });
});

// Simple prompt shortcut
app.post("/v1/prompt", auth, async (req, res) => {
  const { prompt, model = "gemini-2.0-flash", system } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const contents = [];
  if (system) contents.push({ role: "user", parts: [{ text: system }] });
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const result = await routeRequest(model, { contents });

  if (result.status !== 200) {
    return res.status(result.status).json(result.body);
  }

  const text =
    result.body?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  res.json({
    text,
    model,
    usedKeyId: result.usedKeyId,
  });
});

// Pool status (no auth — safe, shows no keys)
app.get("/status", (req, res) => {
  const now = Date.now();
  res.json({
    keys: pool.map((k) => {
      resetBucketIfNeeded(k);
      return {
        id: k.id,
        status: k.coolUntil > now ? "cooling" : k.used >= k.rpm ? "busy" : "active",
        usedThisMinute: k.used,
        rpmLimit: k.rpm,
        coolsInSeconds: k.coolUntil > now ? Math.ceil((k.coolUntil - now) / 1000) : 0,
        totalRequests: k.totalRequests,
        totalErrors: k.totalErrors,
      };
    }),
    activeKeys: pool.filter((k) => now >= k.coolUntil && k.used < k.rpm).length,
    totalKeys: pool.length,
  });
});

app.get("/", (req, res) => {
  res.json({ service: "Gemini Gateway", keys: pool.length, status: "ok" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀  Gateway running on http://localhost:${PORT}`);
  console.log(`🔑  Your API key: ${MY_API_KEY}`);
});
