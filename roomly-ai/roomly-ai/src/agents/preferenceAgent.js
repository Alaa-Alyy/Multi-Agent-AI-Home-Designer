// Preference agent: checks that the brief collected by the conversation is complete,
// and adds safety constraints for children and pets. It never invents defaults.
const db = require('../storage/database');
const { missingFields } = require('./intakeAgent');

class PreferenceAgent {
  consolidatePreferences(sessionId) {
    const prefs = db.getPreferences(sessionId) || {};
    const missing = missingFields(prefs);
    if (missing.length) {
      const err = new Error(`The design brief is not complete yet. Missing: ${missing.join(', ')}`);
      err.code = 'BRIEF_INCOMPLETE';
      err.missing = missing;
      throw err;
    }

    const occupants = prefs.occupants || 'adults';
    const constraints = new Set(prefs.specialConstraints || []);
    if (occupants.includes('children')) {
      constraints.add('child_safe_rounded_edges');
      constraints.add('stain_resistant_fabrics');
      constraints.add('anchor_tall_furniture');
    }
    if (occupants.includes('pets')) {
      constraints.add('scratch_resistant_fabrics');
      constraints.add('low_pile_rugs');
      constraints.add('non_toxic_plants');
    }
    return db.savePreferences(sessionId, { currency: 'EGP', occupants, specialConstraints: [...constraints] });
  }
}

module.exports = new PreferenceAgent();
