// Orchestrator: runs the agents in order.
// Phase 1 (after the conversation): vision → preferences → RAG → budget → search → ranking → pause for the user.
// Phase 2 (after the user chooses): placement → image generation → final package.
const db = require('./storage/database');
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

async function step(sessionId, status, fn) {
  db.updateSession(sessionId, { status });
  const started = Date.now();
  const result = await fn();
  db.logExecution(sessionId, status, `${status} finished in ${Date.now() - started} ms`);
  return result;
}

class RoomlyOrchestrator {
  async executePipelineUntilHITL(sessionId) {
    const session = db.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    console.log(`\n[Roomly Orchestrator] Designing for session ${sessionId}`);

    const vision = await step(sessionId, 'VISION_ANALYSIS', () => visionAgent.analyzeRoom(sessionId, session.roomId, session.originalImagePath));
    const preferences = await step(sessionId, 'PREFERENCE_ANALYSIS', () => preferenceAgent.consolidatePreferences(sessionId));
    const rag = await step(sessionId, 'RAG_LOOKUP', () => ragAgent.lookupDesignRules(sessionId));
    const budget = await step(sessionId, 'BUDGET_ALLOCATION', () => budgetAgent.allocateBudget(sessionId));
    const search = await step(sessionId, 'PRODUCT_SEARCH', () => searchAgent.searchProductsForAllocations(sessionId));
    const rankings = await step(sessionId, 'RANK_AND_PRESENT', () => rankingAgent.rankProducts(sessionId));
    const hitl = await step(sessionId, 'USER_SELECTION', () => hitlManager.pauseForUserSelection(sessionId));

    return { sessionId, status: 'AWAITING_USER_SELECTION', vision, preferences, rag, budget, search, rankings, hitl };
  }

  async resumePipelineAfterSelection(sessionId, selection, lang = 'en') {
    console.log(`\n[Roomly Orchestrator] Continuing after the user's choice for session ${sessionId}`);
    const hitl = hitlManager.confirmUserSelection(sessionId, selection);
    const placement = await step(sessionId, 'PLACEMENT_PLANNING', () => placementAgent.generatePlacementPlan(sessionId, hitl.selectedProducts));
    const image = await step(sessionId, 'IMAGE_GENERATION', () => imageGenAgent.generateAfterImage(sessionId));
    const finalDesign = await step(sessionId, 'FINAL_RESULT', () => finalDesigner.synthesizeFinalPackage(sessionId, lang));
    return { sessionId, status: 'COMPLETED', hitl, placement, image, finalDesign };
  }
}

module.exports = new RoomlyOrchestrator();
