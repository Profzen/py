// public/js/exchange.js — PARTIE 1 (corrigée)
(function(){
  // ====== DOM refs ======
  const $ = s => document.querySelector(s);
  const fromEl = $('#from'), toEl = $('#to'), amtEl = $('#amountFrom'), outEl = $('#amountTo');
  const doBtn = $('#do-exchange'), refreshRatesBtn = $('#refresh-rates'), ratesSourceEl = $('#rates-source');

  // ====== Defaults / placeholders ======
  const networkAddresses = {
    BEP20: '0xBEP20_DEFAULT_ADDR_ABC123',
    TRC20: 'TTRC20_DEFAULT_ADDR_ABC123',
    ERC20: '0xERC20_DEFAULT_ADDR_ABC123',
    BTC: '1BTC_DEFAULT_ADDR_abc123',
    LTC: 'LTC_DEFAULT_ADDR_abc123'
  };

  const defaultPayments = [
    { _id: 'pm_mix_by_yas', name: 'Mix by Yas', type: 'fiat', network: '', addressOrAccount: '99XXXXXX', details: '99XXXXXX', active: true },
    { _id: 'pm_moov', name: 'Moov Money', type: 'fiat', network: '', addressOrAccount: '99YYYYYY', details: '99YYYYYY', active: true },
    { _id: 'pm_ecobank', name: 'Ecobank', type: 'fiat', network: '', addressOrAccount: 'Compte: 1234567890', details: 'Compte: 1234567890', active: true },
    { _id: 'pm_bep20', name: 'BEP20 (receiving)', type: 'crypto', network: 'BEP20', addressOrAccount: networkAddresses.BEP20, details: networkAddresses.BEP20, active: true },
    { _id: 'pm_erc20', name: 'ERC20 (receiving)', type: 'crypto', network: 'ERC20', addressOrAccount: networkAddresses.ERC20, details: networkAddresses.ERC20, active: true }
  ];

  // shared caches / state
  let paymentsCache = [];
  const cachedPrices = new Map(); // pair -> { _ts, data }
  let autoRefreshInterval = null;

  // ====== UTIL: safe fetch JSON ======
  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, opts);
    const j = await res.json().catch(()=>null);
    if (!res.ok) {
      const err = new Error('Fetch error ' + res.status);
      err.status = res.status;
      err.payload = j;
      throw err;
    }
    return j;
  }

  // ====== Load payments (keeps window.PYExchange.paymentsCache in sync) ======
  async function loadPayments(){
    try{
      const res = await fetch('/api/payments');
      if(!res.ok) throw new Error('no payments endpoint');
      const data = await res.json();
      if(!Array.isArray(data) || data.length === 0) throw new Error('no payments data');
      paymentsCache = data.map(p => ({
        _id: p._id || p.id || (p.name + '_' + (p.network||'')),
        name: p.name || p.title || ('Moyen ' + (p.network || '')),
        type: (p.type || p.kind || 'fiat'),
        network: p.network || p.chain || '',
        addressOrAccount: p.addressOrAccount || p.address || p.details || p.account || '',
        details: p.addressOrAccount || p.address || p.details || p.account || '',
        active: typeof p.active === 'undefined' ? true : !!p.active
      }));
      // keep global copy in sync for PART 2
      if(window.PYExchange) window.PYExchange.paymentsCache = paymentsCache;
      return;
    }catch(err){
      console.warn('loadPayments fallback to defaults', err && err.message ? err.message : err);
      paymentsCache = defaultPayments.map(p => ({
        _id: p._id, name: p.name, type: p.type, network: p.network || '', addressOrAccount: p.addressOrAccount || p.details || '', details: p.details || p.addressOrAccount || '', active: !!p.active
      }));
      if(window.PYExchange) window.PYExchange.paymentsCache = paymentsCache;
    }
  }

  // ====== Determine type helper ======
  function determineType(from,to){
    const fiat = ['USD','EUR','XOF','FCFA','GHS'];
    const isFromFiat = fiat.includes((from||'').toUpperCase());
    const isToFiat = fiat.includes((to||'').toUpperCase());
    if(!isFromFiat && !isToFiat) return 'crypto-crypto';
    if(!isFromFiat && isToFiat) return 'crypto-fiat';
    if(isFromFiat && !isToFiat) return 'fiat-crypto';
    return 'fiat-fiat';
  }

  function isFiatCurrency(symbol){
    const fiat = ['USD','EUR','XOF','FCFA','GHS'];
    return fiat.includes((symbol||'').toUpperCase());
  }

  // ====== Smart formatter to avoid 0 when numbers extremely small ======
  function formatAmountSmart(value, quoteSymbol){
    if (value === null || typeof value === 'undefined' || !Number.isFinite(Number(value))) return '-';
    const v = Number(value);
    const isFiat = isFiatCurrency(quoteSymbol);
    if (isFiat) {
      if (Math.abs(v) >= 1) return Intl.NumberFormat(undefined, { maximumFractionDigits:0 }).format(v);
      return Intl.NumberFormat(undefined, { maximumFractionDigits:2 }).format(v);
    } else {
      const maxDecimals = 12;
      const s = v.toFixed(maxDecimals);
      return s.replace(/(?:\.0+|(\.\d+?)0+)$/,'$1');
    }
  }

  // ====== getPairPrice -> call /api/price and cache for 30s ======
  async function getPairPrice(base, quote, opts = {}) {
    const pair = `${String(base).toUpperCase().trim()}-${String(quote).toUpperCase().trim()}`;
    const key = pair;
    const now = Date.now();
    const cached = cachedPrices.get(key);
    if (cached && cached._ts && (now - cached._ts) < 30_000 && !opts.force) {
      return cached.data;
    }
    try {
      const params = new URLSearchParams();
      params.set('pair', pair);
      if (typeof opts.amount !== 'undefined') params.set('amount', String(opts.amount));
      if (opts.operation) params.set('operation', opts.operation);
      const resp = await fetch(`/api/price?${params.toString()}`);
      const j = await resp.json().catch(()=>null);
      if (!resp.ok || !j) {
        const fallback = { pair, coinbasePrice: 0, buyPriceForUs: 0, sellPriceForUs: 0, lastUpdated: new Date().toISOString(), raw: j };
        cachedPrices.set(key, { _ts: Date.now(), data: fallback });
        return fallback;
      }
      const data = {
        pair: j.pair || pair,
        coinbasePrice: Number(j.coinbasePrice || j.price || 0),
        buyPriceForUs: Number(j.buyPriceForUs || 0),
        sellPriceForUs: Number(j.sellPriceForUs || 0),
        lastUpdated: j.lastUpdated || new Date().toISOString(),
        raw: j
      };
      cachedPrices.set(key, { _ts: Date.now(), data });
      return data;
    } catch (err) {
      console.warn('getPairPrice err', err && (err.message || err));
      const fallback = { pair, coinbasePrice: 0, buyPriceForUs: 0, sellPriceForUs: 0, lastUpdated: new Date().toISOString() };
      cachedPrices.set(key, { _ts: Date.now(), data: fallback });
      return fallback;
    }
  }

  // ====== Load currencies into selects (uses /api/currencies) ======
  async function loadRatesOptions(){
    try{
      const r = await fetch('/api/currencies');
      const currencies = await r.json();
      if(Array.isArray(currencies) && currencies.length > 0) ratesSourceEl.innerText = '(taux: serveur)';
      else ratesSourceEl.innerText = '';

      const set = new Set();
      if(Array.isArray(currencies)){
        currencies.forEach(c => {
          if(c && c.symbol) set.add(String(c.symbol).toUpperCase());
        });
      }
      ['USD','EUR','BTC','ETH','USDT','USDC','SOL','XOF'].forEach(x => set.add(x));
      const arr = Array.from(set).sort();
      fromEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
      toEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
    }catch(e){
      console.error('loadRatesOptions err', e);
      const arr = ['USD','BTC','ETH','USDT','XOF'];
      fromEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
      toEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
      ratesSourceEl.innerText = '(taux: défaut)';
    }
  }

  // ====== Refresh visible conversion (updates amountTo and shows price + timestamp) ======
  async function refreshVisibleConversion(opts = {}) {
    const f = (fromEl.value||'').toUpperCase();
    const t = (toEl.value||'').toUpperCase();
    const amt = Number(amtEl.value || 0);
    if(!f || !t || !amt) {
      outEl.value = '';
      ratesSourceEl.innerText = '';
      return;
    }

    const typ = determineType(f,t);
    let operation = null;
    if (typ === 'crypto-fiat') operation = 'sell';
    else if (typ === 'fiat-crypto') operation = 'buy';

    const priceData = await getPairPrice(f, t, { amount: amt, operation, force: !!opts.force });
    let usedPrice = null;
    if(operation === 'sell') usedPrice = priceData.buyPriceForUs || priceData.coinbasePrice;
    else if(operation === 'buy') usedPrice = priceData.sellPriceForUs || priceData.coinbasePrice;
    else usedPrice = priceData.coinbasePrice || priceData.buyPriceForUs || priceData.sellPriceForUs || 1;

    const amountTo = Number(amt) * Number(usedPrice);

    outEl.value = formatAmountSmart(amountTo, t);

    const cb = formatAmountSmart(priceData.coinbasePrice, t);
    const applied = formatAmountSmart(usedPrice, t);
    const ts = priceData.lastUpdated ? new Date(priceData.lastUpdated).toLocaleString() : (new Date()).toLocaleString();
    ratesSourceEl.innerText = `(market: ${cb} · applied: ${applied} · updated: ${ts})`;
  }

  // ====== Calculation bound to inputs ======
  async function calculate(){
    try {
      await refreshVisibleConversion();
    } catch (e) {
      console.warn('calculate err', e);
      outEl.value = '';
    }
  }

  fromEl && fromEl.addEventListener('change', () => { calculate(); });
  toEl && toEl.addEventListener('change', () => { calculate(); });
  amtEl && amtEl.addEventListener('input', () => { calculate(); });

  // ====== Auto-refresh logic (updates visible conversion every 30s) ======
  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshInterval = setInterval(() => {
      refreshVisibleConversion().catch(err => console.warn('auto-refresh err', err));
    }, 30_000);
  }
  function stopAutoRefresh() {
    if(autoRefreshInterval){ clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
  }
  startAutoRefresh();

  // manual refresh
  refreshRatesBtn && refreshRatesBtn.addEventListener('click', async () => {
    try {
      await loadRatesOptions();
      await refreshVisibleConversion({ force: true });
      alert('Taux et aperçu rafraîchis');
    } catch (e) {
      console.warn('manual refresh failed', e);
      alert('Erreur lors du rafraîchissement');
    }
  });

  // ====== Payment method and network UI builders ======
  function buildPaymentMethodSelect(nameAttr, filterType='fiat'){
    const sel = document.createElement('select');
    sel.name = nameAttr;
    sel.required = true;
    sel.style.padding = '8px';
    sel.style.borderRadius = '8px';
    sel.style.border = '1px solid var(--border)';
    sel.innerHTML = `<option value="">-- choisir moyen --</option>`;
    const filtered = (paymentsCache || []).filter(p => (p.type||'').toLowerCase() === (filterType||'').toLowerCase() && p.active);
    if(filtered.length === 0){
      defaultPayments.filter(p => p.type === filterType).forEach(p => {
        const details = (p.details || p.addressOrAccount || '');
        sel.innerHTML += `<option value="${encodeURIComponent(p._id)}" data-details="${encodeURIComponent(details)}">${p.name}${p.network ? ' ('+p.network+')' : ''}</option>`;
      });
    } else {
      filtered.forEach(p => {
        const details = (p.details || p.addressOrAccount || '');
        sel.innerHTML += `<option value="${encodeURIComponent(p._id)}" data-details="${encodeURIComponent(details)}" data-network="${encodeURIComponent(p.network||'')}" data-name="${encodeURIComponent(p.name||'')}">${p.name}${p.network ? ' ('+p.network+')' : ''}</option>`;
      });
    }
    return sel;
  }

  function buildNetworkSelect(nameAttr){
    const networks = ['BEP20','TRC20','ERC20','BTC','LTC'];
    const sel = document.createElement('select');
    sel.name = nameAttr;
    sel.required = true;
    sel.style.padding = '8px';
    sel.style.borderRadius = '8px';
    sel.style.border = '1px solid var(--border)';
    sel.innerHTML = `<option value="">-- choisir réseau --</option>` + networks.map(n => `<option value="${n}">${n}</option>`).join('');
    return sel;
  }

  // ====== Helpers used later in modal ======
  function createLabel(text){
    const l = document.createElement('label'); l.innerText = text; return l;
  }
  function createLabelInput(labelText, name, type='text', required=false){
    const wrapper = document.createElement('div');
    const l = document.createElement('label'); l.innerText = labelText;
    const inp = document.createElement('input'); inp.name = name; inp.type = type; if(required) inp.required = true;
    wrapper.appendChild(l); wrapper.appendChild(inp);
    return wrapper;
  }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ====== Proof uploader UI builder ======
  function createProofUploaderContainer() {
    const wrapper = document.createElement('div');
    wrapper.className = 'proof-uploader';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    fileInput.name = 'proof';
    fileInput.setAttribute('aria-label', 'Preuve de paiement (image/pdf/doc)');

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn ghost';
    uploadBtn.innerText = 'Uploader preuve';

    const status = document.createElement('div');
    status.className = 'proof-status small muted';
    status.style.marginLeft = '8px';

    const preview = document.createElement('div');
    preview.className = 'proof-preview';

    wrapper.appendChild(fileInput);
    wrapper.appendChild(uploadBtn);
    wrapper.appendChild(status);
    wrapper.appendChild(preview);

    uploadBtn.addEventListener('click', async () => {
      if(!fileInput.files || fileInput.files.length === 0){
        status.innerText = 'Veuillez choisir un fichier.';
        return;
      }
      const file = fileInput.files[0];
      const allowed = [
        'image/jpeg','image/jpg','image/png',
        'application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      if(!allowed.includes(file.type)){
        status.innerText = 'Type de fichier non autorisé.';
        return;
      }
      const MAX = 8 * 1024 * 1024;
      if(file.size > MAX){
        status.innerText = 'Fichier trop volumineux (max 8MB).';
        return;
      }

      status.innerText = 'Upload...';
      uploadBtn.disabled = true;

      try {
        const fd = new FormData();
        fd.append('proof', file);

        const token = localStorage.getItem('token');
        const headers = {};
        if(token) headers['Authorization'] = 'Bearer ' + token;

        const resp = await fetch('/api/upload-proof', { method: 'POST', body: fd, headers });
        const j = await resp.json().catch(()=>null);
        if(!resp.ok || !j || !j.ok){
          status.innerText = 'Upload échoué';
          uploadBtn.disabled = false;
          return;
        }
        status.innerText = 'Upload réussi';
        preview.innerHTML = '';
        if(file.type.startsWith('image/')){
          const img = document.createElement('img');
          img.src = j.url;
          img.alt = 'Preuve';
          preview.appendChild(img);
        } else {
          const a = document.createElement('a');
          a.href = j.url;
          a.target = '_blank';
          a.innerText = j.filename || 'Voir preuve';
          preview.appendChild(a);
        }

        const form = wrapper.closest('form') || document.querySelector('.modal form');
        if(form){
          const existing = form.querySelector('input[name="proof_url"]'); if(existing) existing.remove();
          const inUrl = document.createElement('input'); inUrl.type = 'hidden'; inUrl.name = 'proof_url'; inUrl.value = j.url || '';
          form.appendChild(inUrl);

          const existing2 = form.querySelector('input[name="proof_public_id"]'); if(existing2) existing2.remove();
          const inId = document.createElement('input'); inId.type = 'hidden'; inId.name = 'proof_public_id'; inId.value = j.public_id || '';
          form.appendChild(inId);

          const existing3 = form.querySelector('input[name="proof_mime"]'); if(existing3) existing3.remove();
          const inMime = document.createElement('input'); inMime.type = 'hidden'; inMime.name = 'proof_mime'; inMime.value = j.mimeType || '';
          form.appendChild(inMime);

          const existing4 = form.querySelector('input[name="proof_filename"]'); if(existing4) existing4.remove();
          const inFn = document.createElement('input'); inFn.type = 'hidden'; inFn.name = 'proof_filename'; inFn.value = j.filename || '';
          form.appendChild(inFn);
        }

      } catch (err){
        console.warn('upload proof error', err);
        status.innerText = 'Erreur upload';
      } finally {
        uploadBtn.disabled = false;
      }
    });

    return wrapper;
  }

  // expose utilities for PART 2 and debugging
  window.PYExchange = window.PYExchange || {};
  Object.assign(window.PYExchange, {
    loadPayments,
    loadRatesOptions,
    // expose current paymentsCache reference (will be updated by loadPayments)
    paymentsCache,
    getPairPrice,
    cachedPrices,
    determineType,
    isFiatCurrency,
    networkAddresses,
    createProofUploaderContainer,
    buildPaymentMethodSelect,
    buildNetworkSelect,
    formatAmountSmart,
    fetchJson,
    // expose helpers used by PART2
    createLabel,
    createLabelInput,
    escapeHtml
  });

  // initialize selects & payments on load
  (async function init(){
    await loadPayments();
    await loadRatesOptions();
    calculate();
  })();

})(); // end PART 1 IIFE
// public/js/exchange.js — PARTIE 2 (corrigée)
(function(){
  // consume shared utilities exported from PART 1
  const PX = window.PYExchange || {};
  const getPairPrice = PX.getPairPrice;
  const createProofUploaderContainer = PX.createProofUploaderContainer;
  const buildPaymentMethodSelect = PX.buildPaymentMethodSelect;
  const buildNetworkSelect = PX.buildNetworkSelect;
  const determineType = PX.determineType;
  const isFiatCurrency = PX.isFiatCurrency;
  const networkAddresses = PX.networkAddresses;
  const formatAmountSmart = PX.formatAmountSmart;
  const fetchJson = PX.fetchJson;
  const createLabel = PX.createLabel;
  const createLabelInput = PX.createLabelInput;
  const escapeHtml = PX.escapeHtml;
  const $ = s => document.querySelector(s);

  if(!getPairPrice){
    console.error('PYExchange.getPairPrice missing — ensure PART 1 loaded before PART 2');
  }

  // ======= Modal / Transaction UI (extends previous modal logic) =======
  function openTransactionModal(base){
    const modal = document.createElement('div'); modal.className = 'modal';
    const box = document.createElement('div'); box.className = 'box';
    modal.appendChild(box);

    const h = document.createElement('h3'); h.innerText = 'Confirmer la transaction';
    const small = document.createElement('div'); small.className = 'small'; small.innerText = `Type: ${base.type} — ${base.from} → ${base.to}`;
    box.appendChild(h); box.appendChild(small);

    const form = document.createElement('form');
    form.style.display = 'flex'; form.style.flexDirection = 'column'; form.style.gap = '8px';
    box.appendChild(form);

    form.appendChild(createLabelInput('Prénom','firstName','text',true));
    form.appendChild(createLabelInput('Nom','lastName','text',true));
    form.appendChild(createLabelInput('Email','email','email',true));
    form.appendChild(createLabelInput('Téléphone','phone','text',true));

    const dyn = document.createElement('div'); dyn.id = 'tx-dynamic'; dyn.style.display='flex'; dyn.style.flexDirection='column'; dyn.style.gap='8px';
    form.appendChild(dyn);

    const previewBox = document.createElement('div');
    previewBox.className = 'live-exchange-preview';
    previewBox.style.borderTop = '1px dashed var(--border)';
    previewBox.style.paddingTop = '10px';
    previewBox.style.marginTop = '6px';
    previewBox.innerHTML = `<div class="small muted">Aperçu de la conversion (mis à jour toutes les 30s)</div><div id="preview-content" style="margin-top:6px">Chargement...</div><div style="margin-top:6px"><button type="button" id="modal-refresh-btn" class="btn ghost">Rafraîchir</button></div>`;
    form.appendChild(previewBox);

    async function updatePreview(force=false){
      const content = previewBox.querySelector('#preview-content');
      content.innerHTML = 'Chargement...';
      try {
        const typ = determineType(base.from, base.to);
        let operation = null;
        if (typ === 'crypto-fiat') operation = 'sell';
        else if (typ === 'fiat-crypto') operation = 'buy';

        const priceData = await getPairPrice(base.from, base.to, { amount: base.amountFrom, operation, force });
        const usedPrice = (operation === 'sell') ? priceData.buyPriceForUs : (operation === 'buy') ? priceData.sellPriceForUs : priceData.coinbasePrice;
        const amountTo = Number(base.amountFrom) * Number(usedPrice);

        const displayQuote = formatAmountSmart(amountTo, base.to);
        const coinbaseFmt = formatAmountSmart(priceData.coinbasePrice, base.to);
        const appliedFmt = formatAmountSmart(usedPrice, base.to);
        const ts = priceData.lastUpdated ? new Date(priceData.lastUpdated).toLocaleString() : new Date().toLocaleString();

        content.innerHTML = `
          <div><strong>Prix marché (Coinbase):</strong> ${coinbaseFmt} ${escapeHtml(base.to)}</div>
          <div style="margin-top:6px"><strong>Prix appliqué:</strong> ${appliedFmt} ${escapeHtml(base.to)} (${operation === 'sell' ? 'nous achetons' : operation === 'buy' ? 'nous vendons' : 'spot'})</div>
          <div style="margin-top:8px"><strong>Montant:</strong> ${Number(base.amountFrom).toLocaleString()} ${escapeHtml(base.from)} ≈ <strong>${displayQuote} ${escapeHtml(base.to)}</strong></div>
          <div class="small muted" style="margin-top:6px">Dernière mise à jour: ${ts}</div>
        `;

        ['snapshot_coinbase','snapshot_price','snapshot_price_mode','snapshot_quote','snapshot_amount_quote'].forEach(name => {
          const ex = form.querySelector(`input[name="${name}"]`);
          if(ex) ex.remove();
        });
        const h1 = document.createElement('input'); h1.type='hidden'; h1.name='snapshot_coinbase'; h1.value = String(priceData.coinbasePrice || '');
        const h2 = document.createElement('input'); h2.type='hidden'; h2.name='snapshot_price'; h2.value = String(usedPrice || '');
        const h3 = document.createElement('input'); h3.type='hidden'; h3.name='snapshot_price_mode'; h3.value = operation || 'spot';
        const h4 = document.createElement('input'); h4.type='hidden'; h4.name='snapshot_quote'; h4.value = base.to;
        const h5 = document.createElement('input'); h5.type='hidden'; h5.name='snapshot_amount_quote'; h5.value = String(amountTo || '');
        form.appendChild(h1); form.appendChild(h2); form.appendChild(h3); form.appendChild(h4); form.appendChild(h5);

      } catch (err) {
        console.warn('updatePreview err', err && err.message ? err.message : err);
        content.innerHTML = '<div class="muted small">Impossible de récupérer l’aperçu pour le moment.</div>';
      }
    }

    (async function buildDynamic(){
      dyn.innerHTML = '';

      function appendProofUploader(container){
        const pu = createProofUploaderContainer();
        container.appendChild(pu);
        return pu;
      }

      const localPaymentsCache = (window.PYExchange && window.PYExchange.paymentsCache) || [];

      if(base.type === 'crypto-fiat'){
        dyn.appendChild(createLabel('Réseau d\'envoi'));
        const sendNet = buildNetworkSelect('sendNetwork');
        dyn.appendChild(sendNet);

        const sendAddrBox = document.createElement('div'); sendAddrBox.className='network-address';
        sendAddrBox.innerHTML = `<div class="tx-instruction">Adresse d'envoi</div><div class="tx-note muted">Choisissez le réseau d'envoi pour afficher l'adresse à laquelle envoyer votre crypto.</div><div id="send-address">-</div>`;
        dyn.appendChild(sendAddrBox);

        dyn.appendChild(createLabel('Moyen de réception (où recevoir la monnaie locale)'));
        const recvMethodSelect = buildPaymentMethodSelect('recvPaymentMethod','fiat');
        dyn.appendChild(recvMethodSelect);

        dyn.appendChild(createLabelInput('Compte / numéro de réception','recvAccount','text',true));

        appendProofUploader(dyn);

        sendNet.addEventListener('change', async () => {
          const net = sendNet.value;
          const found = (localPaymentsCache || []).find(p => (p.type||'') === 'crypto' && (p.network||'').toUpperCase() === (net||'').toUpperCase() && p.active);
          const details = found ? (found.details || found.addressOrAccount || '') : (networkAddresses[net] || (`ADRESSE_${net}_PAR_DEFAUT`));
          const priceData = await getPairPrice(base.from, base.to, { amount: base.amountFrom, operation: 'sell' });
          const usedPrice = priceData.buyPriceForUs || priceData.coinbasePrice || 0;
          const amountTo = Number(base.amountFrom) * Number(usedPrice);
          sendAddrBox.querySelector('#send-address').innerHTML = `<div class="tx-note">Envoyer <strong>${base.amountFrom}</strong> ${base.from} (≈ <strong>${formatAmountSmart(amountTo, base.to)} ${base.to}</strong>) vers :</div><div style="margin-top:6px;font-family:monospace">${escapeHtml(details)}</div>`;
        });

        recvMethodSelect.addEventListener('change', async () => {
          const opt = recvMethodSelect.selectedOptions[0];
          let details = opt && opt.dataset && opt.dataset.details ? decodeURIComponent(opt.dataset.details) : '';
          if(!details){
            const val = opt && opt.value ? decodeURIComponent(opt.value) : null;
            const found = (localPaymentsCache || []).find(p => String(p._id) === String(val));
            details = found ? (found.details || found.addressOrAccount || '') : '';
          }
          const priceData = await getPairPrice(base.from, base.to, { amount: base.amountFrom, operation: 'sell' });
          const usedPrice = priceData.buyPriceForUs || priceData.coinbasePrice || 0;
          const amountTo = Number(base.amountFrom) * Number(usedPrice);
          let note = dyn.querySelector('.recv-method-note'); if(!note){ note = document.createElement('div'); note.className = 'recv-method-note muted'; dyn.appendChild(note); }
          note.innerHTML = details ? `<div style="font-family:monospace">${escapeHtml(details)}</div><div class="small muted" style="margin-top:6px">Nous recevrons et paierons ≈ <strong>${formatAmountSmart(amountTo, base.to)} ${base.to}</strong> à l'approbation.</div>` : '-';
        });

      } else if(base.type === 'crypto-crypto'){
        dyn.appendChild(createLabel('Réseau d\'envoi'));
        const sendNet = buildNetworkSelect('sendNetwork');
        dyn.appendChild(sendNet);

        const sendAddrBox = document.createElement('div'); sendAddrBox.className='network-address';
        sendAddrBox.innerHTML = `<div class="tx-instruction">Adresse d'envoi</div><div class="tx-note muted">Choisissez le réseau d'envoi pour afficher l'adresse.</div><div id="send-address">-</div>`;
        dyn.appendChild(sendAddrBox);

        dyn.appendChild(createLabel('Réseau de réception'));
        const recvNet = buildNetworkSelect('recvNetwork');
        dyn.appendChild(recvNet);

        dyn.appendChild(createLabelInput('Adresse crypto destinataire','recvAddress','text',true));
        appendProofUploader(dyn);

        sendNet.addEventListener('change', async () => {
          const net = sendNet.value;
          const found = (localPaymentsCache || []).find(p => (p.type||'') === 'crypto' && (p.network||'').toUpperCase() === (net||'').toUpperCase() && p.active);
          const details = found ? (found.details || found.addressOrAccount || '') : (networkAddresses[net] || (`ADRESSE_${net}_PAR_DEFAUT`));
          sendAddrBox.querySelector('#send-address').innerHTML = `<div class="tx-note">Envoyer <strong>${base.amountFrom}</strong> ${base.from} vers :</div><div style="margin-top:6px;font-family:monospace">${escapeHtml(details)}</div>`;
        });

      } else if(base.type === 'fiat-crypto'){
        dyn.appendChild(createLabel('Moyen de paiement (comment vous payez)'));
        const paySel = buildPaymentMethodSelect('payMethod','fiat');
        dyn.appendChild(paySel);

        const payBox = document.createElement('div'); payBox.className='network-address';
        payBox.innerHTML = `<div class="tx-instruction">Informations paiement</div><div class="tx-note muted">Choisissez un moyen pour afficher le numéro/compte à utiliser et envoyer le montant à échanger.</div><div id="pay-info">-</div>`;
        dyn.appendChild(payBox);

        dyn.appendChild(createLabel('Réseau de réception (où recevoir la crypto)'));
        const recvNet = buildNetworkSelect('recvNetwork');
        dyn.appendChild(recvNet);

        dyn.appendChild(createLabelInput('Adresse crypto de réception','recvAddress','text',true));
        const proofInput = appendProofUploader(dyn);

        paySel.addEventListener('change', async () => {
          const opt = paySel.selectedOptions[0];
          let details = opt && opt.dataset && opt.dataset.details ? decodeURIComponent(opt.dataset.details) : '';
          if(!details){
            const val = opt && opt.value ? decodeURIComponent(opt.value) : null;
            const found = (localPaymentsCache || []).find(p => String(p._id) === String(val));
            details = found ? (found.details || found.addressOrAccount || '') : '';
          }
          const priceData = await getPairPrice(base.from, base.to, { amount: base.amountFrom, operation: 'buy' });
          const usedPrice = priceData.sellPriceForUs || priceData.coinbasePrice || 0;
          const amountTo = Number(base.amountFrom) * Number(usedPrice);
          payBox.querySelector('#pay-info').innerHTML = details
            ? `<div style="font-family:monospace">${escapeHtml(details)}</div><div class="small muted" style="margin-top:6px">Envoyer <strong>${base.amountFrom}</strong> ${base.from} (≈ <strong>${formatAmountSmart(amountTo, base.to)} ${base.to}</strong>).</div>`
            : '-';
        });

      } else if(base.type === 'fiat-fiat'){
        dyn.appendChild(createLabel('Moyen de paiement (payer)'));
        const paySel = buildPaymentMethodSelect('payMethod','fiat');
        dyn.appendChild(paySel);

        const payBox = document.createElement('div'); payBox.className='network-address';
        payBox.innerHTML = `<div class="tx-instruction">Infos paiement</div><div class="tx-note muted">Choisissez un moyen pour afficher le numéro/compte à utiliser, et envoyer le montant à échanger.</div><div id="pay-info">-</div>`;
        dyn.appendChild(payBox);

        dyn.appendChild(createLabel('Moyen de réception (recevoir)'));
        const recvSel = buildPaymentMethodSelect('recvPaymentMethod','fiat');
        dyn.appendChild(recvSel);

        dyn.appendChild(createLabelInput('Compte / numéro de réception','recvAccount','text',true));
        appendProofUploader(dyn);

        paySel.addEventListener('change', async () => {
          const opt = paySel.selectedOptions[0];
          let details = opt && opt.dataset && opt.dataset.details ? decodeURIComponent(opt.dataset.details) : '';
          if(!details){
            const val = opt && opt.value ? decodeURIComponent(opt.value) : null;
            const found = (localPaymentsCache || []).find(p => String(p._id) === String(val));
            details = found ? (found.details || found.addressOrAccount || '') : '';
          }
          const priceData = await getPairPrice(base.from, base.to, { amount: base.amountFrom });
          const usedPrice = priceData.coinbasePrice || priceData.sellPriceForUs || 0;
          const amountTo = Number(base.amountFrom) * Number(usedPrice);
          payBox.querySelector('#pay-info').innerHTML = details
            ? `<div style="font-family:monospace">${escapeHtml(details)}</div><div class="small muted" style="margin-top:6px">Envoyer <strong>${base.amountFrom}</strong> ${base.from} (≈ <strong>${formatAmountSmart(amountTo, base.to)} ${base.to}</strong>).</div>`
            : '-';
        });
      }

      updatePreview().catch(()=>{});
      if(window.__modalPreviewTimer) { clearInterval(window.__modalPreviewTimer); window.__modalPreviewTimer = null; }
      window.__modalPreviewTimer = setInterval(() => updatePreview().catch(()=>{}), 30_000);

      const modalRefresh = previewBox.querySelector('#modal-refresh-btn');
      modalRefresh.addEventListener('click', async () => {
        await updatePreview(true);
      });

    })();

    const actions = document.createElement('div');
    actions.style.display = 'flex'; actions.style.justifyContent='flex-end'; actions.style.gap = '8px'; actions.style.marginTop='10px';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn ghost'; cancel.innerText = 'Annuler';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'btn'; submit.innerText = 'Confirmer';
    actions.appendChild(cancel); actions.appendChild(submit);
    form.appendChild(actions);

    cancel.addEventListener('click', (e)=>{ e.preventDefault(); cleanupAndRemove(); });

    function cleanupAndRemove(){
      if(window.__modalPreviewTimer){ clearInterval(window.__modalPreviewTimer); window.__modalPreviewTimer = null; }
      modal.remove();
    }

    function findProofFileInput(formEl) {
      return formEl.querySelector('input[type="file"][name="proofFile"]') || formEl.querySelector('input[type="file"][name="proof"]');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true; submit.innerText = 'Envoi...';

      const fd = new FormData(form);
      const details = {};
      for (const [k,v] of fd.entries()) details[k] = v;

      const snapshot = {
        coinbasePrice: form.querySelector('input[name="snapshot_coinbase"]') ? form.querySelector('input[name="snapshot_coinbase"]').value : '',
        appliedPrice: form.querySelector('input[name="snapshot_price"]') ? form.querySelector('input[name="snapshot_price"]').value : '',
        priceMode: form.querySelector('input[name="snapshot_price_mode"]') ? form.querySelector('input[name="snapshot_price_mode"]').value : '',
        quoteCurrency: form.querySelector('input[name="snapshot_quote"]') ? form.querySelector('input[name="snapshot_quote"]').value : '',
        amountQuote: form.querySelector('input[name="snapshot_amount_quote"]') ? form.querySelector('input[name="snapshot_amount_quote"]').value : ''
      };
      details.priceSnapshot = snapshot;

      const fileInput = findProofFileInput(form);
      let proof = null;
      try {
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
          const f = fileInput.files[0];
          const up = new FormData();
          up.append('file', f, f.name);
          const upRes = await fetch('/api/upload-proof', { method: 'POST', body: up });
          const upJson = await upRes.json().catch(()=>null);
          if (upRes.ok && upJson && upJson.success) {
            proof = upJson.proof || { url: upJson.url || upJson.url, public_id: upJson.public_id, mimeType: upJson.mimeType, filename: upJson.filename };
          } else {
            details.proofUploadError = upJson && upJson.message ? upJson.message : 'upload failed';
          }
        } else {
          const hiddenUrl = form.querySelector('input[name="proof_url"]');
          if(hiddenUrl && hiddenUrl.value) {
            proof = { url: hiddenUrl.value, public_id: (form.querySelector('input[name="proof_public_id"]') || {}).value || '', mimeType: (form.querySelector('input[name="proof_mime"]') || {}).value || '', filename: (form.querySelector('input[name="proof_filename"]') || {}).value || '' };
          }
        }
      } catch (uplErr) {
        console.warn('upload error', uplErr);
      }

      try {
        let amountTo = Number(snapshot.amountQuote || 0);
        if(!amountTo){
          const typ = determineType(base.from, base.to);
          let operation = null;
          if (typ === 'crypto-fiat') operation = 'sell';
          else if (typ === 'fiat-crypto') operation = 'buy';
          const priceData = await getPairPrice(base.from, base.to, { amount: base.amountFrom, operation });
          const usedPrice = (operation === 'sell') ? priceData.buyPriceForUs : (operation === 'buy') ? priceData.sellPriceForUs : priceData.coinbasePrice;
          amountTo = Number(base.amountFrom) * Number(usedPrice);
          details.priceSnapshot = {
            coinbasePrice: priceData.coinbasePrice,
            appliedPrice: usedPrice,
            priceMode: operation || 'spot',
            quoteCurrency: base.to,
            amountQuote: amountTo
          };
        }

        const tx = {
          from: base.from,
          to: base.to,
          amountFrom: Number(base.amountFrom),
          amountTo: Number(amountTo),
          type: base.type,
          details,
          proof
        };

        const token = localStorage.getItem('token');
        const headers = {'Content-Type':'application/json'};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const resp = await fetch('/api/transactions', { method: 'POST', headers, body: JSON.stringify(tx) });
        const j = await resp.json().catch(()=>null);
        if (resp.ok && j && j.success) {
          alert('Transaction enregistrée (pending).');
          const local = JSON.parse(localStorage.getItem('guestTx') || '[]');
          local.unshift({ ...tx, status: 'pending', createdAt: new Date().toISOString(), _id: j.transaction ? j.transaction._id : ('local_'+Date.now()) });
          localStorage.setItem('guestTx', JSON.stringify(local));
          cleanupAndRemove();
          window.location.href = '/historique';
          return;
        } else {
          console.warn('tx create not ok', j);
        }
      } catch (err) {
        console.warn('submit error', err);
      }

      const local = JSON.parse(localStorage.getItem('guestTx') || '[]');
      local.unshift({ from: base.from, to: base.to, amountFrom: base.amountFrom, amountTo: base.amountFrom, type: base.type, details, status: 'pending', createdAt: new Date().toISOString(), _id: 'local_'+Date.now(), proof });
      localStorage.setItem('guestTx', JSON.stringify(local));
      alert('Serveur indisponible — transaction sauvegardée localement.');
      cleanupAndRemove();
      window.location.href = '/historique';
    });

    modal.addEventListener('click', (e)=> { if(e.target === modal) cleanupAndRemove(); });

    document.body.appendChild(modal);
    const first = form.querySelector('input[name="firstName"]');
    if(first) first.focus();
  } // end openTransactionModal

  // Wire main button to open modal
  const mainDoBtn = $('#do-exchange');
  if(mainDoBtn){
    mainDoBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const fromEl = document.querySelector('#from');
      const toEl = document.querySelector('#to');
      const amtEl = document.querySelector('#amountFrom');
      const from = (fromEl && fromEl.value || '').toUpperCase();
      const to = (toEl && toEl.value || '').toUpperCase();
      const amt = Number(amtEl && amtEl.value || 0);
      if(!from || !to || !amt){ alert('Veuillez remplir les champs'); return; }
      const type = determineType(from,to);
      // ensure payments loaded
      if((window.PYExchange && (window.PYExchange.paymentsCache || []).length) === 0){
        try { await window.PYExchange.loadPayments(); } catch(e){ /* ignore */ }
      }
      openTransactionModal({ from, to, amountFrom: amt, type });
    });
  }

  // Expose for debugging
  window.PYExchange = window.PYExchange || {};
  window.PYExchange.openTransactionModal = openTransactionModal;

})(); // end PART 2 IIFE
