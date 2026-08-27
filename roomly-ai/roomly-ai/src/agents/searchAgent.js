const db = require('../storage/database');

class SearchAgent {
  constructor() {
    this.providers = {
      serpapi: new SerpApiProvider(),
      rainforest: new RainforestProvider(),
      rapidapi: new RapidApiProvider(),
      affiliate: new AffiliateFeedProvider()
    };
  }

  getActiveProvider() {
    if (process.env.SERPAPI_API_KEY && process.env.SERPAPI_API_KEY.trim() !== '') {
      return { name: 'serpapi', instance: this.providers.serpapi, key: process.env.SERPAPI_API_KEY };
    }
    if (process.env.RAINFOREST_API_KEY && process.env.RAINFOREST_API_KEY.trim() !== '') {
      return { name: 'rainforest', instance: this.providers.rainforest, key: process.env.RAINFOREST_API_KEY };
    }
    if (process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_KEY.trim() !== '') {
      return { name: 'rapidapi', instance: this.providers.rapidapi, key: process.env.RAPIDAPI_KEY };
    }
    return { name: 'none', instance: null, key: null };
  }

  // Deterministic URL Validation
  validateProductUrl(url, expectedSite = null) {
    if (!url || typeof url !== 'string') return { isValid: false, reason: 'URL missing' };
    const trimmed = url.trim();

    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { isValid: false, reason: 'Invalid protocol' };
      }

      // Check if it's just a root homepage
      const pathname = parsed.pathname.replace(/\/+$/, '');
      if (!pathname || pathname === '' || pathname === '/') {
        return { isValid: false, reason: 'Root homepage is not a valid product page' };
      }

      // Reject generic search result queries passed as product pages
      if (pathname.includes('/search') || pathname.includes('/find') || pathname.includes('/results') || pathname === '/s') {
        return { isValid: false, reason: 'Search page is not an exact product page' };
      }

      // Check for valid product indicators in URL path
      const isLikelyProduct = 
        pathname.includes('/p/') ||
        pathname.includes('/products/') ||
        pathname.includes('/product/') ||
        pathname.includes('/item/') ||
        pathname.includes('/dp/') ||
        pathname.includes('/gp/product/') ||
        pathname.includes('/catalog/') ||
        pathname.split('/').filter(Boolean).length >= 2;

      if (isLikelyProduct) {
        return { isValid: true, sanitizedUrl: trimmed };
      }

      return { isValid: false, reason: 'Lacks canonical product page path' };
    } catch (e) {
      return { isValid: false, reason: 'Malformed URL' };
    }
  }

  async searchProductsForAllocations(sessionId) {
    const budgetAllocation = db.getBudgetAllocation(sessionId);
    if (!budgetAllocation) {
      throw new Error('No budget allocation found. Budget Agent must run before Search Agent.');
    }

    const queries = budgetAllocation.search_queries || [];
    const activeProvider = this.getActiveProvider();

    console.log(`[Search Agent] Active Search Provider: ${activeProvider.name.toUpperCase()}`);

    if (activeProvider.name === 'none') {
      const searchResult = {
        status: 'CREDENTIAL_REQUIRED',
        provider: 'none',
        message: 'No live Product Search API key configured. Search Agent is fully built and credential-ready. To search live retail products automatically, configure SERPAPI_API_KEY, RAINFOREST_API_KEY, or RAPIDAPI_KEY in .env.',
        requiredCredentials: [
          { envVar: 'SERPAPI_API_KEY', description: 'SerpAPI for Google Shopping live search with exact product page URLs across West Elm, CB2, IKEA, Target, Wayfair' },
          { envVar: 'RAINFOREST_API_KEY', description: 'Rainforest API for real-time Amazon product catalog search with ASIN-direct links' },
          { envVar: 'RAPIDAPI_KEY', description: 'RapidAPI for retail merchant and furniture inventory APIs' }
        ],
        queriesExecuted: queries,
        products: []
      };

      db.saveProductSearch(sessionId, searchResult);
      return searchResult;
    }

    // When credentials are provided, query the live provider
    const collectedProducts = [];
    const executionErrors = [];

    for (const queryItem of queries) {
      try {
        console.log(`[Search Agent] Querying live provider ${activeProvider.name} for "${queryItem.query}" (Target: $${queryItem.targetPrice})...`);
        const rawResults = await activeProvider.instance.search(queryItem.query, activeProvider.key, {
          maxPrice: queryItem.maxPrice,
          category: queryItem.category
        });

        const normalized = rawResults.map(item => this.normalizeProduct(item, queryItem.category, activeProvider.name));
        collectedProducts.push(...normalized);
      } catch (err) {
        console.error(`[Search Agent] Search failed for query "${queryItem.query}":`, err.message);
        executionErrors.push({ query: queryItem.query, error: err.message });
      }
    }

    const searchResult = {
      status: executionErrors.length > 0 && collectedProducts.length === 0 ? 'SEARCH_FAILED' : 'SUCCESS',
      provider: activeProvider.name,
      totalFound: collectedProducts.length,
      queriesExecuted: queries,
      products: collectedProducts,
      errors: executionErrors
    };

    db.saveProductSearch(sessionId, searchResult);
    return searchResult;
  }

  // Canonical Product Normalization Contract
  normalizeProduct(raw, category, providerName) {
    const rawUrl = raw.product_url || raw.link || raw.url || '';
    const rawCanonical = raw.canonical_url || null;

    // Validate raw URL
    let validatedUrl = null;
    let urlValidation = this.validateProductUrl(rawUrl);

    if (urlValidation.isValid) {
      validatedUrl = urlValidation.sanitizedUrl;
    } else if (rawCanonical) {
      const canonValidation = this.validateProductUrl(rawCanonical);
      if (canonValidation.isValid) validatedUrl = canonValidation.sanitizedUrl;
    }

    return {
      id: raw.id || raw.product_id || `prod_${Math.random().toString(36).substring(2, 9)}`,
      title: (raw.title || raw.name || '').trim(),
      category: category,
      price: typeof raw.price === 'number' ? raw.price : parseFloat(String(raw.price || 0).replace(/[^0-9.]/g, '')),
      currency: raw.currency || 'USD',
      image_url: raw.image_url || raw.thumbnail || raw.image || '',
      product_url: validatedUrl,
      canonical_url: rawCanonical || validatedUrl,
      site: raw.site || raw.source || raw.merchant || providerName,
      rating: parseFloat(raw.rating || raw.reviews_rating || 0) || null,
      reviewsCount: parseInt(raw.reviews_count || raw.total_reviews || 0, 10) || 0,
      dimensions: raw.dimensions || { widthIn: null, heightIn: null, depthIn: null },
      source: providerName
    };
  }
}

// 1. SerpAPI (Google Shopping Provider)
class SerpApiProvider {
  async search(query, apiKey, options = {}) {
    const params = new URLSearchParams({
      engine: 'google_shopping',
      q: query,
      api_key: apiKey,
      num: '8',
      gl: 'us',
      hl: 'en'
    });

    if (options.maxPrice) {
      params.append('tbs', `p_ord:r,price:1,ppr_max:${options.maxPrice}`);
    }

    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`SerpAPI error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const results = data.shopping_results || [];

    return results.map(item => ({
      id: item.product_id || item.position,
      title: item.title,
      price: item.extracted_price || item.price,
      currency: 'USD',
      image_url: item.thumbnail,
      product_url: item.link || item.product_link,
      canonical_url: item.link || item.product_link,
      site: item.source || 'Google Shopping',
      rating: item.rating || null,
      reviewsCount: item.reviews || 0,
      dimensions: {}
    }));
  }
}

// 2. Rainforest API (Amazon Product Search Provider)
class RainforestProvider {
  async search(query, apiKey, options = {}) {
    const params = new URLSearchParams({
      api_key: apiKey,
      type: 'search',
      amazon_domain: 'amazon.com',
      search_term: query
    });

    const res = await fetch(`https://api.rainforestapi.com/request?${params.toString()}`);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Rainforest API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const results = data.search_results || [];

    return results.map(item => ({
      id: item.asin,
      title: item.title,
      price: item.price?.value || 0,
      currency: item.price?.currency || 'USD',
      image_url: item.image,
      product_url: item.link ? `https://www.amazon.com/dp/${item.asin}` : null,
      canonical_url: item.asin ? `https://www.amazon.com/dp/${item.asin}` : null,
      site: 'Amazon',
      rating: item.rating || null,
      reviewsCount: item.ratings_total || 0,
      dimensions: {}
    }));
  }
}

// 3. RapidAPI Provider (Retail / Furniture inventory)
class RapidApiProvider {
  async search(query, apiKey, options = {}) {
    const res = await fetch(`https://real-time-product-search.p.rapidapi.com/search?q=${encodeURIComponent(query)}&country=us&language=en`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'real-time-product-search.p.rapidapi.com'
      }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`RapidAPI error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const results = data.data || [];

    return results.map(item => ({
      id: item.product_id,
      title: item.product_title,
      price: item.offer?.price || 0,
      currency: 'USD',
      image_url: item.product_photos?.[0] || '',
      product_url: item.offer?.offer_page_url || item.product_page_url,
      canonical_url: item.offer?.offer_page_url || item.product_page_url,
      site: item.offer?.store_name || 'Retailer',
      rating: item.product_rating || null,
      reviewsCount: item.product_num_reviews || 0,
      dimensions: {}
    }));
  }
}

// 4. Official Merchant Affiliate & Catalog Provider
class AffiliateFeedProvider {
  async search(query, apiKey, options = {}) {
    return [];
  }
}

module.exports = new SearchAgent();
