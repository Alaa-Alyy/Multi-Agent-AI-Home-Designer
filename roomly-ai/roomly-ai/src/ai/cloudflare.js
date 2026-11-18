// Cloudflare Workers AI client: chat, vision, embeddings and image editing.
// One free account covers every AI call in Roomly.
const sharp = require('sharp');

const MODELS = {
  chat: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  fast: '@cf/meta/llama-3.1-8b-instruct-fast', // ~10x cheaper; used for simple yes/no checks
  vision: '@cf/meta/llama-4-scout-17b-16e-instruct',
  embed: '@cf/baai/bge-m3',
  image: '@cf/black-forest-labs/flux-2-klein-9b'
};

class MissingCredentialsError extends Error {
  constructor() {
    super('Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.');
    this.code = 'MISSING_CLOUDFLARE_CREDENTIALS';
  }
}

// The free plan allows 10,000 neurons a day, reset at 00:00 UTC (02:00 Cairo time)
class DailyLimitError extends Error {
  constructor() {
    super('The free daily AI allowance is used up. It resets at 00:00 UTC (02:00 Cairo time).');
    this.code = 'DAILY_AI_LIMIT';
  }
}

function isConfigured() {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
}

function endpoint(model) {
  if (!isConfigured()) throw new MissingCredentialsError();
  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
}

async function call(model, { json, form }, { retries = 2, timeoutMs = 120000 } = {}) {
  const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
  if (json) headers['Content-Type'] = 'application/json';

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(endpoint(model), {
        method: 'POST',
        headers,
        body: json ? JSON.stringify(json) : form,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) return data.result;

      const message = data.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`;
      if (/daily free allocation|neurons/i.test(message)) throw new DailyLimitError();
      lastError = new Error(`Cloudflare ${model}: ${message}`);
      // 4xx other than rate limits will not succeed on retry
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      if (err instanceof MissingCredentialsError || err instanceof DailyLimitError) throw err;
      lastError = err;
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw lastError;
}

function extractText(result) {
  if (result == null) return '';
  if (typeof result.response === 'string') return result.response;
  if (result.response && typeof result.response === 'object') return JSON.stringify(result.response);
  if (result.choices?.[0]?.message?.content) return result.choices[0].message.content;
  return '';
}

function parseJson(text) {
  if (typeof text === 'object') return text;
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error(`Model did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}

// Text chat. With `schema`, the model is forced to answer as JSON and the parsed object is returned.
async function chat(messages, { schema = null, maxTokens = 800, temperature = 0.4, model = MODELS.chat } = {}) {
  const body = { messages, max_tokens: maxTokens, temperature };
  if (schema) body.response_format = { type: 'json_schema', json_schema: schema };
  const result = await call(model, { json: body });
  if (schema && result?.response && typeof result.response === 'object') return result.response;
  const text = extractText(result);
  return schema ? parseJson(text) : text;
}

// Resize any image buffer to a JPEG that fits inside `size` x `size`.
async function toJpeg(buffer, size) {
  return sharp(buffer).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

// Vision: ask a question about an image and get JSON back.
async function vision(imageBuffer, instruction, { maxTokens = 1500 } = {}) {
  const jpeg = await toJpeg(imageBuffer, 1024);
  const body = {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }
      ]
    }],
    max_tokens: maxTokens,
    temperature: 0.2
  };
  const result = await call(MODELS.vision, { json: body });
  return parseJson(extractText(result));
}

// Multilingual embeddings (Arabic + English), 1024 dimensions.
async function embed(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const vectors = [];
  for (let i = 0; i < list.length; i += 50) {
    const result = await call(MODELS.embed, { json: { text: list.slice(i, i + 50) } });
    vectors.push(...result.data);
  }
  return vectors;
}

// Image editing with reference images. images[0] should be the room; the rest are product photos.
// FLUX.2 [klein] accepts up to 4 reference images, each at most 512x512.
async function editImage(prompt, images) {
  if (!images.length) throw new Error('editImage needs at least the room photo');
  const form = new FormData();
  form.append('prompt', prompt);
  const refs = images.slice(0, 4);
  for (let i = 0; i < refs.length; i++) {
    const jpeg = await toJpeg(refs[i], 512);
    form.append(`input_image_${i}`, new Blob([jpeg], { type: 'image/jpeg' }), `input_${i}.jpg`);
  }
  const result = await call(MODELS.image, { form }, { retries: 1, timeoutMs: 180000 });
  if (!result?.image) throw new Error('Image model returned no image');
  return Buffer.from(result.image, 'base64');
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

module.exports = { MODELS, isConfigured, MissingCredentialsError, DailyLimitError, chat, vision, embed, editImage, toJpeg, cosine };
