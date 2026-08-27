const db = require('../storage/database');

class PreferenceAgent {
  consolidatePreferences(sessionId, newPreferences = {}) {
    const existing = db.getPreferences(sessionId) || {};
    const vision = db.getVisionAnalysis(sessionId);

    const merged = {
      roomType: newPreferences.roomType || existing.roomType || vision?.analysis?.roomType || 'living_room',
      preferredStyle: newPreferences.preferredStyle || existing.preferredStyle || 'japandi',
      colorPalette: newPreferences.colorPalette || existing.colorPalette || 'Warm Earth & Natural Oak',
      budget: newPreferences.budget || existing.budget || 3000,
      currency: newPreferences.currency || existing.currency || 'USD',
      occupants: newPreferences.occupants || existing.occupants || 'adults',
      ageRange: newPreferences.ageRange || existing.ageRange || 'adult',
      mustKeepFurniture: newPreferences.mustKeepFurniture || existing.mustKeepFurniture || [],
      placementPreferences: newPreferences.placementPreferences || existing.placementPreferences || 'Open concept seating around focal media wall with unobstructed circulation path',
      priorities: newPreferences.priorities || existing.priorities || ['Comfort & Ergonomics', 'High Aesthetic Harmony', 'Natural Materials', 'Durability'],
      specialConstraints: newPreferences.specialConstraints || existing.specialConstraints || []
    };

    // Auto-populate special constraints based on occupants
    if (merged.occupants.includes('children') || merged.occupants.includes('toddler')) {
      if (!merged.specialConstraints.includes('child_safe_rounded_edges')) {
        merged.specialConstraints.push('child_safe_rounded_edges');
      }
      if (!merged.specialConstraints.includes('stain_resistant_fabrics')) {
        merged.specialConstraints.push('stain_resistant_fabrics');
      }
    }
    if (merged.occupants.includes('pet') || merged.occupants.includes('dog') || merged.occupants.includes('cat')) {
      if (!merged.specialConstraints.includes('pet_friendly_scratch_resistant')) {
        merged.specialConstraints.push('pet_friendly_scratch_resistant');
      }
      if (!merged.specialConstraints.includes('non_toxic_plants')) {
        merged.specialConstraints.push('non_toxic_plants');
      }
    }

    const saved = db.savePreferences(sessionId, merged);
    return saved;
  }

  getMissingRequirements(sessionId) {
    const prefs = db.getPreferences(sessionId) || {};
    const missing = [];

    if (!prefs.roomType) missing.push('roomType');
    if (!prefs.preferredStyle) missing.push('preferredStyle');
    if (!prefs.budget) missing.push('budget');

    return missing;
  }
}

module.exports = new PreferenceAgent();
