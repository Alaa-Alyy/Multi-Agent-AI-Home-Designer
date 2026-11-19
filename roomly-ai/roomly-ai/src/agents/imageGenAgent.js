// Image generation: furnishes the user's OWN room photo with EXACTLY the products they chose.
//
// The image model takes 4 images: the room + 3 references. To give every chosen product a photo:
//   - the 2 biggest products each get their own reference image
//   - all the other products are combined into one "product sheet" (a 2x2 / 3x2 grid)
// After generating, a vision model checks the result item by item (present? exactly one? anything
// extra?). If something is wrong it retries once with a correction, keeps the better result,
// and reports the check honestly to the user.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../storage/database');
const ai = require('../ai');
const { ITEMS } = require('../knowledge/items');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const SOLO_REFS = 2;      // products with their own reference image
const SHEET_MAX = 6;      // products on the combined sheet
const MAX_ATTEMPTS = 2;   // first try + one corrected retry (free GPU time is limited)

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
  dining_table: 'in an open area of the room',
  dining_chair: 'around the dining table',
  sideboard: 'against a side wall'
};

const name = p => ITEMS[p.category]?.en.toLowerCase() || p.category;

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// One image with several product photos in a grid, white background, no text
async function productSheet(photos) {
  const cols = photos.length <= 4 ? 2 : 3;
  const rows = Math.ceil(photos.length / cols);
  const tile = 384;
  const tiles = await Promise.all(photos.map(b => sharp(b).rotate()
    .resize(tile - 24, tile - 24, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer()));
  return sharp({ create: { width: cols * tile, height: rows * tile, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * tile + 12, top: Math.floor(i / cols) * tile + 12 })))
    .jpeg({ quality: 90 }).toBuffer();
}

const POSITIONS = {
  2: ['left', 'right'],
  3: ['top-left', 'top-right', 'bottom-left'],
  4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  5: ['top-left', 'top-middle', 'top-right', 'bottom-left', 'bottom-middle'],
  6: ['top-left', 'top-middle', 'top-right', 'bottom-left', 'bottom-middle', 'bottom-right']
};

function buildPrompt({ vision, prefs, solo, sheet, textOnly, keepItems, correction }) {
  const all = [...solo, ...sheet, ...textOnly];
  const lines = [
    'Image 1 is a real photo of a room. Furnish it while keeping it the SAME room:',
    'same walls, same window and door positions, same floor, same ceiling, same camera angle and perspective.',
    ''
  ];
  solo.forEach((p, i) => {
    lines.push(`Image ${i + 2} shows the exact ${name(p)} to use: place it ${PLACEMENT[p.category] || 'where it fits naturally'}. Copy its shape, colour and material.`);
  });
  if (sheet.length === 1) {
    lines.push(`Image ${solo.length + 2} shows the exact ${name(sheet[0])} to use: place it ${PLACEMENT[sheet[0].category] || 'where it fits naturally'}. Copy its shape, colour and material.`);
  } else if (sheet.length > 1) {
    const pos = POSITIONS[sheet.length];
    lines.push(`Image ${solo.length + 2} is a sheet of product photos. Use each product exactly as shown:`);
    sheet.forEach((p, i) => lines.push(`- ${pos[i]}: the ${name(p)}, place it ${PLACEMENT[p.category] || 'where it fits naturally'}.`));
  }
  textOnly.forEach(p => lines.push(`Add a ${name(p)} like "${p.title.slice(0, 80)}", ${PLACEMENT[p.category] || 'where it fits naturally'}.`));
  if (keepItems?.length) lines.push(`Keep the existing ${keepItems.join(', ')} exactly where they are.`);
  lines.push('');
  lines.push(`The room must contain EXACTLY these new items, one of each: ${all.map(name).join(', ')}.`);
  lines.push('Do NOT add any other furniture, chairs, tables, plants, lamps, shelves or decor. Do NOT duplicate any item.');
  lines.push('The products must keep their OWN colours from the reference photos; do not recolour them.');
  lines.push(`Style: ${prefs.preferredStyle || 'modern'} interior${prefs.colors?.length ? `, accent colours ${prefs.colors.join(', ')}` : ''}.`);
  if (vision?.lightingAssessment?.naturalLight) lines.push(`Keep the ${vision.lightingAssessment.naturalLight} natural daylight.`);
  lines.push('Realistic proportions and scale for the room size. Photorealistic interior photograph, no people, no text.');
  if (correction) lines.push('', `IMPORTANT CORRECTION from the previous attempt: ${correction}`);
  return lines.join('\n');
}

const CHECK_INSTRUCTION = items => `This is an AI-generated photo of a furnished room. The designer chose EXACTLY these new items:
${items.map((p, i) => `${i + 1}. ${name(p)} ("${p.title.slice(0, 70)}")`).join('\n')}

Look carefully and return ONLY a JSON object:
{
  "items": [ { "index": number, "present": true or false, "count": number of that item visible, "looksLike": "matches" | "different" | "missing" } ],
  "extraFurniture": [ "names of any furniture or decor visible that is NOT in the list above" ]
}
Use the same index numbers. Be strict: if an item is not clearly visible, present is false.`;

const SMALL_PROPS = /(pillow|cushion|throw|blanket|vase|flower|book|frame|candle|tray|bowl|cup|mug|magazine|remote|ornament|sculpture|figurine|basket|clock)/i;

async function verify(imageBuffer, products) {
  try {
    const out = await ai.vision(imageBuffer, CHECK_INSTRUCTION(products), { maxTokens: 700 });
    const items = products.map((p, i) => {
      const r = (out.items || []).find(x => Number(x.index) === i + 1) || {};
      const count = Number.isFinite(Number(r.count)) ? Number(r.count) : (r.present ? 1 : 0);
      return {
        id: p.id, category: p.category, title: p.title,
        present: Boolean(r.present) && count > 0,
        count,
        looksLike: r.looksLike || (r.present ? 'matches' : 'missing')
      };
    });
    const extras = (out.extraFurniture || []).map(String).filter(Boolean).slice(0, 8);
    // Small styling props are worth showing but not worth a retry (free GPU time is scarce)
    const minorExtras = extras.filter(e => SMALL_PROPS.test(e));
    const majorExtras = extras.filter(e => !SMALL_PROPS.test(e));
    const different = items.filter(i => i.present && i.looksLike === 'different' && ITEMS[i.category]?.big);
    const problems = items.filter(i => !i.present || i.count > 1).length + majorExtras.length + different.length;
    return { checked: true, items, extras, majorExtras, minorExtras, problems, ok: problems === 0 };
  } catch (err) {
    console.warn(`[Image Generation Agent] Could not check the image: ${err.message}`);
    return { checked: false, items: [], extras: [], problems: null, ok: null, message: err.message };
  }
}

function correctionFor(check) {
  const parts = [];
  const missing = check.items.filter(i => !i.present).map(i => ITEMS[i.category]?.en.toLowerCase());
  const doubled = check.items.filter(i => i.count > 1).map(i => ITEMS[i.category]?.en.toLowerCase());
  const different = check.items.filter(i => i.present && i.looksLike === 'different' && ITEMS[i.category]?.big);
  if (missing.length) parts.push(`these items were missing, they MUST be clearly visible: ${missing.join(', ')}`);
  if (doubled.length) parts.push(`there must be only ONE ${doubled.join(', only ONE ')}`);
  different.forEach(i => parts.push(`the ${ITEMS[i.category].en.toLowerCase()} must look exactly like its reference photo ("${i.title.slice(0, 70)}"), same shape and same colour`));
  const extras = check.majorExtras || check.extras || [];
  if (extras.length) parts.push(`remove the furniture that was not chosen: ${extras.join(', ')}`);
  return parts.join('; ') + '.';
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
    if (!selected.length) throw new Error('No products were chosen.');

    // Download every product photo; big pieces first
    const ordered = [...selected].sort((a, b) => (ITEMS[b.category]?.big ? 1 : 0) - (ITEMS[a.category]?.big ? 1 : 0) || b.price - a.price);
    const photos = new Map();
    await Promise.all(ordered.map(async p => {
      if (!p.image_url) return;
      try { photos.set(p.id, await download(p.image_url)); } catch (err) {
        console.warn(`[Image Generation Agent] Could not download photo for ${p.title}: ${err.message}`);
      }
    }));
    const withPhoto = ordered.filter(p => photos.has(p.id));
    const solo = withPhoto.slice(0, SOLO_REFS);
    const sheet = withPhoto.slice(SOLO_REFS, SOLO_REFS + SHEET_MAX);
    const textOnly = ordered.filter(p => !solo.includes(p) && !sheet.includes(p));

    const refs = solo.map(p => photos.get(p.id));
    if (sheet.length === 1) refs.push(photos.get(sheet[0].id));
    else if (sheet.length > 1) refs.push(await productSheet(sheet.map(p => photos.get(p.id))));
    const room = fs.readFileSync(session.originalImagePath);

    console.log(`[Image Generation Agent] ${solo.length} product photos + a sheet of ${sheet.length} + ${textOnly.length} described`);
    let best = null;
    let correction = null;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const prompt = buildPrompt({ vision, prefs, solo, sheet, textOnly, keepItems: prefs.keepItems, correction });
      try {
        const { image, provider } = await ai.editImage(prompt, [room, ...refs]);
        const check = await verify(image, ordered);
        console.log(`[Image Generation Agent] Attempt ${attempt}: ${check.checked ? `${check.problems} problem(s)` : 'not checked'}${check.extras?.length ? `; extras: ${check.extras.join(', ')}` : ''}`);
        const candidate = { image, provider, prompt, check, attempt };
        if (!best || (check.problems ?? 99) < (best.check.problems ?? 99)) best = candidate;
        if (check.ok || !check.checked) break;
        correction = correctionFor(check);
      } catch (err) {
        lastError = err;
        console.error(`[Image Generation Agent] Attempt ${attempt} failed: ${err.message}`);
        if (!best) break; // no image at all: stop, do not burn more quota
      }
    }

    let result;
    if (best) {
      const fileName = `${sessionId}_${generationId}.jpg`;
      fs.writeFileSync(path.join(db.generatedDir, fileName), best.image);
      result = {
        status: 'SUCCESS',
        provider: best.provider === 'huggingface' ? 'Hugging Face (FLUX.2 klein 9B Space)' : `Cloudflare Workers AI (${ai.MODELS.image})`,
        imageUrl: `/data/generated/${fileName}`,
        prompt: best.prompt,
        attempts: best.attempt,
        verification: best.check,
        referenceProducts: [...solo, ...sheet].map(p => ({ id: p.id, title: p.title, category: p.category })),
        describedProducts: textOnly.map(p => ({ id: p.id, title: p.title, category: p.category })),
        generationId,
        generatedAt: new Date().toISOString()
      };
    } else {
      result = { status: 'FAILED', imageUrl: null, message: lastError?.message || 'Image generation failed', generationId, generatedAt: new Date().toISOString() };
    }

    // Ignore the result if the user uploaded a different photo meanwhile
    if (db.getSession(sessionId).currentGenerationId !== generationId) {
      console.warn('[Image Generation Agent] A newer room photo was uploaded; discarding this image.');
      return null;
    }
    db.saveGeneratedImage(sessionId, result);
    return result;
  }
}

module.exports = new ImageGenAgent();
module.exports.buildPrompt = buildPrompt;
module.exports.correctionFor = correctionFor;
module.exports.productSheet = productSheet;
