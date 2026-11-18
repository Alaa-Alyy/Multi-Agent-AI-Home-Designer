// Ranking agent: scores every verified product, then picks one per item so the total stays within budget.
const db = require('../storage/database');
const { itemLabel } = require('../knowledge/items');

function scoreProduct(p, alloc, prefs, styleWords) {
  const text = `${p.title} ${(p.colors || []).join(' ')}`.toLowerCase();
  const breakdown = {};

  // Budget fit (0-40): best at or a little under the item's share
  const ratio = p.price / Math.max(1, alloc.allocatedAmount);
  breakdown.budgetFit = Math.round(40 * (ratio <= 1 ? 1 - Math.max(0, 0.6 - ratio) : Math.max(0, 1 - (ratio - 1) * 2)));

  // Colour match (0-20)
  const liked = (prefs.colors || []).filter(c => c !== 'neutral');
  const avoid = prefs.colorsToAvoid || [];
  const likedHit = liked.some(c => c.split(/\s+/).some(w => w.length > 2 && text.includes(w)));
  const avoidHit = avoid.some(c => text.includes(c));
  breakdown.colorMatch = avoidHit ? -20 : likedHit ? 20 : liked.length ? 5 : 10;

  // Style words from RAG (0-15)
  const hits = styleWords.filter(w => text.includes(w)).length;
  breakdown.styleMatch = Math.min(15, hits * 5);

  // Ratings and reviews (0-15)
  breakdown.rating = p.rating ? Math.round((p.rating / 5) * 10 + Math.min(5, Math.log10(1 + (p.reviewsCount || 0)) * 2)) : 4;

  // Store reliability (0-10): official store, not sponsored
  breakdown.store = p.source === 'ikea' ? 10 : p.sponsored ? 3 : 6;

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { score: Math.max(0, Math.min(100, total)), breakdown };
}

// Pick one product per item; if over budget, keep swapping the item that saves the most for the
// smallest loss in score, until the set fits.
function pickWithinBudget(groups, spendable) {
  const choice = Object.fromEntries(groups.map(g => [g.itemKey, 0]));
  const total = () => groups.reduce((s, g) => s + (g.products[choice[g.itemKey]]?.price || 0), 0);

  let guard = 0;
  while (total() > spendable && guard++ < 200) {
    let best = null;
    for (const g of groups) {
      const current = g.products[choice[g.itemKey]];
      if (!current) continue;
      g.products.forEach((alt, idx) => {
        if (alt.price >= current.price) return;
        const saving = current.price - alt.price;
        const loss = Math.max(1, current.rankingScore - alt.rankingScore);
        const value = saving / loss;
        if (!best || value > best.value) best = { itemKey: g.itemKey, idx, value };
      });
    }
    if (!best) break; // nothing cheaper left
    choice[best.itemKey] = best.idx;
  }
  return { choice, total: total(), fits: total() <= spendable };
}

class RankingAgent {
  rankProducts(sessionId) {
    const search = db.getProductSearch(sessionId);
    const budget = db.getBudgetAllocation(sessionId);
    const rag = db.getRAGContext(sessionId);
    const prefs = db.getPreferences(sessionId) || {};
    const lang = prefs.language === 'ar' ? 'ar' : 'en';

    const styleWords = [...(rag?.retrievedStyle?.materials || []), ...(rag?.retrievedStyle?.keyElements || [])]
      .flatMap(s => s.toLowerCase().split(/[\s,/]+/)).filter(w => w.length > 3);

    const groups = (budget?.allocations || []).map(alloc => {
      const products = (search?.products || [])
        .filter(p => p.category === alloc.itemKey)
        .map(p => {
          const { score, breakdown } = scoreProduct(p, alloc, prefs, styleWords);
          return { ...p, rankingScore: score, scoreBreakdown: breakdown };
        })
        .sort((a, b) => b.rankingScore - a.rankingScore);
      return {
        itemKey: alloc.itemKey,
        category: alloc.itemKey,
        label: itemLabel(alloc.itemKey, lang),
        allocatedBudget: alloc.allocatedAmount,
        targetPriceRange: alloc.targetPriceRange,
        products
      };
    });

    const withProducts = groups.filter(g => g.products.length);
    const { choice, total, fits } = pickWithinBudget(withProducts, budget.spendable);

    const result = {
      currency: 'EGP',
      totalRanked: withProducts.reduce((s, g) => s + g.products.length, 0),
      rankedByCategory: Object.fromEntries(groups.map(g => [g.itemKey, g])),
      itemsWithoutResults: groups.filter(g => !g.products.length).map(g => g.itemKey),
      recommendedSet: withProducts.map(g => g.products[choice[g.itemKey]]).filter(Boolean),
      recommendedTotal: total,
      fitsBudget: fits,
      budget: budget.totalBudget,
      spendable: budget.spendable
    };
    console.log(`[Ranking Agent] Recommended set: ${result.recommendedSet.length} items, ${total} EGP of ${budget.totalBudget} EGP (${fits ? 'fits' : 'over budget'})`);
    db.saveProductRankings(sessionId, result);
    return result;
  }
}

module.exports = new RankingAgent();
module.exports.pickWithinBudget = pickWithinBudget;
module.exports.scoreProduct = scoreProduct;
