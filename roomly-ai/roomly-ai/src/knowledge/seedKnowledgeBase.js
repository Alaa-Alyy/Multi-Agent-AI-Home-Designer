// Builds vectorIndex.json: every knowledge-base entry as a document with a bge-m3 embedding.
// Run once after editing knowledgeBase.json:  npm run seed
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const ai = require('../ai');

const kbPath = path.join(__dirname, 'knowledgeBase.json');
const outputPath = path.join(__dirname, 'vectorIndex.json');

function buildDocuments(kb) {
  const docs = [];
  kb.styles.forEach(s => docs.push({
    id: `style_${s.id}`, type: 'style', title: `${s.name} interior style`,
    content: `${s.name}: ${s.description} Key elements: ${s.keyElements.join(', ')}. Materials: ${s.materials.join(', ')}. Signature pieces: ${s.signaturePieces.join(', ')}.`,
    metadata: { styleId: s.id }
  }));
  kb.colorRules.forEach((r, i) => docs.push({
    id: `color_rule_${i + 1}`, type: 'color_rule', title: r.name, content: `Colour rule: ${r.name}. ${r.rule}`, metadata: { category: r.category }
  }));
  kb.spatialRules.forEach((r, i) => docs.push({
    id: `spatial_rule_${i + 1}`, type: 'spatial_rule', title: r.name, content: `Layout rule for ${r.roomType}: ${r.name}. ${r.rule}`, metadata: { roomType: r.roomType }
  }));
  kb.safetyAndOccupantRules.forEach((r, i) => docs.push({
    id: `safety_rule_${i + 1}`, type: 'safety_rule', title: r.name, content: `Safety rule for homes with ${r.occupant}: ${r.rule}`, metadata: { occupant: r.occupant }
  }));
  return docs;
}

async function seedKnowledgeBase() {
  const kb = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  const documents = buildDocuments(kb);
  console.log(`Embedding ${documents.length} knowledge documents with ${ai.MODELS.embed}...`);
  const vectors = await ai.embed(documents.map(d => `${d.title}. ${d.content}`));
  documents.forEach((d, i) => { d.embedding = vectors[i].map(v => Number(v.toFixed(5))); });

  const index = { generatedAt: new Date().toISOString(), model: ai.MODELS.embed, totalDocuments: documents.length, documents };
  fs.writeFileSync(outputPath, JSON.stringify(index), 'utf-8');
  console.log(`Saved ${documents.length} embedded documents to vectorIndex.json`);
  return index;
}

if (require.main === module) {
  seedKnowledgeBase().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { seedKnowledgeBase, buildDocuments };
