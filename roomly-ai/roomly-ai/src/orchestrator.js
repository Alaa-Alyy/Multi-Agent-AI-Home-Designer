const db = require('./storage/database');
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

class RoomlyOrchestrator {
  // Phase 1: Intake to Product Selection (Pauses at USER_SELECTION)
  async executePipelineUntilHITL(sessionId, imagePath = null, customPreferences = {}) {
    console.log(`\n======================================================`);
    console.log(`[Roomly Orchestrator] Starting Pipeline for Session: ${sessionId}`);
    console.log(`======================================================`);

    let session = db.getSession(sessionId);
    if (!session) {
      session = db.createSession();
      sessionId = session.sessionId;
    }

    // Step 1: VISION_ANALYSIS
    db.updateSession(sessionId, { status: 'VISION_ANALYSIS' });
    let visionResult = null;
    if (imagePath) {
      visionResult = await visionAgent.analyzeRoom(sessionId, session.roomId, imagePath);
    } else {
      visionResult = db.getVisionAnalysis(sessionId) || await visionAgent.analyzeRoom(sessionId, session.roomId, 'default_room.jpg');
    }

    // Step 2: PREFERENCE_ANALYSIS
    db.updateSession(sessionId, { status: 'PREFERENCE_ANALYSIS' });
    const consolidatedPrefs = preferenceAgent.consolidatePreferences(sessionId, customPreferences);

    // Step 3: RAG_LOOKUP
    db.updateSession(sessionId, { status: 'RAG_LOOKUP' });
    const ragContext = await ragAgent.lookupDesignRules(sessionId);

    // Step 4: BUDGET_ALLOCATION
    db.updateSession(sessionId, { status: 'BUDGET_ALLOCATION' });
    const budgetAlloc = budgetAgent.allocateBudget(sessionId);

    // Step 5: PRODUCT_SEARCH
    db.updateSession(sessionId, { status: 'PRODUCT_SEARCH' });
    const searchData = await searchAgent.searchProductsForAllocations(sessionId);

    // Step 6: RANK_AND_PRESENT
    db.updateSession(sessionId, { status: 'RANK_AND_PRESENT' });
    const rankedData = rankingAgent.rankProducts(sessionId);

    // Step 7: USER_SELECTION (Pause at HITL)
    db.updateSession(sessionId, { status: 'USER_SELECTION' });
    const hitlState = hitlManager.pauseForUserSelection(sessionId);

    console.log(`[Roomly Orchestrator] Pipeline reached HUMAN-IN-THE-LOOP stage. Waiting for user product confirmation.`);

    return {
      sessionId,
      status: 'AWAITING_USER_SELECTION',
      vision: visionResult,
      preferences: consolidatedPrefs,
      rag: ragContext,
      budget: budgetAlloc,
      search: searchData,
      rankings: rankedData,
      hitl: hitlState
    };
  }

  // Phase 2: Resume after Human-in-the-Loop selection
  async resumePipelineAfterSelection(sessionId, selectedProducts, lang = 'en') {
    console.log(`\n======================================================`);
    console.log(`[Roomly Orchestrator] Resuming Pipeline Post-Selection for: ${sessionId} (Language: ${lang})`);
    console.log(`======================================================`);

    // Step 7 confirmation
    const hitlState = hitlManager.confirmUserSelection(sessionId, selectedProducts);

    // Step 7.5: PLACEMENT_PLANNING (Explicit layout mapping)
    db.updateSession(sessionId, { status: 'PLACEMENT_PLANNING' });
    const placementPlan = placementAgent.generatePlacementPlan(sessionId, hitlState.selectedProducts);

    // Step 8: IMAGE_GENERATION (Furnished room rendering with validation)
    db.updateSession(sessionId, { status: 'IMAGE_GENERATION' });
    const imageResult = await imageGenAgent.generateAfterImage(sessionId);

    // Step 9: FINAL_RESULT
    db.updateSession(sessionId, { status: 'FINAL_RESULT' });
    const finalDesign = finalDesigner.synthesizeFinalPackage(sessionId, lang);

    console.log(`[Roomly Orchestrator] Pipeline COMPLETED successfully for session: ${sessionId}\n`);

    return {
      sessionId,
      status: 'COMPLETED',
      hitl: hitlState,
      placement: placementPlan,
      image: imageResult,
      finalDesign
    };
  }
}

module.exports = new RoomlyOrchestrator();
