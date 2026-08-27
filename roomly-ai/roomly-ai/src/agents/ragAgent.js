const fs = require('fs');
const path = require('path');
const db = require('../storage/database');

class RAGAgent {
  constructor() {
    this.indexPath = path.join(__dirname, '../knowledge/vectorIndex.json');
    this.kbPath = path.join(__dirname, '../knowledge/knowledgeBase.json');
    this.index = null;
    this.kb = null;
    this.loadIndex();
  }

  loadIndex() {
    if (fs.existsSync(this.indexPath)) {
      this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
    }
    if (fs.existsSync(this.kbPath)) {
      this.kb = JSON.parse(fs.readFileSync(this.kbPath, 'utf-8'));
    }
  }

  async lookupDesignRules(sessionId) {
    if (!this.index || !this.kb) {
      this.loadIndex();
    }

    const preferences = db.getPreferences(sessionId) || {};
    const vision = db.getVisionAnalysis(sessionId);

    const styleId = (preferences.preferredStyle || 'japandi').toLowerCase().replace(/\s+/g, '_');
    const roomType = preferences.roomType || vision?.analysis?.roomType || 'living_room';
    const occupants = preferences.occupants || 'adults';

    console.log(`[RAG Agent] Performing knowledge lookup for Style: ${styleId}, Room: ${roomType}, Occupants: ${occupants}...`);

    // 1. Retrieve Style Definition
    let matchedStyle = this.kb?.styles?.find(s => s.id === styleId || s.id.includes(styleId) || styleId.includes(s.id));
    if (!matchedStyle) {
      matchedStyle = this.kb?.styles?.[0]; // Fallback to Japandi
    }

    // 2. Retrieve Spatial Rules relevant to roomType
    const matchedSpatialRules = (this.kb?.spatialRules || []).filter(
      r => r.roomType === roomType || r.roomType === 'all'
    );

    // 3. Retrieve Color Rules
    const matchedColorRules = this.kb?.colorRules || [];

    // 4. Retrieve Safety & Occupant Rules
    const matchedSafetyRules = (this.kb?.safetyAndOccupantRules || []).filter(r => {
      if (occupants.includes('children') || occupants.includes('toddler')) {
        return r.occupant === 'children';
      }
      if (occupants.includes('pet') || occupants.includes('dog') || occupants.includes('cat')) {
        return r.occupant === 'pets';
      }
      return false;
    });

    // 5. Query Vector Document Index for semantic ranking
    const queryTerms = `${styleId} ${roomType} ${occupants} furniture layout lighting rug seating storage`.toLowerCase().split(/\s+/);
    const scoredDocs = (this.index?.documents || []).map(doc => {
      let score = 0;
      const text = (doc.title + ' ' + doc.content).toLowerCase();
      queryTerms.forEach(term => {
        if (text.includes(term)) score += 1;
      });
      return { doc, score };
    }).sort((a, b) => b.score - a.score);

    const topRankedChunks = scoredDocs.slice(0, 6).map(item => item.doc);

    const ragResult = {
      retrievedStyle: matchedStyle,
      spatialRules: matchedSpatialRules,
      colorRules: matchedColorRules,
      safetyRules: matchedSafetyRules,
      topRankedChunks,
      designDirectives: [
        `Anchor seating with minimum front two legs on a large area rug (recommended 8x10 or 9x12 for ${roomType}).`,
        `Maintain 14-18 inches clearance between sofa edge and coffee table.`,
        `Incorporate 3 layers of illumination: Ambient (ceiling pendant), Task (reading floor lamp), and Accent (warm LED/ceramic light).`,
        `Execute the 60-30-10 color rule: 60% dominant base (${matchedStyle.recommendedColors[0]}), 30% secondary furniture (${matchedStyle.recommendedColors[1]}), 10% accent textures (${matchedStyle.recommendedColors[4] || matchedStyle.recommendedColors[3]}).`,
        ...(matchedSafetyRules.length > 0 ? matchedSafetyRules.map(s => `Safety Directive: ${s.rule}`) : [])
      ]
    };

    db.saveRAGContext(sessionId, ragResult);
    return ragResult;
  }
}

module.exports = new RAGAgent();
