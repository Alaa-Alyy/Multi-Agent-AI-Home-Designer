// RAG: retrieves the design knowledge most relevant to this brief, by meaning (bge-m3 embeddings).
const fs = require('fs');
const path = require('path');
const db = require('../storage/database');
const ai = require('../ai');

const indexPath = path.join(__dirname, '../knowledge/vectorIndex.json');
const kbPath = path.join(__dirname, '../knowledge/knowledgeBase.json');

class RAGAgent {
  constructor() {
    this.index = null;
    this.kb = null;
  }

  load() {
    if (!this.kb) this.kb = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
    if (!this.index) {
      if (!fs.existsSync(indexPath)) throw new Error('Knowledge index missing. Run: npm run seed');
      this.index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      if (!this.index.documents?.[0]?.embedding) throw new Error('Knowledge index has no embeddings. Run: npm run seed');
    }
  }

  buildQuery(prefs, vision) {
    const parts = [
      `${prefs.preferredStyle || ''} style ${String(prefs.roomType || '').replace('_', ' ')}`,
      prefs.colors?.length ? `colours ${prefs.colors.join(', ')}` : '',
      prefs.items?.length ? `furniture: ${prefs.items.join(', ').replace(/_/g, ' ')}` : '',
      prefs.occupants && prefs.occupants !== 'adults' ? `home with ${prefs.occupants.replace(/_/g, ' ')}` : '',
      vision?.availableFreeSpace === 'tight' ? 'small room' : '',
      prefs.notes || ''
    ];
    return parts.filter(Boolean).join('. ');
  }

  async lookupDesignRules(sessionId) {
    this.load();
    const prefs = db.getPreferences(sessionId) || {};
    const vision = db.getVisionAnalysis(sessionId)?.analysis;
    const query = this.buildQuery(prefs, vision);
    console.log(`[RAG Agent] Query: "${query}"`);

    // Meaning-based search; if no embedding provider is available, fall back to keyword overlap
    let retrieval = 'embeddings';
    let scoreOf;
    try {
      const [queryVector] = await ai.embed([query]);
      scoreOf = doc => ai.cosine(queryVector, doc.embedding);
    } catch (err) {
      console.warn(`[RAG Agent] Embeddings unavailable (${err.message}); using keyword matching.`);
      retrieval = 'keywords';
      const terms = query.toLowerCase().split(/[^a-z؀-ۿ]+/).filter(w => w.length > 2);
      scoreOf = doc => {
        const text = `${doc.title} ${doc.content}`.toLowerCase();
        return terms.filter(t => text.includes(t)).length / Math.max(1, terms.length);
      };
    }
    const ranked = this.index.documents
      .map(doc => ({ doc, score: scoreOf(doc) }))
      .sort((a, b) => b.score - a.score);

    const style = this.kb.styles.find(s => s.id === prefs.preferredStyle)
      || this.kb.styles.find(s => s.id === ranked.find(r => r.doc.type === 'style')?.doc.metadata.styleId)
      || this.kb.styles[0];

    const room = prefs.roomType;
    const occupants = prefs.occupants || 'adults';
    const safetyRules = this.kb.safetyAndOccupantRules.filter(r =>
      (occupants.includes('children') && r.occupant === 'children') || (occupants.includes('pets') && r.occupant === 'pets'));

    // Top rules by meaning, always keeping the ones for this room type
    const topRules = ranked.filter(r => r.doc.type !== 'style').slice(0, 6).map(r => ({ ...r.doc, score: Number(r.score.toFixed(3)) }));
    const roomRules = this.kb.spatialRules.filter(r => r.roomType === room || r.roomType === 'all');

    const result = {
      query,
      retrieval,
      retrievedStyle: style,
      spatialRules: roomRules,
      colorRules: this.kb.colorRules,
      safetyRules,
      topRankedChunks: topRules.map(({ embedding, ...rest }) => rest),
      designDirectives: [
        ...topRules.slice(0, 4).map(r => r.content),
        ...safetyRules.map(s => `Safety: ${s.rule}`)
      ]
    };

    db.saveRAGContext(sessionId, result);
    return result;
  }
}

module.exports = new RAGAgent();
