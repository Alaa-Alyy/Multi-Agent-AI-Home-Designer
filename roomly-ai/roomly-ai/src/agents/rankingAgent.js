const db = require('../storage/database');

class RankingAgent {
  rankProducts(sessionId) {
    const searchData = db.getProductSearch(sessionId);
    const budgetAllocation = db.getBudgetAllocation(sessionId);
    const ragContext = db.getRAGContext(sessionId);
    const preferences = db.getPreferences(sessionId) || {};

    const products = searchData?.products || [];
    const styleInfo = ragContext?.retrievedStyle || {};
    const styleKeywords = (styleInfo.keyElements || []).concat(styleInfo.materials || []).map(k => k.toLowerCase());

    console.log(`[Ranking Agent] Scoring and ranking ${products.length} products for session ${sessionId}...`);

    const scoredProducts = products.map(product => {
      let score = 50; // Base score

      // 1. Style Compatibility Score (0-25 pts)
      const text = (product.title + ' ' + (product.description || '')).toLowerCase();
      let keywordHits = 0;
      styleKeywords.forEach(kw => {
        if (text.includes(kw)) keywordHits += 1;
      });
      score += Math.min(25, keywordHits * 5);

      // 2. Budget Fit Score (0-20 pts)
      const categoryAlloc = (budgetAllocation?.allocations || []).find(a => a.category === product.category);
      if (categoryAlloc) {
        const targetPrice = categoryAlloc.allocatedAmount;
        const diffRatio = Math.abs(product.price - targetPrice) / Math.max(1, targetPrice);
        if (product.price <= categoryAlloc.targetPriceRange.max) {
          // Rewarding items within range
          score += Math.max(0, Math.round(20 * (1 - diffRatio)));
        } else {
          // Penalize over-budget items
          score -= 15;
        }
      }

      // 3. Customer Rating Score (0-15 pts)
      if (product.rating > 0) {
        score += Math.round((product.rating / 5) * 15);
      }

      return {
        ...product,
        rankingScore: Math.max(0, Math.min(100, score)),
        scoreBreakdown: {
          styleMatch: Math.min(25, keywordHits * 5),
          budgetFit: product.price <= (categoryAlloc?.targetPriceRange.max || Infinity) ? 15 : 0,
          ratingBonus: Math.round(((product.rating || 4) / 5) * 15)
        }
      };
    });

    // Group ranked products by category
    const rankedByCategory = {};
    const categories = budgetAllocation?.allocations || [];

    categories.forEach(cat => {
      const catProducts = scoredProducts
        .filter(p => p.category === cat.category)
        .sort((a, b) => b.rankingScore - a.rankingScore);

      rankedByCategory[cat.category] = {
        category: cat.category,
        allocatedBudget: cat.allocatedAmount,
        targetPriceRange: cat.targetPriceRange,
        products: catProducts
      };
    });

    const result = {
      totalRanked: scoredProducts.length,
      rankedByCategory,
      recommendedSet: Object.values(rankedByCategory)
        .map(catGroup => catGroup.products[0])
        .filter(Boolean)
    };

    db.saveProductRankings(sessionId, result);
    return result;
  }
}

module.exports = new RankingAgent();
