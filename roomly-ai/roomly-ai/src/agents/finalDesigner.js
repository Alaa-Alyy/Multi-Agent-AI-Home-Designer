const db = require('../storage/database');
const placementAgent = require('./placementAgent');
const searchAgent = require('./searchAgent');

class FinalDesignerAgent {
  synthesizeFinalPackage(sessionId, lang = 'en') {
    console.log(`[Final Designer] Synthesizing complete redesign package for session ${sessionId} (Language: ${lang})...`);
    const session = db.getSession(sessionId);
    const vision = db.getVisionAnalysis(sessionId);
    const preferences = db.getPreferences(sessionId) || {};
    const ragContext = db.getRAGContext(sessionId);
    const budgetAllocation = db.getBudgetAllocation(sessionId);
    const hitlState = db.getHITLState(sessionId);
    const generatedImage = db.getGeneratedImage(sessionId);
    const placementPlan = placementAgent.getPlacementPlan(sessionId) || { placements: [] };

    const isArabic = lang === 'ar' || preferences.language === 'ar';
    const styleName = ragContext?.retrievedStyle?.name || preferences.preferredStyle || 'Modern Farmhouse';
    const styleDesc = ragContext?.retrievedStyle?.description || 'A comfortable blend of rustic countryside warmth, reclaimed timbers, and crisp contemporary contrast.';
    const selectedProducts = hitlState?.selectedProducts || [];
    const totalSelected = hitlState?.totalSelectedPrice || 0;
    const totalBudget = budgetAllocation?.totalBudget || preferences.budget || 3000;
    const remainingBudget = totalBudget - totalSelected;

    // Structured changes log with What / Where / Why
    const changes = placementPlan.placements.map(p => {
      return {
        item: p.productName,
        category: p.category,
        action: isArabic
          ? `إضافة وتثبيت ${p.productName} وفقاً للتصميم`
          : `Introduced and positioned ${p.productName} in accordance with ${styleName} design`,
        location: p.location,
        clearance: p.clearanceNote,
        rationale: p.designRationale
      };
    });

    // Itemized Products with strict preservation of exact product URLs (as DATA)
    const productItems = selectedProducts.map(p => {
      let finalProductUrl = p.product_url || null;
      let finalCanonicalUrl = p.canonical_url || p.product_url || null;

      // Deterministic validation to ensure we never display broken or root-homepage links
      if (finalProductUrl) {
        const val = searchAgent.validateProductUrl(finalProductUrl);
        if (!val.isValid) {
          if (finalCanonicalUrl && searchAgent.validateProductUrl(finalCanonicalUrl).isValid) {
            finalProductUrl = finalCanonicalUrl;
          } else {
            finalProductUrl = null; // Do NOT invent a fallback or use root homepage
          }
        }
      }

      return {
        id: p.id,
        title: p.title,
        product: p.title,
        category: p.category,
        price: p.price,
        currency: p.currency || 'USD',
        site: p.site || 'Verified Partner',
        source: p.source || p.site || 'Verified Partner',
        product_url: finalProductUrl,
        canonical_url: finalCanonicalUrl,
        url: finalProductUrl,
        rating: p.rating,
        dimensions: p.dimensions || {},
        image_url: p.image_url || ''
      };
    });

    // Arabic vs English Design Summary Content
    const summary = {
      style: isArabic ? this.translateStyleToArabic(styleName) : styleName,
      concept: isArabic
        ? `إعادة تصميم متكاملة بطراز ${this.translateStyleToArabic(styleName)} — تصميم يجمع بين الدفء الطبيعي، والأناقة العصرية، والوظائف العملية.`
        : `${styleName} Redesign — ${styleDesc}`,
      colorPalette: isArabic ? {
        dominantBase: '60% الأساس: أبيض دافئ ولينن ناعم',
        secondary: '30% الثانوي: خشب البلوط الطبيعي وتفاصيل حديدية سوداء',
        accent: '10% اللمسات: طين فخاري دافئ ومريمية نباتية'
      } : {
        dominantBase: '60% Dominant Base: Warm Linen & Crisp Off-White',
        secondary: '30% Secondary: Natural Oak Tones & Matte Black Hardware',
        accent: '10% Accent: Warm Terracotta & Botanical Sage'
      },
      keyDirectivesApplied: ragContext?.designDirectives || []
    };

    const finalDesignPackage = {
      sessionId,
      roomId: session?.roomId,
      imageId: session?.imageId,
      imageHash: session?.imageHash,
      designVersion: session?.designVersion,
      generationId: session?.currentGenerationId,
      language: isArabic ? 'ar' : 'en',
      summary,
      placementPlan: placementPlan.placements,
      changes,
      products: productItems,
      budget: {
        totalAllocated: totalBudget,
        estimatedTotal: totalSelected,
        remainingBudget: remainingBudget,
        currency: preferences.currency || 'USD',
        status: remainingBudget >= 0 ? 'ON_BUDGET' : 'OVER_BUDGET',
        statusText: isArabic
          ? (remainingBudget >= 0 ? 'ضمن الميزانية المحددة' : 'تجاوزت الميزانية')
          : (remainingBudget >= 0 ? 'On Budget' : 'Over Budget')
      },
      finalImage: {
        imageUrl: generatedImage?.imageUrl || null,
        promptUsed: generatedImage?.prompt || null,
        validation: generatedImage?.validation || null,
        status: generatedImage?.status || 'PENDING'
      },
      completedAt: new Date().toISOString()
    };

    db.saveFinalDesign(sessionId, finalDesignPackage);
    db.updateSession(sessionId, { status: 'FINAL_RESULT_READY' });

    return finalDesignPackage;
  }

  translateStyleToArabic(style) {
    const map = {
      'Japandi': 'جاباندي (بساطة يابانية اسكندنافية)',
      'Scandinavian': 'اسكندنافي (دافئ ومشرق)',
      'Mid-Century Modern': 'عصري منتصف القرن (أخشاب دافئة ومنحنيات)',
      'Modern Farmhouse': 'مزرعة عصرية (ريفي أنيق ولمسات حديد)',
      'Industrial': 'صناعي لوفت (معادن وجلد وجدران مكشوفة)',
      'Bohemian': 'بوهيمي (نباتات وأنسجة تراثية)',
      'Minimalist': 'مينيماليست (خطوط معمارية نقية)',
      'Coastal': 'ساحلي عصري (ألوان بحرية مريحة)'
    };
    return map[style] || style;
  }
}

module.exports = new FinalDesignerAgent();
