// Budget agent: splits the user's EGP budget across the items they asked for.
// Each item gets a share by weight, a realistic price range, and a search query built from the style and colours.
const db = require('../storage/database');
const { ITEMS, itemLabel } = require('../knowledge/items');

const RESERVE_SHARE = 0.05; // kept aside for delivery and small extras

const STYLE_WORDS = {
  modern: 'modern', classic: 'classic', minimalist: 'minimalist', scandinavian: 'scandinavian', japandi: 'wooden minimalist',
  bohemian: 'boho', industrial: 'industrial metal', mid_century_modern: 'mid century', modern_farmhouse: 'farmhouse wooden', coastal: 'light'
};
// Items where colour matters in the search
const COLOR_ITEMS = new Set(['sofa', 'armchair', 'rug', 'curtains', 'bedding', 'office_chair', 'dining_chair']);

function searchQuery(key, prefs) {
  const item = ITEMS[key];
  const style = STYLE_WORDS[prefs.preferredStyle] || '';
  const color = COLOR_ITEMS.has(key) ? (prefs.colors || []).find(c => c !== 'neutral') || '' : '';
  return [style, color, item.search].filter(Boolean).join(' ').trim();
}

function allocate(prefs) {
  const total = Number(prefs.budget);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Budget is missing from the design brief.');
  const keys = (prefs.items || []).filter(k => ITEMS[k]);
  if (!keys.length) throw new Error('No items in the design brief.');

  const spendable = Math.round(total * (1 - RESERVE_SHARE));
  const weightSum = keys.reduce((s, k) => s + ITEMS[k].weight, 0);
  const lang = prefs.language === 'ar' ? 'ar' : 'en';

  const allocations = keys
    .map(key => {
      const item = ITEMS[key];
      const share = item.weight / weightSum;
      const allocatedAmount = Math.round(spendable * share);
      const underfunded = allocatedAmount < item.minEGP;
      return {
        itemKey: key,
        category: key,
        label: itemLabel(key, lang),
        labelEn: item.en,
        labelAr: item.ar,
        percentage: Math.round(share * 100),
        allocatedAmount,
        priority: item.big ? 1 : 2,
        underfunded,
        // The minimum only filters out covers and accessories; it must NOT grow with the budget,
        // otherwise a large budget leaves no real product in range.
        targetPriceRange: {
          min: item.minEGP,
          max: Math.round(underfunded ? item.minEGP * 1.8 : allocatedAmount * 1.3)
        },
        searchQuery: searchQuery(key, prefs)
      };
    })
    .sort((a, b) => a.priority - b.priority || b.allocatedAmount - a.allocatedAmount);

  return {
    totalBudget: total,
    currency: 'EGP',
    spendable,
    reserveFund: total - spendable,
    allocatedTotal: allocations.reduce((s, a) => s + a.allocatedAmount, 0),
    roomType: prefs.roomType,
    underfundedItems: allocations.filter(a => a.underfunded).map(a => a.itemKey),
    allocations,
    search_queries: allocations.map(a => ({
      category: a.itemKey,
      query: a.searchQuery,
      targetPrice: a.allocatedAmount,
      minPrice: a.targetPriceRange.min,
      maxPrice: a.targetPriceRange.max,
      currency: 'EGP'
    }))
  };
}

class BudgetAgent {
  allocateBudget(sessionId) {
    const prefs = db.getPreferences(sessionId) || {};
    const result = allocate(prefs);
    console.log(`[Budget Agent] ${result.totalBudget} EGP across ${result.allocations.length} items (${result.reserveFund} EGP reserve)`);
    db.saveBudgetAllocation(sessionId, result);
    return result;
  }
}

module.exports = new BudgetAgent();
module.exports.allocate = allocate;
module.exports.searchQuery = searchQuery;
