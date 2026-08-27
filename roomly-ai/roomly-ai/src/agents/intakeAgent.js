const db = require('../storage/database');

class IntakeAgent {
  async processUserMessage(sessionId, messageText, uploadedImagePath = null) {
    let session = db.getSession(sessionId);
    if (!session) {
      session = db.createSession();
      sessionId = session.sessionId;
    }

    // Record user message
    db.addChatMessage(sessionId, 'user', messageText, { uploadedImagePath });

    // Extract quick metadata if user mentioned style, budget, room type
    const lower = messageText.toLowerCase();
    const detected = {};

    // Detect Room Type
    if (lower.includes('living room') || lower.includes('lounge') || lower.includes('sitting room')) {
      detected.roomType = 'living_room';
    } else if (lower.includes('bedroom') || lower.includes('master bed') || lower.includes('guest bed')) {
      detected.roomType = 'bedroom';
    } else if (lower.includes('office') || lower.includes('study') || lower.includes('workspace')) {
      detected.roomType = 'home_office';
    } else if (lower.includes('dining')) {
      detected.roomType = 'dining_room';
    }

    // Detect Budget
    const budgetMatch = messageText.match(/\$?(\d{1,3}(?:,\d{3})*|\d+)\s*(?:dollars|usd|\$|budget|bucks)?/i);
    if (budgetMatch) {
      const val = parseInt(budgetMatch[1].replace(/,/g, ''), 10);
      if (val >= 100 && val <= 500000) {
        detected.budget = val;
      }
    }

    // Detect Styles
    const styleKeywords = {
      'japandi': 'japandi',
      'scandi': 'scandinavian',
      'scandinavian': 'scandinavian',
      'mid century': 'mid_century_modern',
      'mid-century': 'mid_century_modern',
      'mcm': 'mid_century_modern',
      'industrial': 'industrial',
      'boho': 'bohemian',
      'bohemian': 'bohemian',
      'minimalist': 'minimalist',
      'minimalism': 'minimalist',
      'coastal': 'coastal',
      'farmhouse': 'modern_farmhouse'
    };

    for (const [kw, styleId] of Object.entries(styleKeywords)) {
      if (lower.includes(kw)) {
        detected.preferredStyle = styleId;
        break;
      }
    }

    // Detect Occupants
    if (lower.includes('toddler') || lower.includes('kid') || lower.includes('children') || lower.includes('baby')) {
      detected.occupants = 'children';
    }
    if (lower.includes('dog') || lower.includes('cat') || lower.includes('pet')) {
      detected.occupants = detected.occupants ? 'children_and_pets' : 'pets';
    }

    if (Object.keys(detected).length > 0) {
      db.savePreferences(sessionId, detected);
    }

    // Formulate intelligent guided response
    const preferences = db.getPreferences(sessionId) || {};
    let assistantReply = '';

    if (uploadedImagePath) {
      assistantReply = `Thank you for sharing your room image! I'm now handing this over to the **Vision Agent** to analyze your space's layout, lighting, and architecture.`;
    } else if (!preferences.roomType) {
      assistantReply = `Welcome! To begin redecorating, please upload a photo of your room, or let me know what room type this is (e.g. Living Room, Bedroom, Home Office).`;
    } else if (!preferences.budget) {
      assistantReply = `Great, a ${preferences.roomType.replace('_', ' ')}! What is your total budget for this redesign? (e.g., $2,500)`;
    } else if (!preferences.preferredStyle) {
      assistantReply = `Got it! A budget of $${preferences.budget}. What interior design style resonates most with you? (e.g., Japandi, Scandinavian, Mid-Century Modern, Industrial, Bohemian, Minimalist, Coastal)`;
    } else {
      assistantReply = `I have your preliminary preferences: **${preferences.preferredStyle}** style for your **${preferences.roomType}** with a budget of **$${preferences.budget}**. Please upload a photo of your current room so we can initiate the full design pipeline!`;
    }

    db.addChatMessage(sessionId, 'assistant', assistantReply);

    return {
      sessionId,
      session: db.getSession(sessionId),
      preferences: db.getPreferences(sessionId),
      reply: assistantReply,
      detected
    };
  }
}

module.exports = new IntakeAgent();
