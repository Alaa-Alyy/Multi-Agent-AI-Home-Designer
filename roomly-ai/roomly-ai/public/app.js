// Roomly AI web app: photo → conversation → real products → your room furnished.
document.addEventListener('DOMContentLoaded', () => {
  const state = {
    sessionId: null,
    imageUrl: null,
    lang: localStorage.getItem('roomly_lang') || 'en',
    theme: localStorage.getItem('roomly_theme') || 'dark',
    vision: null,
    brief: null,
    ready: false,
    pipeline: null,
    selection: {},   // itemKey -> product id ('' = skip)
    result: null
  };

  const $ = id => document.getElementById(id);
  const ar = () => state.lang === 'ar';
  const t = (en, arText) => (ar() ? arText : en);
  const dict = () => i18nData[state.lang] || i18nData.en;

  // Escape anything that comes from stores or the AI before putting it in the page
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https:\/\//i.test(u || '') || /^\/data\//.test(u || '') ? esc(u) : '#');
  const egp = n => (ar() ? `${Number(n || 0).toLocaleString('ar-EG')} جنيه` : `${Number(n || 0).toLocaleString('en-US')} EGP`);
  const richText = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

  const ROOM = { living_room: ['Living room', 'أوضة معيشة'], bedroom: ['Bedroom', 'أوضة نوم'], home_office: ['Home office', 'مكتب'], dining_room: ['Dining room', 'سفرة'], kids_room: ["Kids' room", 'أوضة أطفال'], other: ['Room', 'أوضة'] };
  const STYLE = { modern: ['Modern', 'مودرن'], classic: ['Classic', 'كلاسيك'], minimalist: ['Minimalist', 'مينيمال'], scandinavian: ['Scandinavian', 'إسكندنافي'], japandi: ['Japandi', 'جاباندي'], bohemian: ['Bohemian', 'بوهيمي'], industrial: ['Industrial', 'إندستريال'], mid_century_modern: ['Mid-century modern', 'ميد سينشري'], modern_farmhouse: ['Modern farmhouse', 'فارم هاوس'], coastal: ['Coastal', 'ساحلي'] };
  const HOUSEHOLD = { adults: ['Adults', 'كبار بس'], children: ['With children', 'فيه أطفال'], pets: ['With pets', 'فيه حيوانات أليفة'], children_and_pets: ['Children and pets', 'أطفال وحيوانات'] };
  const pick = (map, key) => (map[key] ? map[key][ar() ? 1 : 0] : key);

  async function api(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const postJson = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, lang: state.lang }) });

  // ---------- theme & language ----------
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('roomly_theme', theme);
    $('themeIcon').textContent = theme === 'light' ? '🌙' : '☀️';
    $('themeLabel').textContent = theme === 'light' ? t('Dark', 'داكن') : t('Light', 'فاتح');
  }

  function applyLanguage(lang) {
    state.lang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('roomly_lang', lang);
    $('langLabel').textContent = lang === 'ar' ? 'English' : 'العربية';
    document.querySelectorAll('[data-i18n]').forEach(el => { const v = dict()[el.dataset.i18n]; if (v) el.textContent = v; });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const v = dict()[el.dataset.i18nPlaceholder]; if (v) el.placeholder = v; });
    applyTheme(state.theme);
    renderBrief();
    if (state.vision) renderVision(state.vision);
    if (state.pipeline) renderPipeline(state.pipeline);
    if (state.result) renderResult(state.result);
    checkHealth();
  }

  $('btnThemeToggle').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('btnLangToggle').addEventListener('click', () => applyLanguage(ar() ? 'en' : 'ar'));

  async function checkHealth() {
    try {
      const h = await api('/api/health');
      const ok = (el, text) => { el.textContent = text; el.style.borderColor = 'var(--accent-green)'; el.style.color = 'var(--accent-green)'; };
      if (h.credentials.ai) ok($('aiCred'), t('AI: active', 'الذكاء الاصطناعي: شغال'));
      if (h.credentials.serpapi) ok($('searchCred'), t('Search: IKEA + Amazon', 'البحث: ايكيا + أمازون'));
    } catch { /* the page still works; errors appear when used */ }
  }

  // ---------- chat ----------
  function addChat(role, text, extraClass = '') {
    const msg = document.createElement('div');
    msg.className = `chat-msg ${role}`;
    msg.innerHTML = `<div class="msg-avatar">${role === 'assistant' ? '🤖' : '👤'}</div><div class="msg-bubble ${extraClass}">${richText(text)}</div>`;
    $('chatMessages').appendChild(msg);
    $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
    return msg;
  }
  const typing = () => addChat('assistant', t('typing...', 'بيكتب...'), 'typing');

  function setChatEnabled(on) {
    $('chatInput').disabled = !on;
    $('btnSendChat').disabled = !on;
  }

  async function sendChat() {
    const text = $('chatInput').value.trim();
    if (!text || !state.sessionId) return;
    $('chatInput').value = '';
    addChat('user', text);
    setChatEnabled(false);
    const dots = typing();
    try {
      const { result } = await postJson('/api/chat', { sessionId: state.sessionId, message: text });
      dots.remove();
      addChat('assistant', result.reply);
      updateBrief(result);
    } catch (err) {
      dots.remove();
      addChat('assistant', `⚠️ ${err.message}`);
    } finally {
      setChatEnabled(true);
      $('chatInput').focus();
    }
  }
  $('btnSendChat').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // ---------- design brief ----------
  function updateBrief(chatState) {
    state.brief = chatState.preferences;
    state.itemLabels = chatState.itemLabels || state.itemLabels;
    state.ready = chatState.readyToDesign;
    renderBrief();
  }

  function renderBrief() {
    const b = state.brief;
    const btn = $('btnStartPipeline');
    if (!b) {
      $('briefContent').innerHTML = `<div class="empty-state">${esc(dict().briefEmpty)}</div>`;
    } else {
      const val = v => (v ? `<span class="brief-val">${v}</span>` : `<span class="brief-val missing">${t('not yet', 'لسه')}</span>`);
      const items = (state.itemLabels || []).map(i => `<span class="chip">${esc(ar() ? i.ar : i.en)}</span>`).join('');
      const rows = [
        [dict().briefRoom, b.roomType && esc(pick(ROOM, b.roomType))],
        [dict().briefItems, items],
        b.keepItems?.length ? [dict().briefKeep, esc(b.keepItems.join(', '))] : null,
        [dict().briefStyle, b.preferredStyle && esc(pick(STYLE, b.preferredStyle))],
        [dict().briefColors, b.colors?.length && esc(b.colors.join(', ')) + (b.colorsToAvoid?.length ? ` <small>(${t('avoid', 'من غير')}: ${esc(b.colorsToAvoid.join(', '))})</small>` : '')],
        b.occupants ? [dict().briefHousehold, esc(pick(HOUSEHOLD, b.occupants))] : null,
        [dict().briefBudget, b.budget && esc(egp(b.budget))]
      ].filter(Boolean);
      $('briefContent').innerHTML = rows.map(([k, v]) => `<div class="brief-row"><span class="brief-key">${esc(k)}</span>${val(v)}</div>`).join('');
    }
    if (btn.dataset.busy !== '1') {
      btn.disabled = !state.ready;
      btn.textContent = state.ready ? (state.pipeline ? dict().btnRerunPipeline : dict().btnRunPipeline) : dict().btnNotReady;
    }
  }

  // ---------- 1. photo upload: analyse + first question ----------
  const dropzone = $('dropzone');
  dropzone.addEventListener('click', () => $('roomImageInput').click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) uploadPhoto(e.dataTransfer.files[0]); });
  $('roomImageInput').addEventListener('change', e => { if (e.target.files[0]) uploadPhoto(e.target.files[0]); });
  $('btnRemoveImage').addEventListener('click', e => { e.stopPropagation(); $('roomImageInput').value = ''; $('roomImageInput').click(); });

  async function uploadPhoto(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return alert(t('Please choose a JPG, PNG or WEBP photo.', 'اختار صورة JPG أو PNG أو WEBP.'));
    const reader = new FileReader();
    reader.onload = e => { $('imagePreview').src = e.target.result; $('uploadPrompt').style.display = 'none'; $('previewContainer').style.display = 'block'; };
    reader.readAsDataURL(file);

    resetStages();
    setStatus('statusVision', dict().analysingPhoto, 'var(--accent-gold)');
    const dots = typing();
    updateTracker(2);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('lang', state.lang);
      if (state.sessionId) form.append('sessionId', state.sessionId);
      const data = await api('/api/upload', { method: 'POST', body: form });
      dots.remove();
      state.sessionId = data.sessionId;
      state.imageUrl = data.imageUrl;
      state.vision = data.vision;
      renderVision(data.vision);
      addChat('assistant', data.chat.reply);
      updateBrief(data.chat);
      setChatEnabled(true);
      updateTracker(1);
      $('chatInput').focus();
    } catch (err) {
      dots.remove();
      setStatus('statusVision', '⚠️', 'var(--accent-coral)');
      addChat('assistant', `⚠️ ${err.message}`);
    }
  }

  // ---------- 2. start design ----------
  $('btnStartPipeline').addEventListener('click', async () => {
    const btn = $('btnStartPipeline');
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.textContent = dict().btnRunningPipeline;
    ['statusRAG', 'statusBudget', 'statusSearch'].forEach(id => setStatus(id, '⏳', 'var(--accent-gold)'));
    updateTracker(3);
    try {
      const data = await postJson('/api/pipeline/start', { sessionId: state.sessionId });
      state.pipeline = data;
      state.result = null;
      state.selection = Object.fromEntries((data.rankings.recommendedSet || []).map(p => [p.category, p.id]));
      renderPipeline(data);
      updateTracker(6);
      addChat('assistant', t('I found real products for each item. Choose the ones you like on the right, then press **Confirm and furnish my room**.',
        'لقيت منتجات حقيقية لكل حاجة. اختار اللي يعجبك على اليمين، وبعدين دوس **أكّد وافرش أوضتي**.'));
    } catch (err) {
      ['statusRAG', 'statusBudget', 'statusSearch'].forEach(id => setStatus(id, '⚠️', 'var(--accent-coral)'));
      addChat('assistant', `⚠️ ${err.message}`);
    } finally {
      btn.dataset.busy = '';
      renderBrief();
    }
  });

  // ---------- rendering: stages ----------
  function setStatus(id, text, color) {
    const el = $(id);
    el.textContent = text;
    el.style.color = color || '';
  }

  function resetStages() {
    state.pipeline = null;
    state.result = null;
    state.vision = null;
    const empty = (id, key) => { $(id).innerHTML = `<div class="empty-state">${esc(dict()[key])}</div>`; };
    empty('contentVision', 'emptyVision'); empty('contentRAG', 'emptyRAG'); empty('contentBudget', 'emptyBudget');
    empty('contentSearch', 'emptySearch'); empty('contentHITL', 'emptyHITL'); empty('contentImageGen', 'emptyImageGen'); empty('contentFinal', 'emptyFinal');
    ['statusRAG', 'statusBudget', 'statusSearch', 'statusHITL', 'statusImageGen', 'statusFinal'].forEach(id => setStatus(id, dict().statusIdle));
  }

  function renderVision(v) {
    setStatus('statusVision', t('✅ Analysed', '✅ اتحللت'), 'var(--accent-green)');
    const arch = v.architecturalElements || {};
    const dims = v.roomDimensionsEstimate || {};
    const furniture = (v.furnitureAndObjects || []);
    $('contentVision').innerHTML = `
      <div class="vision-grid">
        <div class="info-block">
          <h4>${t('Room', 'الأوضة')}</h4>
          <p><strong>${t('Type', 'النوع')}:</strong> ${esc(pick(ROOM, v.roomType))}${v.isEmptyRoom ? ` · ${t('empty', 'فاضية')}` : ''}</p>
          ${dims.widthM ? `<p><strong>${t('About', 'حوالي')}:</strong> ${esc(dims.widthM)} × ${esc(dims.lengthM)} ${t('m', 'متر')}</p>` : ''}
          <p><strong>${t('Free space', 'المساحة الفاضية')}:</strong> ${esc(v.availableFreeSpace)}</p>
        </div>
        <div class="info-block">
          <h4>${t('Colours & materials', 'الألوان والخامات')}</h4>
          <p><strong>${t('Walls', 'الحيطان')}:</strong> ${esc(v.colorPaletteDetected?.dominantWallColor)}</p>
          <p><strong>${t('Floor', 'الأرضية')}:</strong> ${esc(arch.flooring || v.colorPaletteDetected?.floorColor)}</p>
        </div>
        <div class="info-block">
          <h4>${t('Windows & light', 'الشبابيك والإضاءة')}</h4>
          <p><strong>${t('Windows', 'الشبابيك')}:</strong> ${esc(arch.windows?.count ?? '?')} ${arch.windows?.position ? `(${esc(arch.windows.position)})` : ''}</p>
          <p><strong>${t('Daylight', 'الإضاءة الطبيعية')}:</strong> ${esc(v.lightingAssessment?.naturalLight)}</p>
        </div>
        <div class="info-block">
          <h4>${t('Existing furniture', 'العفش الموجود')}</h4>
          ${furniture.length ? `<ul>${furniture.map(f => `<li><strong>${esc(f.name)}</strong> · ${esc(f.position || '')}</li>`).join('')}</ul>` : `<p>${t('None, the room is empty.', 'مفيش، الأوضة فاضية.')}</p>`}
        </div>
      </div>
      ${v.spatialCharacteristics ? `<div class="info-block" style="margin-top:12px;"><p>${esc(v.spatialCharacteristics)}</p></div>` : ''}`;
  }

  function renderPipeline(d) {
    renderRAG(d.rag);
    renderBudget(d.budget);
    renderSearch(d.search, d.budget);
    renderHITL(d.rankings, d.budget);
  }

  function renderRAG(rag) {
    setStatus('statusRAG', t('✅ Retrieved', '✅ اتجابت'), 'var(--accent-green)');
    const s = rag.retrievedStyle || {};
    $('contentRAG').innerHTML = `
      <div class="info-block" style="margin-bottom:12px;">
        <h4>${esc(s.name)}</h4>
        <p>${esc(s.description)}</p>
        <div class="palette">${(s.recommendedColors || []).map(c => `<span style="background:${/^#[0-9a-f]{6}$/i.test(c) ? c : '#999'}" title="${esc(c)}"></span>`).join('')}</div>
      </div>
      <div class="info-block">
        <h4>${t('Most relevant design rules (found by meaning)', 'أنسب قواعد تصميم (بالمعنى)')}</h4>
        <ul>${(rag.topRankedChunks || []).slice(0, 5).map(c => `<li><strong>${esc(c.title)}</strong> <small>(${esc(c.score)})</small></li>`).join('')}</ul>
      </div>`;
  }

  function renderBudget(b) {
    setStatus('statusBudget', `✅ ${egp(b.totalBudget)}`, 'var(--accent-green)');
    $('contentBudget').innerHTML = `
      <p style="font-size:13px;margin-bottom:8px;">${t('Kept aside for delivery and extras', 'محجوز للتوصيل والحاجات الصغيرة')}: <strong>${egp(b.reserveFund)}</strong></p>
      ${b.underfundedItems?.length ? `<div class="notice warn">${t('The budget is tight for', 'الميزانية قليلة على')}: ${b.allocations.filter(a => a.underfunded).map(a => esc(ar() ? a.labelAr : a.labelEn)).join(', ')}</div>` : ''}
      <div class="budget-grid">
        ${b.allocations.map(a => `
          <div class="budget-card">
            <div class="budget-card-title">${esc(ar() ? a.labelAr : a.labelEn)} (${a.percentage}%)</div>
            <div class="budget-card-amount">${egp(a.allocatedAmount)}</div>
            <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${Math.min(100, a.percentage * 2)}%;"></div></div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:6px;">${egp(a.targetPriceRange.min)} – ${egp(a.targetPriceRange.max)}</div>
          </div>`).join('')}
      </div>`;
  }

  function renderSearch(s, b) {
    setStatus('statusSearch', `✅ ${s.totalFound} ${t('verified products', 'منتج متأكد منه')}`, s.totalFound ? 'var(--accent-green)' : 'var(--accent-coral)');
    const label = key => { const a = b.allocations.find(x => x.itemKey === key); return a ? (ar() ? a.labelAr : a.labelEn) : key; };
    $('contentSearch').innerHTML = `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${t('Stores', 'المتاجر')}: ${esc(s.provider.replace('ikea', 'IKEA Egypt').replace('amazon', 'Amazon.eg'))} · ${t('every link was opened and checked', 'كل لينك اتفتح واتأكدنا منه')}</p>
      <table class="changes-table">
        <thead><tr><th>${t('Item', 'الحاجة')}</th><th>${t('Found', 'لقينا')}</th><th>${t('In price range', 'في حدود السعر')}</th><th>${t('Really that item', 'هو نفس الحاجة')}</th><th>${t('Link works', 'اللينك شغال')}</th></tr></thead>
        <tbody>${s.perItem.map(r => `<tr><td><strong>${esc(label(r.itemKey))}</strong></td><td>${r.counts.found}</td><td>${r.counts.inRange}</td><td>${r.counts.relevant}</td><td><strong>${r.counts.verified}</strong></td></tr>`).join('')}</tbody>
      </table>`;
  }

  function productsById(rankings) {
    return new Map(Object.values(rankings.rankedByCategory).flatMap(g => g.products).map(p => [p.id, p]));
  }

  function renderHITL(rankings, budget) {
    setStatus('statusHITL', t('✋ Your turn', '✋ دورك'), 'var(--accent-coral)');
    const groups = budget.allocations.map(a => ({ alloc: a, group: rankings.rankedByCategory[a.itemKey] })).filter(x => x.group);
    const html = groups.map(({ alloc, group }) => {
      const name = ar() ? alloc.labelAr : alloc.labelEn;
      if (!group.products.length) {
        const tooLow = alloc.underfunded;
        return `<div class="item-group"><div class="item-group-head"><h4>${esc(name)}</h4></div><div class="notice warn">${tooLow
          ? t('The budget for this item is below what these stores sell it for. Raise the budget or skip it.', 'ميزانية الحاجة دي أقل من أسعارها في المتاجر دي. زوّد الميزانية أو شيلها.')
          : t('No matching product found in IKEA Egypt or Amazon.eg right now. Try again later or skip it.', 'مالقيناش منتج مناسب في ايكيا مصر أو أمازون مصر دلوقتي. جرّب تاني بعدين أو شيلها.')}</div></div>`;
      }
      const rows = group.products.map(p => `
        <label class="product-row ${state.selection[alloc.itemKey] === p.id ? 'selected' : ''}">
          <input type="radio" name="pick_${esc(alloc.itemKey)}" value="${esc(p.id)}" data-item="${esc(alloc.itemKey)}" ${state.selection[alloc.itemKey] === p.id ? 'checked' : ''}>
          ${p.image_url ? `<img class="product-thumb" src="${safeUrl(p.image_url)}" alt="" loading="lazy">` : ''}
          <div class="product-details">
            <div class="product-title">${esc(p.title)}</div>
            <div class="product-meta"><span class="badge-store">${esc(p.site)}</span>${p.rating ? `⭐ ${esc(p.rating)}${p.reviewsCount ? ` (${esc(p.reviewsCount)})` : ''} · ` : ''}${p.delivery ? esc(p.delivery) : ''}</div>
            <a href="${safeUrl(p.product_url)}" target="_blank" rel="noopener noreferrer" class="url-badge exact" onclick="event.stopPropagation()">🔗 ${t('Open product page ↗', 'افتح صفحة المنتج ↗')}</a>
          </div>
          <div class="product-price">${egp(p.price)}</div>
        </label>`).join('');
      const skip = `
        <label class="product-row skip-row ${state.selection[alloc.itemKey] === '' ? 'selected' : ''}">
          <input type="radio" name="pick_${esc(alloc.itemKey)}" value="" data-item="${esc(alloc.itemKey)}" ${state.selection[alloc.itemKey] === '' ? 'checked' : ''}>
          ${t("Skip this item", 'مش عايز الحاجة دي')}
        </label>`;
      return `<div class="item-group"><div class="item-group-head"><h4>${esc(name)}</h4><small>${t('budget', 'الميزانية')} ${egp(alloc.allocatedAmount)}</small></div>${rows}${skip}</div>`;
    }).join('');

    $('contentHITL').innerHTML = `
      ${rankings.fitsBudget ? '' : `<div class="notice warn">${t('Even the cheapest good options go over your budget. You can skip items or raise the budget in the chat.', 'حتى أرخص اختيارات كويسة أعلى من الميزانية. ممكن تشيل حاجات أو تزوّد الميزانية في الدردشة.')}</div>`}
      ${rankings.fitsBudget && rankings.recommendedTotal && rankings.recommendedTotal < budget.totalBudget * 0.5
        ? `<div class="notice warn">${t(`These stores' best matches cost far less than your budget: about ${egp(budget.totalBudget - rankings.recommendedTotal)} would be left. You can add more items in the chat.`,
            `أحسن الاختيارات في المتاجر دي أرخص بكتير من ميزانيتك، وهيفضل معاك حوالي ${egp(budget.totalBudget - rankings.recommendedTotal)}. ممكن تضيف حاجات تانية في الدردشة.`)}</div>` : ''}
      <div class="hitl-container">${html}
        <div class="hitl-footer">
          <div class="hitl-totals">${t('Total', 'الإجمالي')}: <span id="hitlTotal"></span> / ${egp(budget.totalBudget)}</div>
          <button type="button" class="btn btn-success" id="btnConfirmHITL">${t('✅ Confirm and furnish my room', '✅ أكّد وافرش أوضتي')}</button>
        </div>
      </div>`;

    const byId = productsById(rankings);
    const updateTotal = () => {
      const total = Object.values(state.selection).filter(Boolean).reduce((s, id) => s + (byId.get(id)?.price || 0), 0);
      const el = $('hitlTotal');
      el.textContent = egp(total);
      el.classList.toggle('over-budget', total > budget.totalBudget);
    };
    $('contentHITL').querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
      state.selection[r.dataset.item] = r.value;
      $('contentHITL').querySelectorAll(`input[name="pick_${CSS.escape(r.dataset.item)}"]`).forEach(o => o.closest('.product-row').classList.toggle('selected', o.checked));
      updateTotal();
    }));
    updateTotal();
    $('btnConfirmHITL').addEventListener('click', confirmSelection);
  }

  async function confirmSelection() {
    const ids = Object.values(state.selection).filter(Boolean);
    if (!ids.length) return alert(t('Choose at least one product.', 'اختار منتج واحد على الأقل.'));
    const btn = $('btnConfirmHITL');
    btn.disabled = true;
    btn.textContent = t('⏳ Furnishing your room (about a minute)...', '⏳ بفرش أوضتك (حوالي دقيقة)...');
    setStatus('statusHITL', t('✅ Chosen', '✅ اتختارت'), 'var(--accent-green)');
    setStatus('statusImageGen', '⏳', 'var(--accent-gold)');
    updateTracker(7);
    try {
      const data = await postJson('/api/hitl/confirm', { sessionId: state.sessionId, selectedProductIds: ids });
      state.result = { image: data.image, finalDesign: data.finalDesign };
      renderResult(state.result);
      updateTracker(8);
      addChat('assistant', data.image?.status === 'SUCCESS'
        ? t('🎉 Done! Scroll down to see your room furnished, with the product links and the total.', '🎉 خلصنا! انزل تحت هتلاقي أوضتك مفروشة، ولينكات المنتجات والإجمالي.')
        : t('The product list is ready, but the image could not be made right now. You can retry it below.', 'قائمة المنتجات جاهزة، بس الصورة ماتعملتش دلوقتي. ممكن تجرب تاني تحت.'));
    } catch (err) {
      setStatus('statusImageGen', '⚠️', 'var(--accent-coral)');
      addChat('assistant', `⚠️ ${err.message}`);
      btn.disabled = false;
      btn.textContent = t('✅ Confirm and furnish my room', '✅ أكّد وافرش أوضتي');
    }
  }

  // Item-by-item check of the generated image, done by a vision model on the server
  function renderCheck(v) {
    if (!v) return '';
    if (!v.checked) return `<div class="notice warn">${t('The image could not be checked automatically. Please compare it with your list.', 'ماقدرناش نراجع الصورة أوتوماتيك. قارنها بقائمتك.')}</div>`;
    const label = p => {
      const a = (state.pipeline?.budget?.allocations || []).find(x => x.itemKey === p.category);
      return a ? (ar() ? a.labelAr : a.labelEn) : p.category;
    };
    const row = i => {
      const status = !i.present ? `⚠️ ${t('not clearly in the image', 'مش باينة في الصورة')}`
        : i.count > 1 ? `⚠️ ${t(`appears ${i.count} times`, `ظاهرة ${i.count} مرات`)}`
        : i.looksLike === 'different' ? `🟡 ${t('in the image, looks a bit different', 'موجودة، بس شكلها مختلف شوية')}`
        : `✅ ${t('in the image', 'موجودة')}`;
      return `<tr><td><strong>${esc(label(i))}</strong></td><td>${status}</td></tr>`;
    };
    return `
      <div class="info-block" style="margin-top:12px;">
        <h4>${v.ok ? '✅ ' : ''}${t('Checked: is everything you chose in the image?', 'المراجعة: كل اللي اخترته موجود في الصورة؟')}</h4>
        <table class="changes-table"><tbody>${v.items.map(row).join('')}</tbody></table>
        ${v.majorExtras?.length ? `<p class="over-budget" style="font-size:12px;margin-top:6px;">⚠️ ${t('Extra furniture added (not chosen)', 'عفش زيادة اتضاف (مش من اختيارك)')}: ${esc(v.majorExtras.join(', '))}</p>` : ''}
        ${v.minorExtras?.length ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">${t('Small styling props added for the photo', 'إكسسوارات صغيرة اتضافت للصورة')}: ${esc(v.minorExtras.join(', '))}</p>` : ''}
      </div>`;
  }

  function renderResult({ image, finalDesign }) {
    // Image
    if (image?.status === 'SUCCESS') {
      setStatus('statusImageGen', t('✅ Done', '✅ خلصت'), 'var(--accent-green)');
      $('contentImageGen').innerHTML = `
        <div class="comparison-grid">
          <div class="comparison-box"><span class="comparison-label">${t('BEFORE', 'قبل')}</span><img src="${safeUrl(state.imageUrl)}" alt=""></div>
          <div class="comparison-box"><span class="comparison-label" style="background:rgba(46,160,67,.9);">${t('AFTER', 'بعد')}</span><img src="${safeUrl(image.imageUrl)}" alt=""></div>
        </div>
        ${renderCheck(image.verification)}
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">${t('AI preview: the real products may look slightly different.', 'صورة تخيلية بالذكاء الاصطناعي: المنتجات الحقيقية ممكن تختلف شوية.')}</p>`;
    } else {
      setStatus('statusImageGen', '⚠️', 'var(--accent-coral)');
      $('contentImageGen').innerHTML = `
        <div class="notice error">${esc(image?.message || t('The image could not be made.', 'الصورة ماتعملتش.'))}</div>
        <button type="button" class="btn btn-secondary" id="btnRetryImage">${t('🔄 Try the image again', '🔄 جرّب الصورة تاني')}</button>`;
      $('btnRetryImage').addEventListener('click', async () => {
        $('btnRetryImage').disabled = true;
        try {
          const data = await postJson('/api/image/retry', { sessionId: state.sessionId });
          state.result = { image: data.image, finalDesign: data.finalDesign };
          renderResult(state.result);
        } catch (err) {
          addChat('assistant', `⚠️ ${err.message}`);
          $('btnRetryImage').disabled = false;
        }
      });
    }

    // Final package
    const f = finalDesign;
    setStatus('statusFinal', t('✅ Ready', '✅ جاهز'), 'var(--accent-green)');
    $('contentFinal').innerHTML = `
      <div class="info-block" style="margin-bottom:14px;">
        <h4>${esc(f.summary.style)}</h4>
        <p>${esc(f.summary.concept)}</p>
        <div class="palette">${(f.summary.palette || []).map(c => `<span style="background:${/^#[0-9a-f]{6}$/i.test(c) ? c : '#999'}"></span>`).join('')}</div>
      </div>
      <div class="info-block">
        <h4>🛒 ${t('Your shopping list', 'قائمة المشتريات')}</h4>
        <table class="changes-table">
          <thead><tr><th></th><th>${t('Product', 'المنتج')}</th><th>${t('Store', 'المتجر')}</th><th>${t('Price', 'السعر')}</th><th>${t('Link', 'اللينك')}</th></tr></thead>
          <tbody>${f.products.map(p => `
            <tr>
              <td>${p.image_url ? `<img class="product-thumb" style="width:48px;height:48px;" src="${safeUrl(p.image_url)}" alt="">` : ''}</td>
              <td><strong>${esc(p.categoryLabel)}</strong><br><small>${esc(p.title)}</small></td>
              <td>${esc(p.site)}</td>
              <td><strong style="color:var(--accent-green);">${egp(p.price)}</strong></td>
              <td><a href="${safeUrl(p.product_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="padding:4px 10px;font-size:11px;">${t('Buy ↗', 'اشتري ↗')}</a></td>
            </tr>`).join('')}</tbody>
        </table>
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:14px;font-size:13px;font-weight:700;padding:12px;background:rgba(0,0,0,.2);border-radius:6px;">
          <span>${t('Budget', 'الميزانية')}: ${egp(f.budget.totalAllocated)}</span>
          <span>${t('Total', 'الإجمالي')}: ${egp(f.budget.estimatedTotal)}</span>
          <span class="${f.budget.remainingBudget < 0 ? 'over-budget' : ''}" style="color:${f.budget.remainingBudget >= 0 ? 'var(--accent-green)' : ''}">
            ${f.budget.remainingBudget >= 0 ? `${t('Left', 'باقي')}: ${egp(f.budget.remainingBudget)}` : `${t('Over by', 'زيادة')}: ${egp(-f.budget.remainingBudget)}`}
          </span>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">${esc(f.note)}</p>
      </div>`;
  }

  function updateTracker(active) {
    document.querySelectorAll('.step-node').forEach(node => {
      const step = Number(node.dataset.step);
      node.classList.toggle('completed', step < active);
      node.classList.toggle('active', step === active);
    });
  }

  applyLanguage(state.lang);
});
