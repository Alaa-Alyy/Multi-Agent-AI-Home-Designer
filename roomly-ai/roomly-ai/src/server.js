const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const db = require('./storage/database');
const orchestrator = require('./orchestrator');
const intakeAgent = require('./agents/intakeAgent');
const visionAgent = require('./agents/visionAgent');
const preferenceAgent = require('./agents/preferenceAgent');
const ragAgent = require('./agents/ragAgent');
const budgetAgent = require('./agents/budgetAgent');
const searchAgent = require('./agents/searchAgent');
const rankingAgent = require('./agents/rankingAgent');
const hitlManager = require('./agents/hitlManager');
const placementAgent = require('./agents/placementAgent');
const imageGenAgent = require('./agents/imageGenAgent');
const finalDesigner = require('./agents/finalDesigner');
const priceWatcher = require('./agents/priceWatcher');

const app = express();
const PORT = process.env.PORT || 3000;
const storageDir = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, '../data');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static asset delivery
app.use(express.static(path.join(__dirname, '../public')));
app.use('/data/uploads', express.static(path.join(storageDir, 'uploads')));
app.use('/data/generated', express.static(path.join(storageDir, 'generated')));

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(storageDir, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `room_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});
const upload = multer({ storage });

// ==========================================
// ROOM-REDECORATION API ENDPOINTS
// ==========================================

// 1. Create or Get Session
app.post('/api/session', (req, res) => {
  const session = db.createSession(req.body);
  res.json({ success: true, session });
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = db.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const vision = db.getVisionAnalysis(req.params.sessionId);
  const preferences = db.getPreferences(req.params.sessionId);
  const rag = db.getRAGContext(req.params.sessionId);
  const budget = db.getBudgetAllocation(req.params.sessionId);
  const search = db.getProductSearch(req.params.sessionId);
  const rankings = db.getProductRankings(req.params.sessionId);
  const hitl = db.getHITLState(req.params.sessionId);
  const placement = placementAgent.getPlacementPlan(req.params.sessionId);
  const generatedImage = db.getGeneratedImage(req.params.sessionId);
  const finalDesign = db.getFinalDesign(req.params.sessionId);
  const logs = db.getExecutionLogs(req.params.sessionId);

  res.json({
    session,
    vision,
    preferences,
    rag,
    budget,
    search,
    rankings,
    hitl,
    placement,
    generatedImage,
    finalDesign,
    logs
  });
});

// 2. Chat & Intake Message
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message, lang = 'en' } = req.body;
    const result = await intakeAgent.processUserMessage(sessionId, message);
    
    if (lang === 'ar') {
      result.reply = `مرحباً بك في Roomly AI! تم استلام رسالتك وتحديث تفضيلات التصميم بنجاح. سنواصل العمل على تصميم غرفتك بأعلى معايير التناسق والراحة.`;
    }
    
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Upload Room Image & Register New Image Identity
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId || db.createSession().sessionId;
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const imagePath = req.file.path;
    const relativeUrl = `/data/uploads/${path.basename(imagePath)}`;

    // Register image and trigger cache invalidation for new image
    const { session, isNew, imageHash } = db.registerNewImage(sessionId, imagePath, relativeUrl);

    db.addChatMessage(sessionId, 'user', 'Uploaded new room photo for redesign', {
      imageUrl: relativeUrl,
      fileName: req.file.originalname,
      imageHash,
      isNew
    });

    res.json({
      success: true,
      sessionId,
      roomId: session.roomId,
      imageId: session.imageId,
      imageHash,
      designVersion: session.designVersion,
      isNewImage: isNew,
      imagePath,
      imageUrl: relativeUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Run Pipeline Until HITL Selection
app.post('/api/pipeline/start', async (req, res) => {
  try {
    const { sessionId, customPreferences } = req.body;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const imagePath = session.originalImagePath;
    const result = await orchestrator.executePipelineUntilHITL(sessionId, imagePath, customPreferences || {});
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Pipeline error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Human-in-the-loop: Confirm Selection & Continue with Placement + Furnished Image Gen + Final Result
app.post('/api/hitl/confirm', async (req, res) => {
  try {
    const { sessionId, selectedProducts, lang = 'en' } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!Array.isArray(selectedProducts)) return res.status(400).json({ error: 'selectedProducts array is required' });

    const result = await orchestrator.resumePipelineAfterSelection(sessionId, selectedProducts, lang);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('HITL confirmation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Direct Node-level Endpoints for n8n Webhook / Subworkflow Integration
app.post('/api/nodes/vision', async (req, res) => {
  const { sessionId, roomId, imagePath } = req.body;
  const analysis = await visionAgent.analyzeRoom(sessionId, roomId, imagePath);
  res.json(analysis);
});

app.post('/api/nodes/rag', async (req, res) => {
  const { sessionId } = req.body;
  const rag = await ragAgent.lookupDesignRules(sessionId);
  res.json(rag);
});

app.post('/api/nodes/budget', (req, res) => {
  const { sessionId } = req.body;
  const budget = budgetAgent.allocateBudget(sessionId);
  res.json(budget);
});

app.post('/api/nodes/search', async (req, res) => {
  const { sessionId } = req.body;
  const search = await searchAgent.searchProductsForAllocations(sessionId);
  res.json(search);
});

app.post('/api/nodes/rank', (req, res) => {
  const { sessionId } = req.body;
  const rankings = rankingAgent.rankProducts(sessionId);
  res.json(rankings);
});

app.post('/api/nodes/placement', (req, res) => {
  const { sessionId, selectedProducts } = req.body;
  const plan = placementAgent.generatePlacementPlan(sessionId, selectedProducts || []);
  res.json(plan);
});

app.post('/api/nodes/image-gen', async (req, res) => {
  const { sessionId } = req.body;
  const img = await imageGenAgent.generateAfterImage(sessionId);
  res.json(img);
});

app.post('/api/nodes/final-designer', (req, res) => {
  const { sessionId, lang = 'en' } = req.body;
  const finalPkg = finalDesigner.synthesizeFinalPackage(sessionId, lang);
  res.json(finalPkg);
});

// 7. System & Health Check
app.get('/api/health', (req, res) => {
  const searchProvider = searchAgent.getActiveProvider();
  res.json({
    status: 'HEALTHY',
    service: 'Roomly AI Redecoration Platform',
    timestamp: new Date().toISOString(),
    credentials: {
      openai: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== ''),
      serpapi: Boolean(process.env.SERPAPI_API_KEY && process.env.SERPAPI_API_KEY.trim() !== ''),
      rainforest: Boolean(process.env.RAINFOREST_API_KEY && process.env.RAINFOREST_API_KEY.trim() !== ''),
      rapidapi: Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_KEY.trim() !== '')
    },
    activeSearchProvider: searchProvider.name
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Roomly AI Platform Server running on http://localhost:${PORT}`);
  console.log(`📊 Knowledge Base: Seeded and Ready`);
  console.log(`🔌 n8n Workflow Integration Endpoints: Active`);
  console.log(`🎨 Web App Interface: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
