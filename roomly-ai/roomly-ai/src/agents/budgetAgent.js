const fs = require('fs');
const path = require('path');
const db = require('../storage/database');

class BudgetAgent {
  constructor() {
    this.kbPath = path.join(__dirname, '../knowledge/knowledgeBase.json');
    this.kb = null;
    this.loadKB();
  }

  loadKB() {
    if (fs.existsSync(this.kbPath)) {
      this.kb = JSON.parse(fs.readFileSync(this.kbPath, 'utf-8'));
    }
  }

  allocateBudget(sessionId) {
    if (!this.kb) this.loadKB();

    const preferences = db.getPreferences(sessionId) || {};
    const ragContext = db.getRAGContext(sessionId);
    const vision = db.getVisionAnalysis(sessionId);

    const totalBudget = Number(preferences.budget) || 3000;
    const roomType = preferences.roomType || 'living_room';
    const styleName = ragContext?.retrievedStyle?.name || 'Japandi';
    const mustKeep = (preferences.mustKeepFurniture || []).map(f => f.toLowerCase());

    console.log(`[Budget Agent] Calculating deterministic budget allocation for $${totalBudget} (${roomType})...`);

    const model = this.kb?.budgetAllocationModels?.[roomType] || this.kb?.budgetAllocationModels?.['living_room'];
    const baseCategories = model.categories;

    // Filter or adjust if user has must-keep furniture
    let adjustedCategories = baseCategories.map(cat => {
      let weight = cat.defaultPercent;
      let shouldExclude = false;

      if (mustKeep.some(k => cat.category.toLowerCase().includes(k))) {
        weight = 0; // Don't budget for kept items
        shouldExclude = true;
      }
      return { ...cat, activeWeight: weight, shouldExclude };
    }).filter(c => !c.shouldExclude);

    // Normalize weights to sum to 100%
    const totalWeight = adjustedCategories.reduce((sum, c) => sum + c.activeWeight, 0);
    const allocations = [];
    const searchQueries = [];
    let allocatedSum = 0;

    adjustedCategories.forEach(cat => {
      const normalizedPercent = Math.round((cat.activeWeight / totalWeight) * 100);
      const allocatedAmount = Math.round((totalBudget * normalizedPercent) / 100);
      allocatedSum += allocatedAmount;

      const minPrice = Math.round(allocatedAmount * 0.7);
      const maxPrice = Math.round(allocatedAmount * 1.15);

      // Generate targeted search query based on category, style, and room type
      let queryCategoryTerm = '';
      if (cat.category.toLowerCase().includes('seating') || cat.category.toLowerCase().includes('sofa')) {
        queryCategoryTerm = `${styleName} neutral fabric tailored sofa oak base`;
      } else if (cat.category.toLowerCase().includes('table') || cat.category.toLowerCase().includes('coffee')) {
        queryCategoryTerm = `${styleName} natural wood round coffee table`;
      } else if (cat.category.toLowerCase().includes('rug')) {
        queryCategoryTerm = `${styleName} large wool flatweave area rug 8x10 neutral`;
      } else if (cat.category.toLowerCase().includes('lighting')) {
        queryCategoryTerm = `${styleName} architectural arched floor lamp warm light`;
      } else if (cat.category.toLowerCase().includes('art') || cat.category.toLowerCase().includes('decor')) {
        queryCategoryTerm = `${styleName} minimalist textured framed canvas art set`;
      } else if (cat.category.toLowerCase().includes('desk') || cat.category.toLowerCase().includes('chair')) {
        queryCategoryTerm = `${styleName} solid oak ergonomic study desk`;
      } else if (cat.category.toLowerCase().includes('bed')) {
        queryCategoryTerm = `${styleName} low platform upholstered bed frame oak`;
      } else {
        queryCategoryTerm = `${styleName} ${cat.category.split('(')[0].trim()}`;
      }

      allocations.push({
        category: cat.category,
        percentage: normalizedPercent,
        allocatedAmount,
        priority: cat.priority,
        targetPriceRange: {
          min: minPrice,
          max: maxPrice
        },
        searchQuery: queryCategoryTerm
      });

      if (!cat.category.toLowerCase().includes('contingency')) {
        searchQueries.push({
          category: cat.category,
          query: queryCategoryTerm,
          targetPrice: allocatedAmount,
          maxPrice: maxPrice,
          currency: preferences.currency || 'USD'
        });
      }
    });

    // Calculate reserve / contingency
    const reserveFund = Math.max(0, totalBudget - allocatedSum);

    const budgetResult = {
      totalBudget,
      currency: preferences.currency || 'USD',
      allocatedTotal: allocatedSum,
      reserveFund,
      roomType,
      allocations,
      search_queries: searchQueries
    };

    db.saveBudgetAllocation(sessionId, budgetResult);
    return budgetResult;
  }
}

module.exports = new BudgetAgent();
