// Image generation: furnishes the user's OWN room photo with the products they chose.
// FLUX.2 [klein] takes the room photo plus up to 3 product photos as reference images,
// so the result keeps the real walls, windows, floor and camera angle.
const fs = require('fs');
const path = require('path');
const db = require('../storage/database');
const ai = require('../ai/cloudflare');
const { ITEMS } = require('../knowledge/items');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const MAX_PRODUCT_REFS = 3; // the model takes 4 images: the room + 3 products

const PLACEMENT = {
  sofa: 'against the main wall, facing the room',
  armchair: 'angled towards the sofa',
  coffee_table: 'centred in front of the sofa',
  side_table: 'next to the sofa',
  tv_unit: 'against the wall opposite the sofa',
  bookshelf: 'against a side wall',
  rug: 'on the floor under the front legs of the seating',
  curtains: 'hanging on the window, floor length',
  floor_lamp: 'in a corner next to the seating',
  table_lamp: 'on a side table or nightstand',
  ceiling_light: 'hanging from the centre of the ceiling',
  wall_art: 'hung on the main wall at eye level',
  mirror: 'on a free wall',
  plant: 'in a corner near the window',
  bed: 'headboard against the main wall',
  nightstand: 'beside the bed',
  wardrobe: 'against a side wall',
  dresser: 'against a free wall',
  bedding: 'on the bed',
  desk: 'near the window',
  office_chair: 'at the desk',
  dining_table: 'in the centre of the room',
  dining_chair: 'around the dining table',
  sideboard: 'against a side wall'
};

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function buildPrompt({ vision, prefs, refs, textOnly, keepItems }) {
  const lines = [
    'Image 1 is a real photo of a room. Redesign it by furnishing it, keeping it the SAME room:',
    'same walls, same window and door positions, same floor, same ceiling, same camera angle and perspective.',
    ''
  ];
  refs.forEach((p, i) => {
    lines.push(`Image ${i + 2} shows the exact ${ITEMS[p.category].en.toLowerCase()} to use: place it ${PLACEMENT[p.category] || 'where it fits naturally'}. Keep its shape, colour and material.`);
  });
  textOnly.forEach(p => {
    lines.push(`Add a ${ITEMS[p.category].en.toLowerCase()} similar to "${p.title.slice(0, 80)}", ${PLACEMENT[p.category] || 'where it fits naturally'}.`);
  });
  if (keepItems?.length) lines.push(`Keep the existing ${keepItems.join(', ')} in place.`);
  lines.push('');
  lines.push(`Style: ${prefs.preferredStyle || 'modern'} interior. Colour palette: ${(prefs.colors || []).join(', ') || 'neutral'}${prefs.colorsToAvoid?.length ? `, no ${prefs.colorsToAvoid.join(', ')}` : ''}.`);
  if (vision?.lightingAssessment?.naturalLight) lines.push(`Keep the ${vision.lightingAssessment.naturalLight} natural daylight from the window.`);
  lines.push('Realistic proportions and scale for the room size. Photorealistic interior photograph, natural light, no people, no text.');
  return lines.join('\n');
}

class ImageGenAgent {
  async generateAfterImage(sessionId) {
    const session = db.getSession(sessionId);
    if (!session?.originalImagePath || !fs.existsSync(session.originalImagePath)) {
      throw new Error('The room photo for this session is missing. Upload it again.');
    }
    const prefs = db.getPreferences(sessionId) || {};
    const vision = db.getVisionAnalysis(sessionId)?.analysis;
    const selected = db.getHITLState(sessionId)?.selectedProducts || [];
    const generationId = session.currentGenerationId;

    // Big pieces get reference photos first; the rest are described in words
    const ordered = [...selected].sort((a, b) => (ITEMS[b.category]?.big ? 1 : 0) - (ITEMS[a.category]?.big ? 1 : 0) || b.price - a.price);
    const refs = [];
    const refImages = [];
    for (const p of ordered) {
      if (refs.length >= MAX_PRODUCT_REFS) break;
      if (!p.image_url) continue;
      try {
        refImages.push(await download(p.image_url));
        refs.push(p);
      } catch (err) {
        console.warn(`[Image Generation Agent] Could not download photo for ${p.title}: ${err.message}`);
      }
    }
    const textOnly = ordered.filter(p => !refs.includes(p));
    const prompt = buildPrompt({ vision, prefs, refs, textOnly, keepItems: prefs.keepItems });

    console.log(`[Image Generation Agent] Furnishing the room with ${refs.length} product photos + ${textOnly.length} described items...`);
    let result;
    try {
      const image = await ai.editImage(prompt, [fs.readFileSync(session.originalImagePath), ...refImages]);
      const fileName = `${sessionId}_${generationId}.jpg`;
      fs.writeFileSync(path.join(db.generatedDir, fileName), image);
      result = {
        status: 'SUCCESS',
        provider: `Cloudflare Workers AI (${ai.MODELS.image})`,
        imageUrl: `/data/generated/${fileName}`,
        prompt,
        referenceProducts: refs.map(p => ({ id: p.id, title: p.title, category: p.category })),
        describedProducts: textOnly.map(p => ({ id: p.id, title: p.title, category: p.category })),
        generationId,
        generatedAt: new Date().toISOString()
      };
    } catch (err) {
      console.error(`[Image Generation Agent] Failed: ${err.message}`);
      result = { status: 'FAILED', imageUrl: null, prompt, message: err.message, generationId, generatedAt: new Date().toISOString() };
    }

    // Ignore the result if the user uploaded a different photo meanwhile
    const current = db.getSession(sessionId);
    if (current.currentGenerationId !== generationId) {
      console.warn('[Image Generation Agent] A newer room photo was uploaded; discarding this image.');
      return null;
    }
    db.saveGeneratedImage(sessionId, result);
    return result;
  }
}

module.exports = new ImageGenAgent();
module.exports.buildPrompt = buildPrompt;
