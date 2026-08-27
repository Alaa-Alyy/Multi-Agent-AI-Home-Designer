const db = require('../storage/database');

class PlacementAgent {
  generatePlacementPlan(sessionId, selectedProducts) {
    console.log(`[Placement Agent] Generating structured placement plan for session ${sessionId}...`);
    const vision = db.getVisionAnalysis(sessionId);
    const preferences = db.getPreferences(sessionId) || {};
    const ragContext = db.getRAGContext(sessionId);

    const roomType = preferences.roomType || vision?.analysis?.roomType || 'bedroom';
    const arch = vision?.analysis?.architecturalElements || {};
    const walls = arch.walls || 'drywall';
    const windows = arch.windows || { count: 1 };

    const placements = [];

    // Group selected products by normalized category
    selectedProducts.forEach((product, index) => {
      const titleLower = (product.title || '').toLowerCase();
      const catLower = (product.category || '').toLowerCase();
      const exactProductUrl = product.product_url || product.url || product.canonical_url || null;
      const exactImageUrl = product.image_url || null;

      let location = '';
      let orientation = '';
      let clearanceNote = '';
      let designRationale = '';
      let targetZone = '';

      if (catLower.includes('bed') || titleLower.includes('bed frame') || titleLower.includes('platform bed')) {
        targetZone = 'Zone A (Primary Focal Wall)';
        location = 'Centered against the main solid accent wall, positioned opposite the entryway and perpendicular to windows.';
        orientation = 'Headboard flush against the wall, allowing 36 inches of clear walking space on both sides.';
        clearanceNote = 'Minimum 36 inches on left and right for nightstand clearance and effortless circulation.';
        designRationale = 'Anchors the bedroom visual axis as the dominant focal point while preserving natural daylight from windows.';
      } else if (catLower.includes('nightstand') || titleLower.includes('nightstand') || titleLower.includes('bedside')) {
        targetZone = 'Zone A (Bedside)';
        location = index % 2 === 0 ? 'Positioned immediately to the left of the bed frame.' : 'Positioned immediately to the right of the bed frame.';
        orientation = 'Top surface level with mattress height (within 2 inches).';
        clearanceNote = 'Flush with bedside wall, aligned with bed headboard depth.';
        designRationale = 'Provides symmetric ergonomic reach for bedside lighting, reading material, and charging without impeding walkway.';
      } else if (catLower.includes('rug') || titleLower.includes('area rug') || titleLower.includes('flatweave')) {
        targetZone = 'Zone B (Floor Center / Seating Anchor)';
        if (roomType === 'bedroom') {
          location = 'Centered horizontally under the lower two-thirds of the bed frame, extending 24-36 inches beyond the sides and foot of the mattress.';
          orientation = 'Perpendicular to bed orientation (wide aspect facing entrance).';
          clearanceNote = 'Extends minimum 24 inches on left, right, and foot of bed for comfortable step-down.';
          designRationale = 'Grounds the sleeping volume, prevents cold floor contact, and softens room acoustics.';
        } else {
          location = 'Centered in the living room conversation zone, resting beneath the front legs of the sofa and accent chairs.';
          orientation = 'Aligned with room length.';
          clearanceNote = 'Maintains 12-18 inches of exposed hardwood perimeter around walls.';
          designRationale = 'Eliminates floating furniture syndrome and visually establishes the social zone.';
        }
      } else if (catLower.includes('sofa') || catLower.includes('seating') || titleLower.includes('sofa') || titleLower.includes('couch')) {
        targetZone = 'Zone A (Primary Seating Wall)';
        location = 'Centered along the main living room wall facing the media/entertainment focal zone.';
        orientation = 'Parallel to main wall with 4-inch wall clearance for curtain drop and airflow.';
        clearanceNote = 'Preserves 36-inch main walkway behind and to the side of seating.';
        designRationale = 'Maximizes open floor space while establishing a welcoming sightline upon entering the room.';
      } else if (catLower.includes('coffee') || titleLower.includes('coffee table')) {
        targetZone = 'Zone B (Center Conversation Node)';
        location = 'Centered directly in front of the sofa, positioned strictly 14 to 18 inches away from the sofa seat cushion edge.';
        orientation = 'Parallel to main sofa.';
        clearanceNote = 'Exactly 16 inches of reach clearance from seating cushion.';
        designRationale = 'Complies with ergonomic reach standards while allowing unobstructed leg movement and beverage access.';
      } else if (catLower.includes('lamp') || catLower.includes('lighting') || titleLower.includes('floor lamp') || titleLower.includes('sconce')) {
        targetZone = 'Zone C (Corner Accent / Task Layer)';
        location = 'Positioned in the secondary room corner beside the seating/reading nook, angled to wash light softly over the wall.';
        orientation = 'Arched shade directed inward toward conversation / seating area.';
        clearanceNote = 'Tucked cleanly into corner, cord routed flush with baseboard.';
        designRationale = 'Introduces crucial vertical task lighting (Tier 2/3) to eliminate harsh overhead shadows with warm 2700K illumination.';
      } else if (catLower.includes('art') || catLower.includes('decor') || titleLower.includes('canvas') || titleLower.includes('mirror') || titleLower.includes('wall art')) {
        targetZone = 'Zone D (Vertical Focal Wall)';
        location = 'Mounted on the focal wall, exactly centered at 58 inches (147 cm) from the finished floor to the artwork center point.';
        orientation = 'Centered above furniture piece with 8-10 inches gap between furniture top and bottom of frame.';
        clearanceNote = 'Securely wall-anchored at standing human eye level.';
        designRationale = 'Adheres to gallery-standard eye-level hanging guidelines to create visual balance and vertical cohesion.';
      } else if (catLower.includes('desk') || titleLower.includes('desk') || titleLower.includes('workspace')) {
        targetZone = 'Zone A (Workspace Node)';
        location = 'Positioned facing into the room or perpendicular to the window wall for natural side-lighting.';
        orientation = 'Screen oriented away from direct glare.';
        clearanceNote = 'Minimum 42 inches behind desk chair for ergonomic push-back.';
        designRationale = 'Provides ergonomic focus, minimizes computer glare, and maintains organized cable channeling.';
      } else {
        targetZone = 'Zone C (Perimeter Accent)';
        location = `Positioned along secondary wall perimeter in balance with room layout.`;
        orientation = 'Aligned with architectural wall lines.';
        clearanceNote = 'Maintains minimum 24-inch secondary clearance.';
        designRationale = `Complements the ${roomType.replace('_', ' ')} layout without impeding circulation.`;
      }

      placements.push({
        productId: product.id || `prod_${index + 1}`,
        productName: product.title,
        category: product.category,
        productUrl: exactProductUrl,
        imageUrl: exactImageUrl,
        targetZone,
        location,
        orientation,
        clearanceNote,
        designRationale,
        dimensions: product.dimensions || {}
      });
    });

    const placementPlan = {
      sessionId,
      roomType,
      totalItemsPlaced: placements.length,
      placements,
      createdAt: new Date().toISOString()
    };

    // Save to database
    db.write({
      ...db.read(),
      placement_plans: {
        ...(db.read().placement_plans || {}),
        [sessionId]: placementPlan
      }
    });

    db.logExecution(sessionId, 'PLACEMENT_PLAN', 'Placement plan generated', {
      itemsCount: placements.length,
      roomType
    });

    return placementPlan;
  }

  getPlacementPlan(sessionId) {
    const data = db.read();
    return data.placement_plans?.[sessionId] || null;
  }
}

module.exports = new PlacementAgent();
