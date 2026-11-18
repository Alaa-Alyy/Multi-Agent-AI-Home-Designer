// Human-in-the-loop: the pipeline pauses so the user chooses the products.
// The user's choice is matched against our own verified search results, so prices and links
// always come from the search, never from the browser.
const db = require('../storage/database');

class HITLManager {
  pauseForUserSelection(sessionId) {
    const rankings = db.getProductRankings(sessionId);
    const budget = db.getBudgetAllocation(sessionId);
    const recommended = rankings?.recommendedSet || [];
    const totalSelectedPrice = recommended.reduce((s, p) => s + p.price, 0);

    const state = {
      status: 'WAITING_FOR_USER_SELECTION',
      pausedAt: new Date().toISOString(),
      currency: 'EGP',
      availableCategories: rankings?.rankedByCategory || {},
      selectedProductIds: recommended.map(p => p.id),
      selectedProducts: recommended,
      totalSelectedPrice,
      budgetRemaining: (budget?.totalBudget || 0) - totalSelectedPrice
    };
    db.saveHITLState(sessionId, state);
    db.updateSession(sessionId, { status: 'USER_SELECTION_PENDING' });
    console.log(`[HITL Manager] Waiting for the user to choose products (${recommended.length} recommended).`);
    return state;
  }

  // `selection` is a list of product ids, or of objects with an `id`
  confirmUserSelection(sessionId, selection) {
    const rankings = db.getProductRankings(sessionId);
    const budget = db.getBudgetAllocation(sessionId);
    if (!rankings) throw new Error('No product search results for this session. Run the design first.');

    const known = new Map(Object.values(rankings.rankedByCategory || {}).flatMap(g => g.products).map(p => [p.id, p]));
    const ids = (selection || []).map(s => (typeof s === 'string' ? s : s?.id)).filter(Boolean);
    const unknown = ids.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`Unknown product ids: ${unknown.join(', ')}`);

    // At most one product per item
    const perItem = new Map();
    ids.map(id => known.get(id)).forEach(p => perItem.set(p.category, p));
    const selectedProducts = [...perItem.values()];
    const totalSelectedPrice = selectedProducts.reduce((s, p) => s + p.price, 0);

    const state = {
      status: 'SELECTION_CONFIRMED',
      confirmedAt: new Date().toISOString(),
      currency: 'EGP',
      selectedProducts,
      selectedProductIds: selectedProducts.map(p => p.id),
      totalSelectedPrice,
      budgetRemaining: (budget?.totalBudget || 0) - totalSelectedPrice
    };
    db.saveHITLState(sessionId, state);
    db.updateSession(sessionId, { status: 'SELECTION_CONFIRMED' });
    console.log(`[HITL Manager] User chose ${selectedProducts.length} products, ${totalSelectedPrice} EGP.`);
    return state;
  }
}

module.exports = new HITLManager();
