const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class RoomlyDatabase {
  constructor(storageDir = path.join(__dirname, '../../data')) {
    this.storageDir = storageDir;
    this.dbFilePath = path.join(this.storageDir, 'roomly_db.json');
    this.uploadsDir = path.join(this.storageDir, 'uploads');
    this.generatedDir = path.join(this.storageDir, 'generated');
    this.init();
  }

  init() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(this.generatedDir)) {
      fs.mkdirSync(this.generatedDir, { recursive: true });
    }

    if (!fs.existsSync(this.dbFilePath)) {
      const initialSchema = {
        sessions: {},
        rooms: {},
        preferences: {},
        vision_analyses: {},
        rag_contexts: {},
        budget_allocations: {},
        product_searches: {},
        product_rankings: {},
        hitl_states: {},
        placement_plans: {},
        generated_images: {},
        final_designs: {},
        execution_logs: [],
        price_watchlist: []
      };
      fs.writeFileSync(this.dbFilePath, JSON.stringify(initialSchema, null, 2), 'utf-8');
    }
  }

  read() {
    try {
      const data = fs.readFileSync(this.dbFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading database:', err);
      return {};
    }
  }

  write(data) {
    try {
      const tempPath = `${this.dbFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.dbFilePath);
    } catch (err) {
      console.error('Error writing database:', err);
    }
  }

  computeFileHash(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);
      }
    } catch (e) {
      console.warn('Error hashing file:', e.message);
    }
    return crypto.createHash('sha256').update(filePath || Date.now().toString()).digest('hex').substring(0, 16);
  }

  // Session Operations
  createSession(metadata = {}) {
    const db = this.read();
    const sessionId = uuidv4();
    const roomId = uuidv4();

    const session = {
      sessionId,
      roomId,
      imageId: null,
      imageHash: null,
      designVersion: 1,
      currentGenerationId: uuidv4(),
      status: 'INTAKE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { ...metadata },
      chatHistory: [
        {
          role: 'assistant',
          content: 'Hello! I am Roomly AI, your interior design copilot. Upload a photo of the room you would like to redesign and tell me your goals, preferred style, and budget to get started.',
          timestamp: new Date().toISOString()
        }
      ]
    };

    db.sessions[sessionId] = session;
    this.write(db);
    this.logExecution(sessionId, 'INTAKE', 'Session created', { sessionId, roomId });
    return session;
  }

  getSession(sessionId) {
    const db = this.read();
    return db.sessions[sessionId] || null;
  }

  updateSession(sessionId, updates) {
    const db = this.read();
    if (db.sessions[sessionId]) {
      db.sessions[sessionId] = {
        ...db.sessions[sessionId],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this.write(db);
      return db.sessions[sessionId];
    }
    return null;
  }

  // Image Upload & State Invalidation Rule
  registerNewImage(sessionId, imagePath, originalUrl) {
    const db = this.read();
    let session = db.sessions[sessionId];
    if (!session) {
      session = this.createSession();
      sessionId = session.sessionId;
    }

    const newImageHash = this.computeFileHash(imagePath);
    const isDifferentImage = session.imageHash !== newImageHash || !session.imageId;

    if (isDifferentImage) {
      const newImageId = uuidv4();
      const newRoomId = uuidv4();
      const newGenerationId = uuidv4();
      const newVersion = (session.designVersion || 0) + 1;

      console.log(`[Database] NEW ROOM IMAGE DETECTED for session ${sessionId}.`);
      console.log(`[Database] Invalidating image-specific caches (Image Hash: ${newImageHash}, Version: ${newVersion}). Preserving user preferences.`);

      // Update session identity
      session.imageId = newImageId;
      session.imageHash = newImageHash;
      session.roomId = newRoomId;
      session.designVersion = newVersion;
      session.currentGenerationId = newGenerationId;
      session.originalImagePath = imagePath;
      session.originalImageUrl = originalUrl;
      session.status = 'NEW_IMAGE_UPLOADED';
      session.updatedAt = new Date().toISOString();

      // INVENTORIED RESET OF IMAGE-SPECIFIC STATE:
      // Clear vision, placement, searches, rankings, HITL selection, generated image, final design for this session
      delete db.vision_analyses[sessionId];
      delete db.placement_plans[sessionId];
      delete db.product_searches[sessionId];
      delete db.product_rankings[sessionId];
      delete db.hitl_states[sessionId];
      delete db.generated_images[sessionId];
      delete db.final_designs[sessionId];

      db.sessions[sessionId] = session;
      this.write(db);

      this.logExecution(sessionId, 'IMAGE_REGISTERED', 'New image registered; stale room state invalidated', {
        imageId: newImageId,
        imageHash: newImageHash,
        designVersion: newVersion,
        roomId: newRoomId
      });

      return { session, isNew: true, imageHash: newImageHash };
    }

    return { session, isNew: false, imageHash: newImageHash };
  }

  addChatMessage(sessionId, role, content, metadata = {}) {
    const db = this.read();
    if (db.sessions[sessionId]) {
      const msg = {
        id: uuidv4(),
        role,
        content,
        metadata,
        timestamp: new Date().toISOString()
      };
      db.sessions[sessionId].chatHistory.push(msg);
      db.sessions[sessionId].updatedAt = new Date().toISOString();
      this.write(db);
      return msg;
    }
    return null;
  }

  // Vision Analysis (Keyed by image identity)
  saveVisionAnalysis(sessionId, roomId, imageHash, analysis) {
    const db = this.read();
    const cacheKey = `${sessionId}:${imageHash}`;
    db.vision_analyses[sessionId] = {
      sessionId,
      roomId,
      imageHash,
      cacheKey,
      analysis,
      analyzedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'VISION_ANALYSIS', 'Vision analysis saved for image', {
      imageHash,
      roomType: analysis.roomType
    });
    return db.vision_analyses[sessionId];
  }

  getVisionAnalysis(sessionId) {
    const db = this.read();
    return db.vision_analyses[sessionId] || null;
  }

  // Preferences (Preserved across image changes)
  savePreferences(sessionId, preferences) {
    const db = this.read();
    const existing = db.preferences[sessionId] || {};
    db.preferences[sessionId] = {
      ...existing,
      ...preferences,
      sessionId,
      updatedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'PREFERENCE_ANALYSIS', 'Preferences updated', db.preferences[sessionId]);
    return db.preferences[sessionId];
  }

  getPreferences(sessionId) {
    const db = this.read();
    return db.preferences[sessionId] || null;
  }

  // RAG Context
  saveRAGContext(sessionId, ragResult) {
    const db = this.read();
    db.rag_contexts[sessionId] = {
      sessionId,
      ...ragResult,
      retrievedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'RAG_LOOKUP', 'RAG context retrieved', {
      rulesCount: ragResult.rules?.length || 0,
      palettesCount: ragResult.palettes?.length || 0
    });
    return db.rag_contexts[sessionId];
  }

  getRAGContext(sessionId) {
    const db = this.read();
    return db.rag_contexts[sessionId] || null;
  }

  // Budget Allocations
  saveBudgetAllocation(sessionId, allocationData) {
    const db = this.read();
    db.budget_allocations[sessionId] = {
      sessionId,
      ...allocationData,
      allocatedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'BUDGET_ALLOCATION', 'Budget allocated', allocationData);
    return db.budget_allocations[sessionId];
  }

  getBudgetAllocation(sessionId) {
    const db = this.read();
    return db.budget_allocations[sessionId] || null;
  }

  // Product Search & Rankings
  saveProductSearch(sessionId, searchData) {
    const db = this.read();
    db.product_searches[sessionId] = {
      sessionId,
      ...searchData,
      searchedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'PRODUCT_SEARCH', 'Product search executed', {
      provider: searchData.provider,
      status: searchData.status,
      count: searchData.products?.length || 0
    });
    return db.product_searches[sessionId];
  }

  getProductSearch(sessionId) {
    const db = this.read();
    return db.product_searches[sessionId] || null;
  }

  saveProductRankings(sessionId, rankedData) {
    const db = this.read();
    db.product_rankings[sessionId] = {
      sessionId,
      ...rankedData,
      rankedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'RANK_AND_PRESENT', 'Products ranked', {
      categories: Object.keys(rankedData.rankedByCategory || {}).length
    });
    return db.product_rankings[sessionId];
  }

  getProductRankings(sessionId) {
    const db = this.read();
    return db.product_rankings[sessionId] || null;
  }

  // HITL State
  saveHITLState(sessionId, hitlData) {
    const db = this.read();
    db.hitl_states[sessionId] = {
      sessionId,
      ...hitlData,
      updatedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'USER_SELECTION', `HITL State: ${hitlData.status}`, {
      selectedCount: hitlData.selectedProducts?.length || 0,
      totalAmount: hitlData.totalSelectedPrice || 0
    });
    return db.hitl_states[sessionId];
  }

  getHITLState(sessionId) {
    const db = this.read();
    return db.hitl_states[sessionId] || null;
  }

  // Placement Plans
  savePlacementPlan(sessionId, placementPlan) {
    const db = this.read();
    db.placement_plans = db.placement_plans || {};
    db.placement_plans[sessionId] = {
      sessionId,
      ...placementPlan,
      updatedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'PLACEMENT_PLAN', 'Placement plan saved', {
      itemsCount: placementPlan.placements?.length || 0
    });
    return db.placement_plans[sessionId];
  }

  getPlacementPlan(sessionId) {
    const db = this.read();
    return db.placement_plans?.[sessionId] || null;
  }

  // Generated Image (With Generation Request Verification)
  saveGeneratedImage(sessionId, imageData) {
    const db = this.read();
    db.generated_images[sessionId] = {
      sessionId,
      ...imageData,
      generatedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'IMAGE_GENERATION', 'Image generation completed', {
      generationId: imageData.generationId,
      imageHash: imageData.imageHash,
      status: imageData.status
    });
    return db.generated_images[sessionId];
  }

  getGeneratedImage(sessionId) {
    const db = this.read();
    return db.generated_images[sessionId] || null;
  }

  // Final Design Result
  saveFinalDesign(sessionId, designData) {
    const db = this.read();
    db.final_designs[sessionId] = {
      sessionId,
      ...designData,
      completedAt: new Date().toISOString()
    };
    this.write(db);
    this.logExecution(sessionId, 'FINAL_RESULT', 'Final redesign package synthesized', {
      style: designData.summary?.style,
      totalCost: designData.budget?.estimatedTotal
    });
    return db.final_designs[sessionId];
  }

  getFinalDesign(sessionId) {
    const db = this.read();
    return db.final_designs[sessionId] || null;
  }

  // Execution Logging (Audit Trail)
  logExecution(sessionId, step, message, payload = {}) {
    const db = this.read();
    const logEntry = {
      id: uuidv4(),
      sessionId,
      step,
      message,
      payload,
      timestamp: new Date().toISOString()
    };
    db.execution_logs.push(logEntry);
    this.write(db);
    return logEntry;
  }

  getExecutionLogs(sessionId = null) {
    const db = this.read();
    if (sessionId) {
      return db.execution_logs.filter(log => log.sessionId === sessionId);
    }
    return db.execution_logs;
  }

  // Price Watchlist Operations
  addToPriceWatchlist(product) {
    const db = this.read();
    const item = {
      id: uuidv4(),
      ...product,
      initialPrice: product.price,
      lastCheckedPrice: product.price,
      lastCheckedAt: new Date().toISOString(),
      status: 'IN_STOCK',
      priceAlerts: []
    };
    db.price_watchlist.push(item);
    this.write(db);
    return item;
  }

  getPriceWatchlist() {
    const db = this.read();
    return db.price_watchlist;
  }

  updateWatchlistItem(id, updates) {
    const db = this.read();
    const idx = db.price_watchlist.findIndex(item => item.id === id);
    if (idx !== -1) {
      db.price_watchlist[idx] = {
        ...db.price_watchlist[idx],
        ...updates,
        lastCheckedAt: new Date().toISOString()
      };
      this.write(db);
      return db.price_watchlist[idx];
    }
    return null;
  }
}

module.exports = new RoomlyDatabase();
