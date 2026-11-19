// Groq (free tier): chat and vision with Qwen3.8 27B. OpenAI-compatible API.
const { toJpeg } = require('./cloudflare');

const MODEL = 'qwen/qwen3.8-27b';
const URL = 'https://api.groq.com/openai/v1/chat/completions';

function isConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

// The free tier limits tokens per minute. When Groq says "try again in Xs" and X is short,
// waiting is better than giving up, so we wait and retry a few times.
const MAX_WAIT_S = 20;

async function complete(body, { timeoutMs = 60000 } = {}) {
  if (!isConfigured()) throw new Error('Groq is not configured (GROQ_API_KEY)');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, ...body }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      // Some models put their reasoning in <think> tags; keep only the answer
      return String(data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
    const message = data.error?.message || `HTTP ${res.status}`;
    const hinted = (message.match(/try again in ([\d.]+)s/i) || [])[1] || res.headers.get('retry-after');
    const wait = hinted == null ? NaN : Number(hinted);
    if (res.status === 429 && attempt < 4 && Number.isFinite(wait) && wait <= MAX_WAIT_S) {
      console.log(`[AI] Groq is busy; waiting ${wait.toFixed(1)} s and retrying...`);
      await new Promise(r => setTimeout(r, (wait + 0.5) * 1000));
      continue;
    }
    const err = new Error(`Groq: ${message}`);
    if (res.status === 429) err.code = 'RATE_LIMIT';
    throw err;
  }
}

function parseJson(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

async function chat(messages, { schema = null, maxTokens = 800, temperature = 0.4 } = {}) {
  // Groq's strict schema mode rejects optional fields, so we use plain JSON mode with the schema
  // in the prompt; the agents validate every field afterwards anyway.
  let msgs = messages;
  const body = { max_tokens: maxTokens, temperature };
  if (schema) {
    const hint = `Reply with ONE JSON object only, following this JSON Schema (omit fields you do not know):\n${JSON.stringify(schema)}`;
    msgs = messages[0]?.role === 'system'
      ? [{ ...messages[0], content: `${messages[0].content}\n\n${hint}` }, ...messages.slice(1)]
      : [{ role: 'system', content: hint }, ...messages];
    body.response_format = { type: 'json_object' };
  }
  const text = await complete({ ...body, messages: msgs });
  return schema ? parseJson(text) : text;
}

async function vision(imageBuffer, instruction, { maxTokens = 1500 } = {}) {
  const jpeg = await toJpeg(imageBuffer, 1024);
  const text = await complete({
    max_tokens: maxTokens,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }
      ]
    }]
  }, { timeoutMs: 90000 });
  return parseJson(text);
}

module.exports = { name: 'groq', MODEL, isConfigured, chat, vision };
