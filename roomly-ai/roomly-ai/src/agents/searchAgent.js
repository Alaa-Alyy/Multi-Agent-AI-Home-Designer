// Search agent: finds real products sold in Egypt, in EGP, for every item in the budget.
// Providers: IKEA Egypt (public site search, no key) and Amazon.eg (through SerpAPI).
// Every product is filtered for price, relevance (is it really a sofa, or a sofa cover?) and stock,
// and its product page is opened to confirm the link works before it is shown to the user.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../storage/database');
const ai = require('../ai');
const { ITEMS } = require('../knowledge/items');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const CACHE_TTL_MS = { ikea: 6 * 3600e3, amazon: 24 * 3600e3 };
const PER_ITEM_RESULTS = 6;

// ---------- cache (protects the 250 free SerpAPI searches a month) ----------
function cacheDir() {
  const dir = path.join(db.storageDir, 'cache', 'search');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cacheGet(provider, query) {
  const file = path.join(cacheDir(), `${provider}_${crypto.createHash('sha1').update(query).digest('hex')}.json`);
  if (!fs.existsSync(file)) return null;
  const entry = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return Date.now() - entry.savedAt < CACHE_TTL_MS[provider] ? entry.results : null;
}
function cacheSet(provider, query, results) {
  const file = path.join(cacheDir(), `${provider}_${crypto.createHash('sha1').update(query).digest('hex')}.json`);
  fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), query, results }));
}

// ---------- providers ----------
const ikea = {
  name: 'ikea',
  site: 'IKEA Egypt',
  enabled: () => true,
  async search(query) {
    const cached = cacheGet('ikea', query);
    if (cached) return cached;
    const url = `https://sik.search.blue.cdtapps.com/eg/en/search-result-page?q=${encodeURIComponent(query)}&size=24&types=PRODUCT`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`IKEA search HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.searchResultPage?.products?.main?.items || [];
    const results = items.map(it => it.product).filter(Boolean).map(p => ({
      id: `ikea_${p.id}`,
      title: [p.name, p.typeName, p.validDesignText].filter(Boolean).join(' — '),
      price: Number(p.salesPrice?.numeral) || null,
      currency: p.salesPrice?.currencyCode || 'EGP',
      image_url: p.mainImageUrl || p.contextualImageUrl || '',
      product_url: p.pipUrl,
      site: 'IKEA Egypt',
      source: 'ikea',
      rating: p.ratingValue ? Number(p.ratingValue) : null,
      reviewsCount: p.ratingCount || 0,
      colors: (p.colors || []).map(c => c.name),
      categoryHint: [p.typeName, ...(p.categoryPath || []).map(c => c.name)].join(' / '),
      inStock: p.onlineSellable !== false && !(p.availability || []).some(a => /OUT_OF_STOCK/.test(a.status || ''))
    }));
    cacheSet('ikea', query, results);
    return results;
  }
};

const amazon = {
  name: 'amazon',
  site: 'Amazon.eg',
  enabled: () => Boolean(process.env.SERPAPI_API_KEY),
  async search(query) {
    const cached = cacheGet('amazon', query);
    if (cached) return cached;
    const params = new URLSearchParams({ engine: 'amazon', amazon_domain: 'amazon.eg', k: query, language: 'en_AE', api_key: process.env.SERPAPI_API_KEY });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(40000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Amazon search: ${data.error || `HTTP ${res.status}`}`);
    const results = (data.organic_results || []).filter(r => r.asin).map(r => ({
      id: `amazon_${r.asin}`,
      title: r.title || '',
      price: Number(r.extracted_price) || null,
      currency: 'EGP',
      image_url: (r.thumbnail || '').replace(/\._AC_[^.]+_\./, '._AC_SL800_.'),
      product_url: `https://www.amazon.eg/-/en/dp/${r.asin}`,
      site: 'Amazon.eg',
      source: 'amazon',
      rating: r.rating ? Number(r.rating) : null,
      reviewsCount: Number(r.reviews) || 0,
      sponsored: Boolean(r.sponsored),
      delivery: Array.isArray(r.delivery) ? r.delivery.join(' · ') : '',
      categoryHint: '',
      inStock: true
    }));
    cacheSet('amazon', query, results);
    return results;
  }
};

const PROVIDERS = [ikea, amazon];

// ---------- relevance: is each result really the item we asked for? ----------
const RELEVANCE_SCHEMA = {
  type: 'object',
  properties: { matching: { type: 'array', items: { type: 'integer' } } },
  required: ['matching']
};

async function filterRelevant(itemKey, products) {
  if (!products.length) return [];
  const item = ITEMS[itemKey];
  const list = products.map((p, i) => `${i}. ${p.title}${p.categoryHint ? ` [${p.categoryHint}]` : ''}`).join('\n');
  try {
    const out = await ai.chat([
      { role: 'system', content: 'You check online shop search results. Reply with JSON only.' },
      { role: 'user', content: `Wanted: a ${item.en.toLowerCase()} (${item.search}) to furnish a room.
Return the numbers of results that ARE a complete ${item.en.toLowerCase()} itself.
Exclude covers, cushions, legs, spare parts, accessories, toys, miniatures, stickers, and different furniture.
Results:
${list}` }
    ], { schema: RELEVANCE_SCHEMA, temperature: 0, maxTokens: 200, fast: true });
    const keep = new Set((out.matching || []).filter(i => Number.isInteger(i)));
    return products.filter((_, i) => keep.has(i));
  } catch (err) {
    console.warn(`[Search Agent] Relevance check failed for ${itemKey}: ${err.message}. Using price filter only.`);
    return products;
  }
}

// ---------- link check: open the product page ----------
async function verifyLink(product) {
  try {
    const res = await fetch(product.product_url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return { ok: false, status: res.status };
    if (product.source === 'amazon') {
      const html = await res.text();
      if (/Currently unavailable|غير متوفر حاليًا|غير متوفر حاليا/i.test(html)) return { ok: false, status: 'unavailable' };
    } else {
      res.body?.cancel?.();
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: err.name === 'TimeoutError' ? 'timeout' : 'error' };
  }
}

class SearchAgent {
  getActiveProvider() {
    const active = PROVIDERS.filter(p => p.enabled()).map(p => p.name);
    return { name: active.join('+') || 'none', providers: active };
  }

  async searchItem(alloc) {
    const item = ITEMS[alloc.itemKey];
    const { min, max } = alloc.targetPriceRange;
    // IKEA names products differently, so it gets a simpler query
    const queries = {
      ikea: alloc.searchQuery.replace(/\b(modern|classic|minimalist|scandinavian|boho|industrial|mid century|farmhouse|wooden|light)\b/gi, '').replace(/\s+/g, ' ').trim() || item.search,
      amazon: alloc.searchQuery
    };

    const raw = [];
    const errors = [];
    for (const provider of PROVIDERS.filter(p => p.enabled())) {
      try {
        raw.push(...await provider.search(queries[provider.name]));
      } catch (err) {
        errors.push({ provider: provider.name, error: err.message });
      }
    }

    // 1) price in range and in stock
    const priced = raw.filter(p => p.price && p.currency === 'EGP' && p.price >= min && p.price <= max && p.inStock);
    // 2) really the item we want
    const relevant = await filterRelevant(alloc.itemKey, priced.slice(0, 30));
    // 3) closest to the item's budget first, alternating stores so the user sees both
    const byStore = {};
    relevant
      .sort((a, b) => Math.abs(a.price - alloc.allocatedAmount) - Math.abs(b.price - alloc.allocatedAmount))
      .forEach(p => (byStore[p.source] = byStore[p.source] || []).push(p));
    const mixed = [];
    const queues = Object.values(byStore);
    while (queues.some(q => q.length)) queues.forEach(q => q.length && mixed.push(q.shift()));
    // 4) open the best candidates and keep only working pages
    const candidates = mixed.slice(0, PER_ITEM_RESULTS + 3);
    const checks = await Promise.all(candidates.map(verifyLink));
    const verified = candidates
      .map((p, i) => ({ ...p, category: alloc.itemKey, linkCheck: { ...checks[i], checkedAt: new Date().toISOString() } }))
      .filter(p => p.linkCheck.ok)
      .slice(0, PER_ITEM_RESULTS);

    console.log(`[Search Agent] ${alloc.itemKey}: ${raw.length} found → ${priced.length} in price range → ${relevant.length} relevant → ${verified.length} verified`);
    return { itemKey: alloc.itemKey, queries, counts: { found: raw.length, inRange: priced.length, relevant: relevant.length, verified: verified.length }, products: verified, errors };
  }

  async searchProductsForAllocations(sessionId) {
    const budget = db.getBudgetAllocation(sessionId);
    if (!budget) throw new Error('No budget allocation found. Budget Agent must run before Search Agent.');

    const perItem = [];
    for (const alloc of budget.allocations) perItem.push(await this.searchItem(alloc));

    const products = perItem.flatMap(r => r.products);
    const result = {
      status: products.length ? 'SUCCESS' : 'NO_RESULTS',
      provider: this.getActiveProvider().name,
      totalFound: products.length,
      perItem: perItem.map(({ products: p, ...rest }) => rest),
      products,
      searchedAt: new Date().toISOString()
    };
    db.saveProductSearch(sessionId, result);
    return result;
  }
}

module.exports = new SearchAgent();
module.exports.verifyLink = verifyLink;
