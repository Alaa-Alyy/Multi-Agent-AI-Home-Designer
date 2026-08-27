const fs = require('fs');
const path = require('path');

const kbPath = path.join(__dirname, 'knowledgeBase.json');
const outputPath = path.join(__dirname, 'vectorIndex.json');

function seedKnowledgeBase() {
  console.log('Seeding Roomly AI Knowledge Base...');
  if (!fs.existsSync(kbPath)) {
    throw new Error(`Knowledge base file not found at ${kbPath}`);
  }

  const raw = fs.readFileSync(kbPath, 'utf-8');
  const kb = JSON.parse(raw);

  const documents = [];

  // 1. Process Styles
  kb.styles.forEach(style => {
    documents.push({
      id: `style_${style.id}`,
      type: 'style',
      title: `${style.name} Interior Design Style`,
      content: `${style.name}: ${style.description}. Key Elements: ${style.keyElements.join(', ')}. Materials: ${style.materials.join(', ')}. Signature Pieces: ${style.signaturePieces.join(', ')}.`,
      metadata: {
        styleId: style.id,
        styleName: style.name,
        materials: style.materials,
        recommendedColors: style.recommendedColors,
        signaturePieces: style.signaturePieces
      }
    });
  });

  // 2. Process Color Rules
  kb.colorRules.forEach((rule, idx) => {
    documents.push({
      id: `color_rule_${idx + 1}`,
      type: 'color_rule',
      title: rule.name,
      content: `Color Rule: ${rule.name}. Category: ${rule.category}. Guideline: ${rule.rule}`,
      metadata: {
        category: rule.category,
        ruleName: rule.name
      }
    });
  });

  // 3. Process Spatial Rules
  kb.spatialRules.forEach((rule, idx) => {
    documents.push({
      id: `spatial_rule_${idx + 1}`,
      type: 'spatial_rule',
      title: rule.name,
      content: `Spatial Rule: ${rule.name}. Room Type: ${rule.roomType}. Category: ${rule.category}. Rule: ${rule.rule}`,
      metadata: {
        roomType: rule.roomType,
        category: rule.category,
        ruleName: rule.name
      }
    });
  });

  // 4. Process Safety and Occupant Rules
  kb.safetyAndOccupantRules.forEach((rule, idx) => {
    documents.push({
      id: `safety_rule_${idx + 1}`,
      type: 'safety_rule',
      title: rule.name,
      content: `Safety & Occupant Rule: ${rule.name}. Occupant Type: ${rule.occupant}. Guideline: ${rule.rule}`,
      metadata: {
        occupant: rule.occupant,
        ruleName: rule.name
      }
    });
  });

  // Build lightweight TF-IDF / Term Frequency Vector Index for local retrieval
  const index = {
    generatedAt: new Date().toISOString(),
    totalDocuments: documents.length,
    documents
  };

  fs.writeFileSync(outputPath, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`Knowledge Base indexed successfully! ${documents.length} design documents processed into vectorIndex.json`);
  return index;
}

if (require.main === module) {
  seedKnowledgeBase();
}

module.exports = { seedKnowledgeBase };
