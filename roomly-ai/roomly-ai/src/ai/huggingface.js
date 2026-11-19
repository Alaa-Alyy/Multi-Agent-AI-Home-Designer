// Hugging Face (free account):
//  - image editing through the public FLUX.2 [klein] 9B Space (ZeroGPU, a few minutes of GPU a day)
//  - bge-m3 embeddings through Inference Providers (needs the token's "Inference Providers" permission)
const sharp = require('sharp');

const SPACE = 'black-forest-labs/FLUX.2-klein-9B';
const EMBED_URL = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction';

function isConfigured() {
  return Boolean(process.env.HF_TOKEN);
}

let clientPromise = null;
async function spaceClient() {
  if (!clientPromise) {
    clientPromise = import('@gradio/client')
      .then(({ Client }) => Client.connect(SPACE, { token: process.env.HF_TOKEN }))
      .catch(err => { clientPromise = null; throw err; });
  }
  return clientPromise;
}

// Keep the room photo's shape; sides must be multiples of 16, longest side 1024
async function outputSize(roomBuffer) {
  const { width, height } = await sharp(roomBuffer).rotate().metadata();
  const scale = 1024 / Math.max(width, height);
  const snap = v => Math.max(256, Math.min(1024, Math.round((v * scale) / 16) * 16));
  return { width: snap(width), height: snap(height) };
}

async function editImage(prompt, images) {
  if (!isConfigured()) throw new Error('Hugging Face is not configured (HF_TOKEN)');
  const { handle_file } = await import('@gradio/client');
  const client = await spaceClient();
  const size = await outputSize(images[0]);

  const inputs = [];
  for (let i = 0; i < Math.min(images.length, 4); i++) {
    const jpeg = await sharp(images[i]).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    inputs.push({ image: handle_file(new Blob([jpeg], { type: 'image/jpeg' })), caption: null });
  }

  const job = client.predict('/generate', {
    prompt,
    input_images: inputs,
    mode_choice: 'Distilled (4 steps)',
    seed: 0,
    randomize_seed: true,
    width: size.width,
    height: size.height,
    num_inference_steps: 4,
    guidance_scale: 1.0,
    prompt_upsampling: false
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Hugging Face Space took too long')), 240000));
  const result = await Promise.race([job, timeout]);

  const out = result?.data?.[0];
  const url = out?.url || out?.path;
  if (!url) throw new Error('Hugging Face Space returned no image');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Could not download the generated image (HTTP ${res.status})`);
  // Store as JPEG like the other provider
  return sharp(Buffer.from(await res.arrayBuffer())).jpeg({ quality: 90 }).toBuffer();
}

async function embed(texts) {
  if (!isConfigured()) throw new Error('Hugging Face is not configured (HF_TOKEN)');
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: Array.isArray(texts) ? texts : [texts] }),
    signal: AbortSignal.timeout(60000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data)) throw new Error(`Hugging Face embeddings: ${data.error || `HTTP ${res.status}`}`);
  return data;
}

module.exports = { name: 'huggingface', SPACE, isConfigured, editImage, embed };
