// LIVE end-to-end check with the real APIs: photo → conversation → design → choice → image.
// Uses the free quotas: about 2,500 Cloudflare neurons and up to 6 SerpAPI searches (cached for 24 h).
// Run with: npm run smoke
const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roomly-smoke-'));

const db = require('../src/storage/database');
const vision = require('../src/agents/visionAgent');
const intake = require('../src/agents/intakeAgent');
const orchestrator = require('../src/orchestrator');

const CONVERSATION = [
  'دي هتبقى أوضة معيشة',
  'اقترح عليا انت الحاجات',
  'بحب المودرن، والألوان البيج والأخضر الزيتي',
  'أنا وجوزي وعندنا قطة',
  'الميزانية ٤٠ ألف جنيه'
];

(async () => {
  const started = Date.now();
  const s = db.createSession();
  const img = path.join(db.uploadsDir, 'smoke_room.png');
  fs.copyFileSync(path.join(__dirname, 'fixtures/empty_room.png'), img);
  const { session } = db.registerNewImage(s.sessionId, img, '/data/uploads/smoke_room.png');
  const id = session.sessionId;

  const v = await vision.analyzeRoom(id, session.roomId, img);
  console.log(`1. Vision: ${v.roomType}, empty=${v.isEmptyRoom}, windows=${v.architecturalElements?.windows?.count}`);

  let st = await intake.openingMessage(id, 'ar');
  console.log(`   Roomly: ${st.reply}`);
  for (const msg of CONVERSATION) {
    await new Promise(r => setTimeout(r, 5000)); // a real person takes a few seconds to answer
    st = await intake.processUserMessage(id, msg, 'ar');
    console.log(`   User: ${msg}\n   Roomly: ${st.reply.replace(/\n/g, '\n           ')}`);
  }
  console.log(`2. Conversation: ready=${st.readyToDesign}, brief=${JSON.stringify({ room: st.preferences.roomType, items: st.preferences.items, style: st.preferences.preferredStyle, budget: st.preferences.budget, occupants: st.preferences.occupants })}`);
  if (!st.readyToDesign) throw new Error(`Brief incomplete: ${st.missing.join(', ')}`);

  const p = await orchestrator.executePipelineUntilHITL(id);
  console.log(`3. Search: ${p.search.totalFound} verified products; recommended ${p.rankings.recommendedSet.length} items for ${p.rankings.recommendedTotal} EGP (fits: ${p.rankings.fitsBudget})`);
  for (const r of p.search.perItem) console.log(`   - ${r.itemKey}: ${JSON.stringify(r.counts)}`);

  const r = await orchestrator.resumePipelineAfterSelection(id, p.rankings.recommendedSet.map(x => x.id), 'ar');
  console.log(`4. Image: ${r.image.status}${r.image.message ? ` (${r.image.message})` : ''}`);
  console.log(`5. Final: ${r.finalDesign.products.length} products, total ${r.finalDesign.budget.estimatedTotal} of ${r.finalDesign.budget.totalAllocated} EGP`);
  for (const prod of r.finalDesign.products) console.log(`   - ${prod.categoryLabel}: ${prod.price} EGP · ${prod.site} · ${prod.product_url}`);
  if (r.image.imageUrl) console.log(`\nAfter image: ${path.join(db.generatedDir, path.basename(r.image.imageUrl))}`);
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s`);
})().catch(err => { console.error('\nSMOKE TEST FAILED:', err.message); process.exit(1); });
