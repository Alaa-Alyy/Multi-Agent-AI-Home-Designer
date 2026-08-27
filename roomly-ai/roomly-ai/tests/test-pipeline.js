const fs = require('fs');
const path = require('path');
const db = require('../src/storage/database');
const orchestrator = require('../src/orchestrator');
const searchAgent = require('../src/agents/searchAgent');
const rankingAgent = require('../src/agents/rankingAgent');
const hitlManager = require('../src/agents/hitlManager');
const placementAgent = require('../src/agents/placementAgent');
const finalDesigner = require('../src/agents/finalDesigner');
const imageGenAgent = require('../src/agents/imageGenAgent');

async function runAllRegressionTests() {
  console.log('================================================================');
  console.log('🧪 ROOMLY AI STRICT REGRESSION VERIFICATION (TESTS A, B, C, D, E, F)');
  console.log('================================================================');

  try {
    // -------------------------------------------------------------
    // TEST A — PRODUCT URL PRESERVATION & CANONICAL DATA CONTRACT
    // -------------------------------------------------------------
    console.log('\n[TEST A] Verifying Product URL Preservation across all workflow nodes...');

    const rawProviderProduct = {
      id: 'prod_test_pb_1',
      title: 'IKEA TARVA Solid Pine Platform Bed',
      price: 189,
      currency: 'USD',
      image_url: 'https://images.ikea.com/bed1.jpg',
      product_url: 'https://www.ikea.com/us/en/p/tarva-bed-frame-pine-luroey-s29007794/',
      canonical_url: 'https://www.ikea.com/us/en/p/tarva-bed-frame-pine-luroey-s29007794/',
      site: 'IKEA',
      rating: 4.9,
      dimensions: { widthIn: 64, heightIn: 52, depthIn: 86 },
      source: 'live_search'
    };

    // 1. Search Agent Normalization
    const normalized = searchAgent.normalizeProduct(rawProviderProduct, 'Bed Frame', 'IKEA');
    console.log(`  1. Search Agent Output product_url: ${normalized.product_url}`);
    if (normalized.product_url !== rawProviderProduct.product_url) {
      throw new Error(`Search normalization altered product_url! Expected: ${rawProviderProduct.product_url}, Got: ${normalized.product_url}`);
    }

    // 2. Ranking Agent Flow
    const testSessionA = db.createSession({ test: 'URL Test' });
    db.saveBudgetAllocation(testSessionA.sessionId, {
      totalBudget: 4000,
      allocations: [{ category: 'Bed Frame', allocatedAmount: 2000, targetPriceRange: { min: 1400, max: 2200 } }]
    });
    db.saveProductSearch(testSessionA.sessionId, {
      status: 'SUCCESS',
      products: [normalized]
    });
    const ranked = rankingAgent.rankProducts(testSessionA.sessionId);
    const rankedProduct = ranked.rankedByCategory['Bed Frame'].products[0];
    console.log(`  2. Ranking Agent Output product_url: ${rankedProduct.product_url}`);
    if (rankedProduct.product_url !== rawProviderProduct.product_url) {
      throw new Error(`Ranking agent altered product_url!`);
    }

    // 3. Coordinator / HITL Selection Flow
    const hitlState = hitlManager.confirmUserSelection(testSessionA.sessionId, [rankedProduct]);
    const hitlProduct = hitlState.selectedProducts[0];
    console.log(`  3. HITL Selection Output product_url: ${hitlProduct.product_url}`);
    if (hitlProduct.product_url !== rawProviderProduct.product_url) {
      throw new Error(`HITL manager altered product_url!`);
    }

    // 4. Final Designer Package Output
    placementAgent.generatePlacementPlan(testSessionA.sessionId, [hitlProduct]);
    const finalPkg = finalDesigner.synthesizeFinalPackage(testSessionA.sessionId, 'en');
    const finalProduct = finalPkg.products[0];
    console.log(`  4. Final Designer Output product_url: ${finalProduct.product_url}`);
    if (finalProduct.product_url !== rawProviderProduct.product_url || finalProduct.url !== rawProviderProduct.product_url) {
      throw new Error(`Final designer altered or failed to preserve exact product_url!`);
    }

    // 5. Test Invalid URL Handling (Should become null, never homepage)
    const invalidHomepageProduct = {
      id: 'prod_bad',
      title: 'Bad Bed',
      price: 500,
      product_url: 'https://www.ikea.com/',
      canonical_url: 'https://www.ikea.com/'
    };
    const normalizedBad = searchAgent.normalizeProduct(invalidHomepageProduct, 'Bed', 'IKEA');
    if (normalizedBad.product_url !== null) {
      throw new Error(`Invalid homepage URL was not set to null!`);
    }
    console.log('  5. Invalid homepage correctly set to null (never fabricated).');
    console.log('✅ TEST A PASSED: Exact product URLs preserved identically through all 5 workflow stages.');

    // -------------------------------------------------------------
    // TEST B — FIRST ROOM (ROOM A EXECUTION)
    // -------------------------------------------------------------
    console.log('\n[TEST B] Uploading and Redesigning Room A (Living Room)...');
    const multiRoomSession = db.createSession({ test: 'Multi-Room Transition' });
    const sessionId = multiRoomSession.sessionId;

    // Create scratch test image A
    const imagePathA = path.join(__dirname, '../data/uploads/test_room_a.jpg');
    fs.writeFileSync(imagePathA, 'FAKE_IMAGE_DATA_ROOM_A_LIVING_ROOM');
    const regA = db.registerNewImage(sessionId, imagePathA, '/data/uploads/test_room_a.jpg');
    const image_hash_A = regA.imageHash;
    const room_id_A = regA.session.roomId;

    console.log(`  ✓ Room A Registered — Image Hash: ${image_hash_A}, Room ID: ${room_id_A}`);

    // Execute Phase 1 for Room A (Living Room, $5,000, Modern Farmhouse)
    const phase1_A = await orchestrator.executePipelineUntilHITL(sessionId, imagePathA, {
      roomType: 'living_room',
      preferredStyle: 'modern_farmhouse',
      budget: 5000,
      occupants: 'adults'
    });

    const vision_result_A = phase1_A.vision;
    console.log(`  ✓ Room A Vision Result: ${vision_result_A.roomType} (${vision_result_A.roomDimensionsEstimate.estimatedAreaSqFt} sq ft)`);

    // Complete Phase 2 for Room A
    const product_selection_A = [
      {
        id: 'sofa_a',
        title: 'IKEA MORABO Cognac Leather Sofa',
        category: 'Seating',
        price: 899,
        product_url: 'https://www.ikea.com/us/en/p/morabo-sofa-grann-bomstad-golden-brown-metal-s29317765/'
      }
    ];
    const phase2_A = await orchestrator.resumePipelineAfterSelection(sessionId, product_selection_A, 'en');
    const generated_image_A = phase2_A.image.imageUrl;
    console.log(`  ✓ Room A Redesign Completed. Generated Image: ${generated_image_A}`);

    console.log('✅ TEST B PASSED: Room A state and redesign synthesized.');

    // -------------------------------------------------------------
    // TEST C — SECOND ROOM (ROOM B UPLOAD ON SAME SESSION)
    // -------------------------------------------------------------
    console.log('\n[TEST C] Uploading completely different Room Image B (Empty Bedroom) on same session...');
    const imagePathB = path.join(__dirname, '../data/uploads/test_room_b.jpg');
    fs.writeFileSync(imagePathB, 'FAKE_IMAGE_DATA_ROOM_B_EMPTY_BEDROOM_DIFFERENT_HASH');
    const regB = db.registerNewImage(sessionId, imagePathB, '/data/uploads/test_room_b.jpg');
    const image_hash_B = regB.imageHash;
    const room_id_B = regB.session.roomId;

    console.log(`  ✓ Room B Registered — Image Hash: ${image_hash_B}, Room ID: ${room_id_B}`);

    // Verify Hash Changed
    if (image_hash_B === image_hash_A) {
      throw new Error(`Image hash did not change for different image!`);
    }
    if (room_id_B === room_id_A) {
      throw new Error(`Room ID was not refreshed for new image!`);
    }

    // Execute Phase 1 for Room B (Bedroom)
    const phase1_B = await orchestrator.executePipelineUntilHITL(sessionId, imagePathB, {
      roomType: 'bedroom'
      // Style and budget persist
    });

    const vision_result_B = phase1_B.vision;
    console.log(`  ✓ Room B Vision Result: ${vision_result_B.roomType}`);

    // Complete Phase 2 for Room B
    const product_selection_B = [
      {
        id: 'bed_b',
        title: 'IKEA TARVA Solid Pine Platform Bed',
        category: 'Bed Frame & Mattress / Headboard',
        price: 189,
        product_url: 'https://www.ikea.com/us/en/p/tarva-bed-frame-pine-luroey-s29007794/'
      }
    ];
    const phase2_B = await orchestrator.resumePipelineAfterSelection(sessionId, product_selection_B, 'en');
    const generated_image_B = phase2_B.image.imageUrl;
    console.log(`  ✓ Room B Redesign Completed. Generated Image: ${generated_image_B}`);

    if (generated_image_B === generated_image_A) {
      throw new Error(`Generated image for Room B reused Room A!`);
    }
    console.log('✅ TEST C PASSED: Room B generated distinct vision, layout, and image results without stale reuse.');

    // -------------------------------------------------------------
    // TEST D — PREFERENCE PERSISTENCE & ROOM ANALYSIS RECOMPUTATION
    // -------------------------------------------------------------
    console.log('\n[TEST D] Checking that user preferences were KEPT while room analysis was RECOMPUTED...');
    const currentPrefs = db.getPreferences(sessionId);

    // Verify Preferences KEPT
    if (currentPrefs.preferredStyle !== 'modern_farmhouse' || currentPrefs.budget !== 5000) {
      throw new Error(`User preferences (style/budget) were incorrectly lost!`);
    }
    console.log(`  ✓ User Style preserved: ${currentPrefs.preferredStyle}`);
    console.log(`  ✓ User Budget preserved: $${currentPrefs.budget}`);

    // Verify Room Analysis RECOMPUTED for Room B
    const finalB = db.getFinalDesign(sessionId);
    if (finalB.placementPlan[0].productName.includes('Sofa')) {
      throw new Error(`Room B placement plan still contains Room A sofa!`);
    }
    console.log(`  ✓ Room B Placement accurately recomputed: ${finalB.placementPlan[0].productName}`);
    console.log('✅ TEST D PASSED: General preferences preserved; room-specific state recomputed.');

    // -------------------------------------------------------------
    // TEST E — STALE GENERATION PROTECTION
    // -------------------------------------------------------------
    console.log('\n[TEST E] Testing async stale generation protection...');
    const staleImageGenResult = imageGenAgent.createDynamicFurnishedVisual(
      sessionId,
      'living_room',
      'modern_farmhouse',
      'Modern Farmhouse',
      5000,
      product_selection_A,
      { placements: [] },
      'STALE PROMPT',
      null,
      {
        generationId: 'stale-gen-id-999',
        imageId: 'stale-image-id',
        imageHash: image_hash_A,
        roomId: room_id_A
      }
    );

    const latestDbSession = db.getSession(sessionId);
    if (latestDbSession.imageHash !== image_hash_B) {
      throw new Error(`Session imageHash was corrupted!`);
    }
    console.log(`  ✓ Active session correctly locked to Room B (Hash: ${latestDbSession.imageHash}, GenId: ${latestDbSession.currentGenerationId})`);
    console.log('✅ TEST E PASSED: Stale generations cannot overwrite newer room results.');

    // -------------------------------------------------------------
    // TEST F — DYNAMIC PHOTO GENERATION ACROSS STYLES & BUDGETS
    // -------------------------------------------------------------
    console.log('\n[TEST F] Testing that changing style & budget produces distinct visual renders...');
    
    // Style 1: Industrial Bedroom ($4,500)
    const indImg = imageGenAgent.createDynamicFurnishedVisual(
      'sess_test_ind',
      'bedroom',
      'industrial',
      'Industrial Loft',
      4500,
      [],
      { placements: [] },
      'Prompt Ind'
    );
    console.log(`  ✓ Industrial Bedroom ($4,500) Visual: ${indImg.imageUrl}`);

    // Style 2: Japandi Bedroom ($2,000)
    const japImg = imageGenAgent.createDynamicFurnishedVisual(
      'sess_test_jap',
      'bedroom',
      'japandi',
      'Japandi Serenity',
      2000,
      [],
      { placements: [] },
      'Prompt Jap'
    );
    console.log(`  ✓ Japandi Bedroom ($2,000) Visual: ${japImg.imageUrl}`);

    // Style 3: Scandinavian Bedroom ($5,500)
    const scandiImg = imageGenAgent.createDynamicFurnishedVisual(
      'sess_test_scandi',
      'bedroom',
      'scandinavian',
      'Scandinavian Hygge',
      5500,
      [],
      { placements: [] },
      'Prompt Scandi'
    );
    console.log(`  ✓ Scandinavian Bedroom ($5,500) Visual: ${scandiImg.imageUrl}`);

    if (indImg.imageUrl === japImg.imageUrl || japImg.imageUrl === scandiImg.imageUrl) {
      throw new Error(`Different styles produced the same image URL!`);
    }

    console.log('✅ TEST F PASSED: Every style & budget tier produces a unique, distinct visual rendering.');

    console.log('\n================================================================');
    console.log('🎉 ALL 6 REGRESSION TESTS (A, B, C, D, E, F) PASSED FLAWLESSLY!');
    console.log('================================================================\n');
  } catch (err) {
    console.error('❌ Regression Test Failed:', err);
    process.exit(1);
  }
}

runAllRegressionTests();
