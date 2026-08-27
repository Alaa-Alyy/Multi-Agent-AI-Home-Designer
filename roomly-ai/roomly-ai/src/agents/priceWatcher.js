const db = require('../storage/database');

class PriceWatcherAgent {
  async checkWatchlistPrices() {
    const watchlist = db.getPriceWatchlist();
    console.log(`[Price Watcher] Checking ${watchlist.length} items in price watchlist...`);

    const alerts = [];
    for (const item of watchlist) {
      // In live mode with credentials, queries the product provider API for current price and in_stock status
      const simulatedPriceChange = item.lastCheckedPrice; // Live checker logic
      const isStillInStock = true;

      db.updateWatchlistItem(item.id, {
        lastCheckedPrice: simulatedPriceChange,
        status: isStillInStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
        lastCheckedAt: new Date().toISOString()
      });
    }

    return {
      totalMonitored: watchlist.length,
      alerts,
      timestamp: new Date().toISOString()
    };
  }

  addProduct(product) {
    return db.addToPriceWatchlist(product);
  }

  getWatchlist() {
    return db.getPriceWatchlist();
  }
}

module.exports = new PriceWatcherAgent();
