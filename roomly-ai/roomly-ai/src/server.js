const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('./storage/database');
const ai = require('./ai');
const orchestrator = require('./orchestrator');
const intakeAgent = require('./agents/intakeAgent');
const visionAgent = require('./agents/visionAgent');
const ragAgent = require('./agents/ragAgent');
const budgetAgent = require('./agents/budgetAgent');
const searchAgent = require('./agents/searchAgent');
const rankingAgent = require('./agents/rankingAgent');
const placementAgent = require('./agents/placementAgent');
const imageGenAgent = require('./agents/imageGenAgent');
const finalDesigner = require('./agents/finalDesigner');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/data/uploads', express.static(db.uploadsDir));
app.use('/data/generated', express.static(db.generatedDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, db.uploadsDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype))
});

// Errors the user should understand, in their language
function sendError(res, err, lang = 'en') {
  const ar = lang === 'ar';
  if (err.code === 'DAILY_AI_LIMIT') {
    return res.status(429).json({ error: ar
      ? 'الكمية المجانية من الذكاء الاصطناعي خلصت دلوقتي عند كل الخدمات. جرّب تاني بعد شوية.'
      : err.message, code: err.code });
  }
  if (err.code === 'AI_UNAVAILABLE' || err.code === 'MISSING_CLOUDFLARE_CREDENTIALS') {
    return res.status(503).json({ error: ar ? 'خدمة الذكاء الاصطناعي مش متاحة دلوقتي. جرّب تاني بعد شوية.' : err.message, code: err.code });
  }
  if (err.code === 'BRIEF_INCOMPLETE') {
    return res.status(400).json({ error: ar ? 'لسه محتاجين نكمّل كام سؤال قبل التصميم.' : err.message, code: err.code, missing: err.missing });
  }
  console.error(err);
  return res.status(500).json({ error: err.message });
}

const wrap = handler => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    sendError(res, err, req.body?.lang);
  }
};

// ---------- session ----------
app.post('/api/session', (req, res) => res.json({ success: true, session: db.createSession() }));

app.get('/api/session/:sessionId', (req, res) => {
  const id = req.params.sessionId;
  const session = db.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    session,
    vision: db.getVisionAnalysis(id)?.analysis || null,
    preferences: db.getPreferences(id),
    rag: db.getRAGContext(id),
    budget: db.getBudgetAllocation(id),
    search: db.getProductSearch(id),
    rankings: db.getProductRankings(id),
    hitl: db.getHITLState(id),
    placement: placementAgent.getPlacementPlan(id),
    generatedImage: db.getGeneratedImage(id),
    finalDesign: db.getFinalDesign(id)
  });
});

// ---------- 1. upload the room photo: analyse it and start the conversation ----------
app.post('/api/upload', upload.single('image'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please upload a JPG, PNG or WEBP photo (max 15 MB).' });
  const lang = req.body.lang === 'ar' ? 'ar' : 'en';
  const sessionId = req.body.sessionId && db.getSession(req.body.sessionId) ? req.body.sessionId : db.createSession().sessionId;
  const imageUrl = `/data/uploads/${path.basename(req.file.path)}`;
  const { session } = db.registerNewImage(sessionId, req.file.path, imageUrl);

  const vision = await visionAgent.analyzeRoom(session.sessionId, session.roomId, req.file.path);
  const chat = await intakeAgent.openingMessage(session.sessionId, lang);
  res.json({ success: true, sessionId: session.sessionId, imageUrl, vision, chat });
}));

// ---------- 2. conversation ----------
app.post('/api/chat', wrap(async (req, res) => {
  const { sessionId, message, lang = 'en' } = req.body;
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'Empty message' });
  const result = await intakeAgent.processUserMessage(sessionId, String(message).slice(0, 2000), lang);
  res.json({ success: true, result });
}));

// ---------- 3. design: run until the user chooses products ----------
app.post('/api/pipeline/start', wrap(async (req, res) => {
  const { sessionId } = req.body;
  if (!db.getSession(sessionId)) return res.status(404).json({ error: 'Session not found' });
  const result = await orchestrator.executePipelineUntilHITL(sessionId);
  res.json({ success: true, ...result });
}));

// ---------- 4. the user's choice: render the room and build the final package ----------
app.post('/api/hitl/confirm', wrap(async (req, res) => {
  const { sessionId, selectedProductIds, selectedProducts, lang = 'en' } = req.body;
  const selection = selectedProductIds || selectedProducts;
  if (!sessionId || !Array.isArray(selection)) return res.status(400).json({ error: 'sessionId and selectedProductIds are required' });
  const result = await orchestrator.resumePipelineAfterSelection(sessionId, selection, lang);
  res.json({ success: true, ...result });
}));

// Retry only the image (e.g. after the daily limit resets)
app.post('/api/image/retry', wrap(async (req, res) => {
  const { sessionId, lang = 'en' } = req.body;
  const image = await imageGenAgent.generateAfterImage(sessionId);
  const finalDesign = finalDesigner.synthesizeFinalPackage(sessionId, lang);
  res.json({ success: true, image, finalDesign });
}));

// ---------- single-agent endpoints (used by the n8n workflows) ----------
app.post('/api/nodes/vision', wrap(async (req, res) => {
  const s = db.getSession(req.body.sessionId);
  res.json(await visionAgent.analyzeRoom(req.body.sessionId, s?.roomId, s?.originalImagePath));
}));
app.post('/api/nodes/rag', wrap(async (req, res) => res.json(await ragAgent.lookupDesignRules(req.body.sessionId))));
app.post('/api/nodes/budget', wrap(async (req, res) => res.json(budgetAgent.allocateBudget(req.body.sessionId))));
app.post('/api/nodes/search', wrap(async (req, res) => res.json(await searchAgent.searchProductsForAllocations(req.body.sessionId))));
app.post('/api/nodes/rank', wrap(async (req, res) => res.json(rankingAgent.rankProducts(req.body.sessionId))));
app.post('/api/nodes/image-gen', wrap(async (req, res) => res.json(await imageGenAgent.generateAfterImage(req.body.sessionId))));
app.post('/api/nodes/final-designer', wrap(async (req, res) => res.json(finalDesigner.synthesizeFinalPackage(req.body.sessionId, req.body.lang))));

// ---------- health ----------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'Roomly AI',
    timestamp: new Date().toISOString(),
    credentials: {
      ai: ai.isConfigured(),
      cloudflare: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
      groq: Boolean(process.env.GROQ_API_KEY),
      huggingface: Boolean(process.env.HF_TOKEN),
      serpapi: Boolean(process.env.SERPAPI_API_KEY)
    },
    aiProviders: ai.status(),
    activeSearchProvider: searchAgent.getActiveProvider().name,
    knowledgeIndexReady: fs.existsSync(path.join(__dirname, 'knowledge/vectorIndex.json'))
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nRoomly AI running on http://localhost:${PORT}`);
    const s = ai.status();
    console.log(`AI providers (in order): chat ${s.chat.join(' → ') || 'NONE'} | vision ${s.vision.join(' → ') || 'NONE'} | image ${s.image.join(' → ') || 'NONE'} | embeddings ${s.embed.join(' → ') || 'NONE'}`);
    console.log(`Product search: ${searchAgent.getActiveProvider().name}\n`);
  });
}

module.exports = app;
