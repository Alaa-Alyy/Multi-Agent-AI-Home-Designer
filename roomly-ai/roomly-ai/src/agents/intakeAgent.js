// Conversational intake: asks the user one question at a time until the design brief is complete.
// Each user turn uses two model calls:
//   1) extraction: strict JSON, temperature 0, only pulls facts out of the user's message
//   2) reply: natural Egyptian Arabic / English, told exactly which question to ask next
// The final summary is built in code, so it always matches the saved brief.
const db = require('../storage/database');
const ai = require('../ai');
const { ITEMS, ITEM_KEYS, DEFAULT_ITEMS, itemLabel } = require('../knowledge/items');

const STYLES = ['modern', 'classic', 'minimalist', 'scandinavian', 'japandi', 'bohemian', 'industrial', 'mid_century_modern', 'modern_farmhouse', 'coastal'];
const ROOM_TYPES = ['living_room', 'bedroom', 'home_office', 'dining_room', 'kids_room', 'other'];
const OCCUPANTS = ['adults', 'children', 'pets', 'children_and_pets'];
const REQUIRED = ['roomType', 'items', 'preferredStyle', 'colors', 'budget'];

const LABELS = {
  roomType: { living_room: ['Living room', 'أوضة معيشة'], bedroom: ['Bedroom', 'أوضة نوم'], home_office: ['Home office', 'مكتب'], dining_room: ['Dining room', 'سفرة'], kids_room: ["Kids' room", 'أوضة أطفال'], other: ['Room', 'أوضة'] },
  style: { modern: ['Modern', 'مودرن'], classic: ['Classic', 'كلاسيك'], minimalist: ['Minimalist', 'مينيمال'], scandinavian: ['Scandinavian', 'إسكندنافي'], japandi: ['Japandi', 'جاباندي'], bohemian: ['Bohemian', 'بوهيمي'], industrial: ['Industrial', 'إندستريال'], mid_century_modern: ['Mid-century modern', 'ميد سينشري'], modern_farmhouse: ['Modern farmhouse', 'فارم هاوس'], coastal: ['Coastal', 'ساحلي'] },
  occupants: { adults: ['Adults', 'كبار بس'], children: ['With children', 'فيه أطفال'], pets: ['With pets', 'فيه حيوانات أليفة'], children_and_pets: ['Children and pets', 'أطفال وحيوانات أليفة'] }
};
const label = (group, key, lang) => (LABELS[group][key] || [key, key])[lang === 'ar' ? 1 : 0];

// What to ask about, in order, with example answers in each language
const QUESTIONS = {
  roomType: { en: 'which room this is (suggest your guess from the photo)', ar: 'دي أنهي أوضة (اقترح تخمينك من الصورة)', ex: { en: 'living room, bedroom, home office, dining room', ar: 'معيشة، نوم، مكتب، سفرة' } },
  keepItems: { en: 'which of the existing furniture they want to keep', ar: 'عايز يحتفظ بأنهي حاجة من العفش الموجود', ex: { en: 'keep the sofa, keep nothing', ar: 'سيب الكنبة، مش عايز أحتفظ بحاجة' } },
  items: { en: 'which items they want to buy, or whether you should suggest a list', ar: 'عايز يشتري إيه بالظبط، ولا تقترح عليه انت', ex: { en: 'sofa, coffee table, rug, or "suggest for me"', ar: 'كنبة، ترابيزة، سجادة، أو "اقترح انت"' } },
  preferredStyle: { en: 'which interior style they like', ar: 'بيحب أنهي ستايل', ex: { en: 'modern, classic, minimalist, bohemian', ar: 'مودرن، كلاسيك، مينيمال، بوهيمي' } },
  colors: { en: 'which colours they like and any they dislike', ar: 'بيحب أنهي ألوان، وفيه ألوان مش بيحبها؟', ex: { en: 'beige and green, no red', ar: 'بيج وأخضر، ومش بحب الأحمر' } },
  occupants: { en: 'who uses the room: only adults, children, or pets', ar: 'مين هيستخدم الأوضة: كبار بس، فيه أطفال، ولا حيوانات أليفة', ex: { en: 'just adults, we have a cat', ar: 'كبار بس، عندنا قطة' } },
  budget: { en: 'their total budget in Egyptian pounds', ar: 'الميزانية الكلية بالجنيه', ex: { en: '25,000 EGP', ar: '٢٥ ألف جنيه' } }
};

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    roomType: { type: 'string', enum: ROOM_TYPES },
    items: { type: 'array', items: { type: 'string', enum: ITEM_KEYS } },
    removeItems: { type: 'array', items: { type: 'string', enum: ITEM_KEYS } },
    useDefaultItems: { type: 'boolean' },
    keepItems: { type: 'array', items: { type: 'string' } },
    keepNothing: { type: 'boolean' },
    preferredStyle: { type: 'string', enum: STYLES },
    colors: { type: 'array', items: { type: 'string' } },
    colorsToAvoid: { type: 'array', items: { type: 'string' } },
    occupants: { type: 'string', enum: OCCUPANTS },
    budget: { type: 'number' },
    notes: { type: 'string' }
  }
};

const EXTRACT_PROMPT = `Extract interior-design facts from the USER'S LAST MESSAGE only. Output JSON. Include only fields the user actually stated.
- roomType: living_room | bedroom | home_office | dining_room | kids_room | other. "معيشة/ريسبشن/صالة" = living_room, "نوم" = bedroom, "مكتب" = home_office, "سفرة" = dining_room, "أطفال" = kids_room.
- items: furniture they want to BUY, as keys from: ${ITEM_KEYS.join(', ')}. كنبة=sofa, فوتيه=armchair, ترابيزة/ترابيزة وسط=coffee_table, سجادة=rug, ستارة/ستائر=curtains, أباجورة=floor_lamp or table_lamp, نجفة=ceiling_light, تابلوه=wall_art, سرير=bed, كومودينو=nightstand, دولاب=wardrobe, مكتب=desk, سفرة=dining_table.
- removeItems: items they say they do NOT want.
- useDefaultItems: true if they ask you to suggest/choose the items ("اقترح انت", "انت اختار", "suggest", "list for me", "you decide").
- Fix obvious spelling mistakes in item names too ("coffe table" = coffee_table, "soffa" = sofa).
- keepItems: existing furniture to keep. keepNothing: true if they keep nothing.
- preferredStyle: one of ${STYLES.join(', ')}.
- colors / colorsToAvoid: colour names in English. Fix obvious spelling mistakes to the closest real colour ("buge"/"bege" = beige, "brgundy" = burgundy, "grean" = green); never change a word into an unrelated colour.
- occupants: adults | children | pets | children_and_pets. Any cat/dog/قطة/كلب = pets. Kids/أطفال/ولاد = children.
- budget: total in EGP as a number. "40 ألف" or "٤٠ ألف" = 40000. "مليون" = 1000000.
- notes: other wishes (e.g. needs storage, loves plants), in English.`;

function detectLanguage(text, fallback = 'en') {
  return /[؀-ۿ]/.test(text || '') ? 'ar' : fallback;
}

function missingFields(prefs) {
  return REQUIRED.filter(f => {
    const v = prefs?.[f];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}

// The next thing to ask about: required fields plus optional ones asked once
function nextField(prefs, vision) {
  const asked = prefs.askedFields || [];
  const order = ['roomType'];
  if (vision && !vision.isEmptyRoom) order.push('keepItems');
  order.push('items', 'preferredStyle', 'colors', 'occupants', 'budget');
  return order.find(f => {
    if (f === 'keepItems') return !asked.includes('keepItems') && !prefs.keepItems;
    if (f === 'occupants') return !asked.includes('occupants') && !prefs.occupants;
    return missingFields(prefs).includes(f);
  }) || null;
}

function cleanUpdates(u, prefs) {
  const out = {};
  if (!u || typeof u !== 'object') return out;
  if (ROOM_TYPES.includes(u.roomType)) out.roomType = u.roomType;
  if (STYLES.includes(u.preferredStyle)) out.preferredStyle = u.preferredStyle;
  if (OCCUPANTS.includes(u.occupants)) out.occupants = u.occupants;

  const room = out.roomType || prefs.roomType || 'other';
  let items = Array.isArray(prefs.items) ? [...prefs.items] : [];
  if (u.useDefaultItems) items = [...(DEFAULT_ITEMS[room] || DEFAULT_ITEMS.other)];
  else if (Array.isArray(u.items)) items = [...items, ...u.items.filter(k => ITEMS[k])];
  if (Array.isArray(u.removeItems)) items = items.filter(k => !u.removeItems.includes(k));
  items = [...new Set(items)];
  if (items.length || u.useDefaultItems || Array.isArray(u.items)) out.items = items;

  if (u.keepNothing) out.keepItems = [];
  else if (Array.isArray(u.keepItems) && u.keepItems.length) out.keepItems = u.keepItems.map(String);
  if (Array.isArray(u.colors) && u.colors.length) out.colors = [...new Set(u.colors.map(c => String(c).toLowerCase()))];
  if (Array.isArray(u.colorsToAvoid) && u.colorsToAvoid.length) {
    out.colorsToAvoid = [...new Set([...(prefs.colorsToAvoid || []), ...u.colorsToAvoid.map(c => String(c).toLowerCase())])];
  }
  const budget = Number(u.budget);
  if (Number.isFinite(budget) && budget >= 500 && budget <= 5000000) out.budget = Math.round(budget);
  if (typeof u.notes === 'string' && u.notes.trim()) {
    const existing = prefs.notes ? prefs.notes.split(' | ') : [];
    if (!existing.includes(u.notes.trim())) out.notes = [...existing, u.notes.trim()].join(' | ');
  }
  return out;
}

// Keyword safety net: pets and children matter for safety rules, so never miss them
function detectOccupants(text, current) {
  const t = (text || '').toLowerCase();
  const pets = /(قط[ةه]|قطط|كلب|كلاب|حيوان|cat|dog|pet|puppy|kitten)/.test(t);
  const kids = /(طفل|أطفال|اطفال|ولاد|عيال|بيبي|kid|child|children|baby|toddler)/.test(t);
  if (!pets && !kids) return current;
  const hasPets = pets || current === 'pets' || current === 'children_and_pets';
  const hasKids = kids || current === 'children' || current === 'children_and_pets';
  return hasPets && hasKids ? 'children_and_pets' : hasPets ? 'pets' : 'children';
}

// Keyword safety net: "suggest for me" style answers to the items question
function wantsSuggestion(text) {
  return /(اقترح|اقتراح|انت اختار|إنت اختار|اختار انت|اختارلي|على ذوقك|زي ما تشوف|اللي تشوفه|انت قرر|قائمة|suggest|recommend|you choose|you pick|you decide|up to you|your choice|for me|a list|make a list|surprise me|whatever you)/i.test(text || '');
}

const COLOR_AR = {
  beige: 'بيج', white: 'أبيض', 'off-white': 'أوف وايت', black: 'أسود', grey: 'رمادي', gray: 'رمادي', brown: 'بني',
  green: 'أخضر', 'olive green': 'أخضر زيتي', olive: 'زيتي', blue: 'أزرق', navy: 'كحلي', red: 'أحمر', pink: 'بمبي',
  yellow: 'أصفر', mustard: 'مستردة', orange: 'برتقالي', purple: 'موف', gold: 'دهبي', cream: 'كريمي', wood: 'خشبي', neutral: 'ألوان هادية'
};
const colorName = (c, lang) => (lang === 'ar' ? COLOR_AR[c] || c : c);

function formatMoney(n, lang) {
  return lang === 'ar' ? `${Number(n).toLocaleString('ar-EG')} جنيه` : `${Number(n).toLocaleString('en-US')} EGP`;
}

// Summary built from the saved brief, so it is always accurate
function summary(prefs, lang) {
  const ar = lang === 'ar';
  const items = (prefs.items || []).map(k => itemLabel(k, lang)).join(ar ? '، ' : ', ');
  const lines = [
    ar ? 'تمام، ده ملخص اللي اتفقنا عليه:' : "Great, here's your design brief:",
    `• ${ar ? 'الأوضة' : 'Room'}: ${label('roomType', prefs.roomType, lang)}`,
    `• ${ar ? 'هنشتري' : 'Items'}: ${items}`,
    prefs.keepItems?.length ? `• ${ar ? 'هنحتفظ بـ' : 'Keeping'}: ${prefs.keepItems.join(ar ? '، ' : ', ')}` : null,
    `• ${ar ? 'الستايل' : 'Style'}: ${label('style', prefs.preferredStyle, lang)}`,
    `• ${ar ? 'الألوان' : 'Colours'}: ${prefs.colors.map(c => colorName(c, lang)).join(ar ? '، ' : ', ')}${prefs.colorsToAvoid?.length ? (ar ? ` (من غير: ${prefs.colorsToAvoid.map(c => colorName(c, lang)).join('، ')})` : ` (avoid: ${prefs.colorsToAvoid.join(', ')})`) : ''}`,
    prefs.occupants ? `• ${ar ? 'المستخدمين' : 'Household'}: ${label('occupants', prefs.occupants, lang)}` : null,
    `• ${ar ? 'الميزانية' : 'Budget'}: ${formatMoney(prefs.budget, lang)}`,
    '',
    ar ? 'لو كله تمام دوس على زرار **ابدأ التصميم**، ولو عايز تغيّر حاجة قولّي.' : 'If this looks right, press **Start design**. Or tell me what to change.'
  ];
  return lines.filter(l => l !== null).join('\n');
}

function describeRoom(vision) {
  if (!vision) return 'No photo analysed yet.';
  const f = (vision.furnitureAndObjects || []).map(x => x.name).join(', ');
  return `Room type guess: ${vision.roomType}. ${vision.isEmptyRoom ? 'The room is empty.' : `Existing furniture: ${f}.`} Walls: ${vision.colorPaletteDetected?.dominantWallColor || 'unknown'}. Floor: ${vision.architecturalElements?.flooring || 'unknown'}. Windows: ${vision.architecturalElements?.windows?.count ?? 'unknown'}.`;
}

const STYLE_GUIDE = {
  ar: `اكتب بالعامية المصرية زي ما الناس بتتكلم، مش فصحى.
استخدم: "أوضة" مش "غرفة"، "كنبة" مش "أريكة"، "ترابيزة" مش "طاولة"، "عايز" مش "تريد"، "تمام" مش "حسناً"، "إيه" مش "ماذا".
مثال لسؤال كويس: "تمام! طيب بتحب أنهي ستايل؟ مثلاً مودرن، كلاسيك، مينيمال، ولا بوهيمي؟"`,
  en: 'Write in friendly, simple English.'
};

async function writeReply({ lang, vision, prefs, field, opening }) {
  const q = QUESTIONS[field];
  const task = opening
    ? `In one short sentence say what you see in the room photo (from the facts below). Then ask about ${q[lang === 'ar' ? 'ar' : 'en']}. Give examples like: ${q.ex[lang === 'ar' ? 'ar' : 'en']}.`
    : `Briefly acknowledge the user's last message in a few words, then ask about ${q[lang === 'ar' ? 'ar' : 'en']}. Give examples like: ${q.ex[lang === 'ar' ? 'ar' : 'en']}.`;
  const ask = temperature => ai.chat([
    { role: 'system', content: `You are Roomly, a friendly interior design assistant in Egypt.
${STYLE_GUIDE[lang === 'ar' ? 'ar' : 'en']}
Write at most 2 short sentences. Ask exactly ONE question. Output only the message text: no JSON, no labels, no quotes.
Never mention prices, products, links or delivery.
ROOM PHOTO FACTS: ${describeRoom(vision)}
BRIEF SO FAR: ${JSON.stringify({ roomType: prefs.roomType, items: prefs.items, style: prefs.preferredStyle, colors: prefs.colors, budget: prefs.budget })}` },
    ...(prefs._lastUserMessage ? [{ role: 'user', content: prefs._lastUserMessage }] : []),
    { role: 'user', content: `TASK: ${task}` }
  ], { maxTokens: 160, temperature });
  const clean = t => String(t || '').replace(/\{[\s\S]*\}/g, '').replace(/^["'\s]+|["'\s]+$/g, '').trim();

  // Models occasionally return an empty message: retry once, then use a written question
  let text = '';
  for (const temperature of [0.5, 0.8]) {
    try {
      text = clean(await ask(temperature));
    } catch (err) {
      console.warn(`[Intake Agent] Reply failed: ${err.message}`);
    }
    if (text.length >= 8) return text;
  }
  return FALLBACK_QUESTIONS[field][lang === 'ar' ? 'ar' : 'en'];
}

const FALLBACK_QUESTIONS = {
  roomType: { ar: 'تمام! دي أنهي أوضة؟ معيشة، نوم، مكتب، ولا سفرة؟', en: 'Which room is this? Living room, bedroom, home office or dining room?' },
  keepItems: { ar: 'فيه حاجة من العفش الموجود عايز تحتفظ بيها؟', en: 'Is there any existing furniture you want to keep?' },
  items: { ar: 'عايز تشتري إيه بالظبط؟ كنبة، ترابيزة، سجادة... ولا أقترح عليك أنا؟', en: 'What would you like to buy? A sofa, coffee table, rug... or shall I suggest a list?' },
  preferredStyle: { ar: 'بتحب أنهي ستايل؟ مودرن، كلاسيك، مينيمال، ولا بوهيمي؟', en: 'Which style do you like? Modern, classic, minimalist or bohemian?' },
  colors: { ar: 'بتحب أنهي ألوان؟ وفيه ألوان مش بتحبها؟', en: 'Which colours do you like, and any you dislike?' },
  occupants: { ar: 'مين هيستخدم الأوضة؟ كبار بس، فيه أطفال، ولا عندكم حيوانات أليفة؟', en: 'Who uses the room: only adults, children, or pets?' },
  budget: { ar: 'الميزانية الكلية كام بالجنيه؟ مثلاً ٢٥ ألف جنيه.', en: 'What is your total budget in Egyptian pounds? For example 25,000 EGP.' }
};

class IntakeAgent {
  // First message after the photo has been analysed
  async openingMessage(sessionId, lang = 'en') {
    const prefs = db.savePreferences(sessionId, { language: lang, currency: 'EGP' });
    const vision = db.getVisionAnalysis(sessionId)?.analysis;
    const field = nextField(prefs, vision);
    const reply = field ? await writeReply({ lang, vision, prefs, field, opening: true }) : summary(prefs, lang);
    if (field) this.markAsked(sessionId, field);
    db.addChatMessage(sessionId, 'assistant', reply);
    return this.state(sessionId, reply);
  }

  async processUserMessage(sessionId, messageText, lang = 'en') {
    if (!db.getSession(sessionId)) sessionId = db.createSession().sessionId;
    const language = detectLanguage(messageText, lang);
    db.addChatMessage(sessionId, 'user', messageText);

    const before = db.getPreferences(sessionId) || {};
    const vision = db.getVisionAnalysis(sessionId)?.analysis;

    // 1) Extract facts from the message
    let extracted = {};
    try {
      extracted = await ai.chat([
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: `Assistant's last question was about: ${(before.askedFields || []).slice(-1)[0] || 'room type'}.\nUSER'S LAST MESSAGE: ${messageText}` }
      ], { schema: EXTRACT_SCHEMA, temperature: 0, maxTokens: 400 });
    } catch (err) {
      console.warn('[Intake Agent] Extraction failed:', err.message);
    }
    if (process.env.ROOMLY_DEBUG) console.log('[Intake Agent] extracted:', JSON.stringify(extracted));
    if (!before.items?.length && !extracted?.items?.length && wantsSuggestion(messageText)) {
      extracted = { ...extracted, useDefaultItems: true };
    }
    const updates = cleanUpdates(extracted, before);
    const occupants = detectOccupants(messageText, updates.occupants || before.occupants);
    if (occupants) updates.occupants = occupants;
    const prefs = db.savePreferences(sessionId, { ...updates, language, currency: 'EGP' });

    // 2) Ask the next question, or summarise when the brief is complete
    const field = nextField(prefs, vision);
    let reply;
    if (field) {
      reply = await writeReply({ lang: language, vision, prefs: { ...prefs, _lastUserMessage: messageText }, field });
      this.markAsked(sessionId, field);
    } else {
      reply = summary(prefs, language);
    }
    db.addChatMessage(sessionId, 'assistant', reply);
    return this.state(sessionId, reply);
  }

  markAsked(sessionId, field) {
    const prefs = db.getPreferences(sessionId) || {};
    const asked = new Set(prefs.askedFields || []);
    asked.add(field);
    db.savePreferences(sessionId, { askedFields: [...asked] });
  }

  state(sessionId, reply) {
    const preferences = db.getPreferences(sessionId) || {};
    const missing = missingFields(preferences);
    return {
      sessionId,
      reply,
      preferences,
      missing,
      readyToDesign: missing.length === 0,
      itemLabels: (preferences.items || []).map(k => ({ key: k, en: itemLabel(k, 'en'), ar: itemLabel(k, 'ar') }))
    };
  }
}

module.exports = new IntakeAgent();
module.exports.missingFields = missingFields;
module.exports.cleanUpdates = cleanUpdates;
module.exports.nextField = nextField;
module.exports.detectOccupants = detectOccupants;
module.exports.wantsSuggestion = wantsSuggestion;
module.exports.STYLES = STYLES;
