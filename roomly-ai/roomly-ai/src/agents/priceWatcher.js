// Price watcher: re-opens every watched product page and records whether it is still available.
const db = require('../storage/database');
const { verifyLink } = require('./searchAgent');

class PriceWatcherAgent {
  async checkWatchlistPrices() {
    const watchlist = db.getPriceWatchlist();
    console.log(`[Price Watcher] Checking ${watchlist.length} watched products...`);
    const alerts = [];
    for (const item of watchlist) {
      const check = await verifyLink({ product_url: item.product_url, source: item.source });
      const status = check.ok ? 'AVAILABLE' : 'UNAVAILABLE';
      if (item.status && item.status !== status) alerts.push({ id: item.id, title: item.title, from: item.status, to: status });
      db.updateWatchlistItem(item.id, { status, lastHttpStatus: check.status, lastCheckedAt: new Date().toISOString() });
    }
    return { totalMonitored: watchlist.length, alerts, timestamp: new Date().toISOString() };
  }

  addProduct(product) {
    return db.addToPriceWatchlist(product);
  }

  getWatchlist() {
    return db.getPriceWatchlist();
  }
}

module.exports = new PriceWatcherAgent();
