// Final designer: assembles the redesign package the user sees at the end.
const db = require('../storage/database');
const placementAgent = require('./placementAgent');
const { itemLabel } = require('../knowledge/items');

const STYLE_AR = {
  modern: 'مودرن', classic: 'كلاسيك', minimalist: 'مينيمال', scandinavian: 'إسكندنافي', japandi: 'جاباندي',
  bohemian: 'بوهيمي', industrial: 'إندستريال', mid_century_modern: 'ميد سينشري', modern_farmhouse: 'فارم هاوس', coastal: 'ساحلي'
};

class FinalDesignerAgent {
  synthesizeFinalPackage(sessionId, lang = 'en') {
    const session = db.getSession(sessionId);
    const prefs = db.getPreferences(sessionId) || {};
    const rag = db.getRAGContext(sessionId);
    const budget = db.getBudgetAllocation(sessionId);
    const hitl = db.getHITLState(sessionId);
    const image = db.getGeneratedImage(sessionId);
    const placement = placementAgent.getPlacementPlan(sessionId) || { placements: [] };
    const ar = lang === 'ar' || prefs.language === 'ar';
    const L = ar ? 'ar' : 'en';

    const style = rag?.retrievedStyle || {};
    const products = (hitl?.selectedProducts || []).map(p => ({
      id: p.id,
      title: p.title,
      category: p.category,
      categoryLabel: itemLabel(p.category, L),
      price: p.price,
      currency: 'EGP',
      site: p.site,
      product_url: p.product_url,
      image_url: p.image_url,
      rating: p.rating,
      delivery: p.delivery || '',
      linkCheckedAt: p.linkCheck?.checkedAt || null
    }));
    const total = products.reduce((s, p) => s + p.price, 0);
    const totalBudget = budget?.totalBudget || prefs.budget || 0;
    const remaining = totalBudget - total;

    const pkg = {
      sessionId,
      roomId: session?.roomId,
      generationId: session?.currentGenerationId,
      language: L,
      summary: {
        style: ar ? STYLE_AR[prefs.preferredStyle] || style.name : style.name || prefs.preferredStyle,
        concept: ar
          ? `تصميم ${STYLE_AR[prefs.preferredStyle] || ''} بألوان ${(prefs.colors || []).join('، ')}، باستخدام منتجات حقيقية متاحة في مصر.`
          : `${style.name || prefs.preferredStyle} redesign in ${(prefs.colors || []).join(', ')}, using real products available in Egypt. ${style.description || ''}`,
        palette: style.recommendedColors || [],
        keyDirectivesApplied: rag?.designDirectives || []
      },
      placementPlan: placement.placements,
      products,
      budget: {
        totalAllocated: totalBudget,
        estimatedTotal: total,
        remainingBudget: remaining,
        currency: 'EGP',
        status: remaining >= 0 ? 'ON_BUDGET' : 'OVER_BUDGET',
        statusText: ar ? (remaining >= 0 ? 'ضمن الميزانية' : 'أعلى من الميزانية') : (remaining >= 0 ? 'Within budget' : 'Over budget')
      },
      finalImage: {
        imageUrl: image?.imageUrl || null,
        status: image?.status || 'PENDING',
        message: image?.message || null
      },
      note: ar
        ? 'الأسعار والتوفر من المتاجر وقت البحث، وممكن تتغير.'
        : 'Prices and availability are from the stores at search time and may change.',
      completedAt: new Date().toISOString()
    };

    db.saveFinalDesign(sessionId, pkg);
    db.updateSession(sessionId, { status: 'FINAL_RESULT_READY' });
    return pkg;
  }
}

module.exports = new FinalDesignerAgent();
