const db = require('../storage/database');

class HITLManager {
  // Pause workflow and prepare options for user review
  pauseForUserSelection(sessionId) {
    const rankings = db.getProductRankings(sessionId);
    const budgetAllocation = db.getBudgetAllocation(sessionId);

    console.log(`[HITL Manager] Pausing workflow for session ${sessionId}. Awaiting Human-in-the-loop product selection.`);

    const defaultSelections = (rankings?.recommendedSet || []).map(p => p.id);
    const totalSelectedPrice = (rankings?.recommendedSet || []).reduce((sum, p) => sum + (p.price || 0), 0);

    const hitlState = {
      status: 'WAITING_FOR_USER_SELECTION',
      pausedAt: new Date().toISOString(),
      availableCategories: rankings?.rankedByCategory || {},
      selectedProductIds: defaultSelections,
      selectedProducts: rankings?.recommendedSet || [],
      totalSelectedPrice,
      budgetRemaining: (budgetAllocation?.totalBudget || 0) - totalSelectedPrice
    };

    db.saveHITLState(sessionId, hitlState);
    db.updateSession(sessionId, { status: 'USER_SELECTION_PENDING' });

    return hitlState;
  }

  // Handle user's confirmed selection payload (from UI or Webhook)
  confirmUserSelection(sessionId, selectedProductsList) {
    console.log(`[HITL Manager] Received user confirmation for session ${sessionId} with ${selectedProductsList.length} products.`);
    const budgetAllocation = db.getBudgetAllocation(sessionId);

    // Validate and preserve complete canonical product schema as immutable data
    const validatedProducts = selectedProductsList.map((p, idx) => ({
      id: p.id || `sel_prod_${idx + 1}`,
      title: (p.title || 'Selected Item').trim(),
      category: p.category || 'Decor',
      price: typeof p.price === 'number' ? p.price : parseFloat(p.price || 0),
      currency: p.currency || 'USD',
      image_url: p.image_url || '',
      product_url: p.product_url || null,
      canonical_url: p.canonical_url || p.product_url || null,
      site: p.site || 'Verified Partner',
      rating: p.rating !== undefined ? p.rating : null,
      dimensions: p.dimensions || {},
      source: p.source || p.site || 'selection',
      placementNote: p.placementNote || `Place in accordance with ${p.category} spatial rules.`
    }));

    const totalSelectedPrice = validatedProducts.reduce((sum, p) => sum + (p.price || 0), 0);
    const totalBudget = budgetAllocation?.totalBudget || 0;

    const hitlState = {
      status: 'SELECTION_CONFIRMED',
      confirmedAt: new Date().toISOString(),
      selectedProducts: validatedProducts,
      selectedProductIds: validatedProducts.map(p => p.id),
      totalSelectedPrice,
      budgetRemaining: totalBudget - totalSelectedPrice
    };

    db.saveHITLState(sessionId, hitlState);
    db.updateSession(sessionId, { status: 'SELECTION_CONFIRMED' });

    return hitlState;
  }
}

module.exports = new HITLManager();
