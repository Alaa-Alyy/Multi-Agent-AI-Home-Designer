// Offline tests: no API keys or internet needed. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roomly-test-'));
process.env.CLOUDFLARE_ACCOUNT_ID = 'test';
process.env.CLOUDFLARE_API_TOKEN = 'test';
delete process.env.SERPAPI_API_KEY; // only IKEA (mocked below)

const db = require('../src/storage/database');
const ai = require('../src/ai/cloudflare');
const { allocate } = require('../src/agents/budgetAgent');
const { pickWithinBudget } = require('../src/agents/rankingAgent');
const intake = require('../src/agents/intakeAgent');
const hitl = require('../src/agents/hitlManager');
const search = require('../src/agents/searchAgent');

const brief = { budget: 40000, items: ['sofa', 'coffee_table', 'rug'], preferredStyle: 'modern', colors: ['beige'], roomType: 'living_room', language: 'en' };

test('budget: shares add up and stay under the total, with a reserve', () => {
  const b = allocate(brief);
  assert.strictEqual(b.currency, 'EGP');
  assert.ok(b.reserveFund > 0);
  assert.ok(b.allocatedTotal <= b.spendable + b.allocations.length); // rounding
  const sofa = b.allocations.find(a => a.itemKey === 'sofa');
  assert.ok(sofa.allocatedAmount > b.allocations.find(a => a.itemKey === 'rug').allocatedAmount);
  assert.ok(sofa.targetPriceRange.min >= 3000, 'sofa minimum filters out covers and accessories');
});

test('budget: refuses an incomplete brief', () => {
  assert.throws(() => allocate({ ...brief, budget: undefined }));
  assert.throws(() => allocate({ ...brief, items: [] }));
});

test('ranking: keeps best picks when they fit, swaps when over, flags impossible budgets', () => {
  const g = (k, arr) => ({ itemKey: k, products: arr.map(([price, rankingScore]) => ({ price, rankingScore })) });
  const groups = [g('sofa', [[24000, 90], [18000, 80], [12000, 60]]), g('table', [[6000, 85], [4000, 82]])];
  assert.deepStrictEqual(pickWithinBudget(groups, 40000), { choice: { sofa: 0, table: 0 }, total: 30000, fits: true });
  const tight = pickWithinBudget(groups, 23000);
  assert.ok(tight.fits && tight.total <= 23000);
  assert.strictEqual(pickWithinBudget(groups, 5000).fits, false);
});

test('intake: cleans model output and ignores invalid values', () => {
  const u = intake.cleanUpdates({ roomType: 'castle', preferredStyle: 'modern', items: ['sofa', 'spaceship'], budget: '25000', colors: ['Beige'] }, {});
  assert.strictEqual(u.roomType, undefined);
  assert.strictEqual(u.preferredStyle, 'modern');
  assert.deepStrictEqual(u.items, ['sofa']);
  assert.strictEqual(u.budget, 25000);
  assert.deepStrictEqual(u.colors, ['beige']);
});

test('intake: "suggest for me" uses the default list for the room', () => {
  const u = intake.cleanUpdates({ useDefaultItems: true }, { roomType: 'bedroom' });
  assert.ok(u.items.includes('bed') && !u.items.includes('sofa'));
});

test('intake: detects pets and children in Arabic and English', () => {
  assert.strictEqual(intake.detectOccupants('أنا وجوزي وعندنا قطة', 'adults'), 'pets');
  assert.strictEqual(intake.detectOccupants('we have a dog and two kids'), 'children_and_pets');
  assert.strictEqual(intake.detectOccupants('just me', 'adults'), 'adults');
});

test('intake: asks in order and is complete only with all required fields', () => {
  assert.strictEqual(intake.nextField({}, { isEmptyRoom: true }), 'roomType');
  assert.strictEqual(intake.nextField({ roomType: 'bedroom' }, { isEmptyRoom: false }), 'keepItems');
  assert.deepStrictEqual(intake.missingFields(brief), []);
});

test('selection: only products from our own search are accepted, one per item', () => {
  const s = db.createSession();
  const p = (id, category, price) => ({ id, category, price, title: id, product_url: `https://www.ikea.com/eg/en/p/${id}/` });
  db.saveBudgetAllocation(s.sessionId, { totalBudget: 40000 });
  db.saveProductRankings(s.sessionId, { rankedByCategory: { sofa: { products: [p('s1', 'sofa', 15000), p('s2', 'sofa', 9000)] }, rug: { products: [p('r1', 'rug', 2000)] } } });

  assert.throws(() => hitl.confirmUserSelection(s.sessionId, ['fake-product']), /Unknown product/);
  const st = hitl.confirmUserSelection(s.sessionId, ['s1', 's2', { id: 'r1', price: 1 }]);
  assert.strictEqual(st.selectedProducts.length, 2, 'one sofa and one rug');
  assert.strictEqual(st.totalSelectedPrice, 9000 + 2000, 'price comes from our data, not the browser');
});

test('search: filters by price, relevance and working links', async () => {
  const realFetch = global.fetch;
  const realChat = ai.chat;
  const ikeaItem = (id, name, type, price) => ({ product: { id, name, typeName: type, salesPrice: { numeral: price, currencyCode: 'EGP' }, pipUrl: `https://www.ikea.com/eg/en/p/${id}/`, mainImageUrl: 'https://www.ikea.com/x.jpg', onlineSellable: true, availability: [] } });
  global.fetch = async url => {
    url = String(url);
    if (url.includes('sik.search')) {
      return new Response(JSON.stringify({ searchResultPage: { products: { main: { items: [
        ikeaItem('good', 'GOODSOFA', '3-seat sofa', 15000),
        ikeaItem('cover', 'COVER', 'Cover for 3-seat sofa', 1500),      // too cheap
        ikeaItem('cushion', 'PUFFY', 'Cushion', 9000),                  // wrong item
        ikeaItem('dead', 'GONESOFA', '3-seat sofa', 14000)               // broken link
      ] } } } }), { status: 200 });
    }
    if (url.includes('/p/dead/')) return new Response('', { status: 404 });
    return new Response('ok', { status: 200 });
  };
  ai.chat = async (messages) => {
    const list = messages[1].content;
    return { matching: list.split('\n').filter(l => /^\d+\./.test(l) && /sofa/i.test(l) && !/cushion|cover/i.test(l)).map(l => Number(l.split('.')[0])) };
  };
  try {
    const alloc = allocate(brief).allocations.find(a => a.itemKey === 'sofa');
    const r = await search.searchItem(alloc);
    assert.deepStrictEqual(r.products.map(p => p.id), ['ikea_good']);
    assert.strictEqual(r.counts.found, 4);
  } finally {
    global.fetch = realFetch;
    ai.chat = realChat;
  }
});

test('cloudflare client: reports the daily free limit clearly', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'you have used up your daily free allocation of 10,000 neurons' }] }), { status: 429 });
  try {
    await assert.rejects(ai.chat([{ role: 'user', content: 'hi' }]), err => err.code === 'DAILY_AI_LIMIT');
  } finally {
    global.fetch = realFetch;
  }
});
