// public/js/exchange.js
(function(){
  // DOM refs
  const $ = s => document.querySelector(s);
  const fromEl = $('#from'), toEl = $('#to'), amtEl = $('#amountFrom'), outEl = $('#amountTo');
  const doBtn = $('#do-exchange'), refreshRatesBtn = $('#refresh-rates'), ratesSourceEl = $('#rates-source');

  // Page-level preview refs (these exist in views/exchange.html)
  const previewPairEl = $('#preview-pair');
  const previewMarketEl = $('#preview-market');
  const previewAppliedEl = $('#preview-applied');
  const previewReceivedEl = $('#preview-received');
  const previewLastUpdatedEl = $('#preview-last-updated');

  // Default addresses (placeholders)
  const networkAddresses = {
    BEP20: '0xBEP20_DEFAULT_ADDR_ABC123',
    TRC20: 'TTRC20_DEFAULT_ADDR_ABC123',
    ERC20: '0xERC20_DEFAULT_ADDR_ABC123',
    BTC: '1BTC_DEFAULT_ADDR_abc123',
    LTC: 'LTC_DEFAULT_ADDR_abc123'
  };

  // default payments fallback (used when /api/payments fails)
  const defaultPayments = [
    { _id: 'pm_mix_by_yas', name: 'Mix by Yas', type: 'fiat', network: '', addressOrAccount: '99XXXXXX', details: '99XXXXXX', active: true },
    { _id: 'pm_moov', name: 'Moov Money', type: 'fiat', network: '', addressOrAccount: '99YYYYYY', details: '99YYYYYY', active: true },
    { _id: 'pm_ecobank', name: 'Ecobank', type: 'fiat', network: '', addressOrAccount: 'Compte: 1234567890', details: 'Compte: 1234567890', active: true },
    { _id: 'pm_bep20', name: 'BEP20 (receiving)', type: 'crypto', network: 'BEP20', addressOrAccount: networkAddresses.BEP20, details: networkAddresses.BEP20, active: true },
    { _id: 'pm_erc20', name: 'ERC20 (receiving)', type: 'crypto', network: 'ERC20', addressOrAccount: networkAddresses.ERC20, details: networkAddresses.ERC20, active: true }
  ];

  let paymentsCache = [];

  async function loadPayments(){
    try{
      const res = await fetch('/api/payments');
      if(!res.ok) throw new Error('no payments endpoint');
      const data = await res.json();
      // If API returns object with methods list
      const arr = Array.isArray(data) ? data : (data.methods || data);
      if(!Array.isArray(arr) || arr.length === 0) throw new Error('no payments data');
      paymentsCache = arr.map(p => ({
        _id: p._id || p.id || (p.name + '_' + (p.network||'')),
        name: p.name || p.title || ('Moyen ' + (p.network || '')),
        type: (p.type || p.kind || 'fiat'),
        network: p.network || p.chain || '',
        addressOrAccount: p.addressOrAccount || p.address || p.details || p.account || '',
        details: p.addressOrAccount || p.address || p.details || p.account || '',
        active: typeof p.active === 'undefined' ? true : !!p.active
      }));
      return;
    }catch(err){
      console.warn('loadPayments fallback to defaults', err && err.message ? err.message : err);
      paymentsCache = defaultPayments.map(p => ({
        _id: p._id, name: p.name, type: p.type, network: p.network || '', addressOrAccount: p.addressOrAccount || p.details || '', details: p.details || p.addressOrAccount || '', active: !!p.active
      }));
    }
  }

  // Client-side currencies list loader (uses new endpoint /api/currencies or /api/rates fallback)
  async function loadRatesOptions(){
    try{
      let r = await fetch('/api/currencies');
      if(!r.ok) r = await fetch('/api/rates'); // fallback
      const data = await r.json();
      // support responses { currencies: [...] } or plain array
      const list = Array.isArray(data) ? data : (data.currencies || data.rates || []);
      const set = new Set();
      if(Array.isArray(list)){
        list.forEach(item => {
          if(item.symbol) set.add(String(item.symbol).toUpperCase());
          else if(item.pair) {
            const parts = String(item.pair).split('-');
            if(parts.length===2){ set.add(parts[0]); set.add(parts[1]); }
          } else if(typeof item === 'string') set.add(String(item).toUpperCase());
        });
      }
      // ensure some defaults
      ['USD','EUR','BTC','ETH','USDT','USDC','SOL','XOF','CFA'].forEach(x => set.add(x));
      const arr = Array.from(set).sort();
      fromEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
      toEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
      ratesSourceEl.innerText = '(taux: serveur)';
    }catch(e){
      console.error('loadRatesOptions err', e);
      const arr = ['USD','BTC','ETH','USDT'];
      fromEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
      toEl.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join('');
      ratesSourceEl.innerText = '(taux: défaut)';
    }
  }

  // ---------------------------
  // Price fetching helpers
  // ---------------------------
  // client-side short cache per pair to avoid spamming server
  const clientPairCache = {}; // key -> { ts, payload }
  const CLIENT_TTL = 15 * 1000; // 15s as required

  async function fetchPairPrice(from, to, force=false){
    const key = `${String(from).toUpperCase()}-${String(to).toUpperCase()}`;
    const now = Date.now();
    if(!force && clientPairCache[key] && (now - clientPairCache[key].ts) < CLIENT_TTL){
      return { cached: true, ...clientPairCache[key].payload };
    }
    try {
      const q = `/api/price?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await fetch(q);
      if(!res.ok) throw new Error('price fetch failed');
      const j = await res.json();
      if(!j || !j.success) throw new Error('price response not ok');
      const payload = {
        pair: j.pair,
        market_price: Number(j.market_price),
        platform_buy_price: Number(j.platform_buy_price),
        platform_sell_price: Number(j.platform_sell_price),
        raw_market_price: Number(j.raw_market_price || j.market_price),
        timestamp: j.timestamp || new Date().toISOString(),
        source: j.source || 'coingecko'
      };
      clientPairCache[key] = { ts: Date.now(), payload };
      return { cached: false, ...payload };
    } catch (e) {
      console.warn('fetchPairPrice err', e && e.message ? e.message : e);
      // fallback to cache if available
      const keyc = `${String(from).toUpperCase()}-${String(to).toUpperCase()}`;
      if(clientPairCache[keyc]) return { cached: true, ...clientPairCache[keyc].payload };
      throw e;
    }
  }

  // The old findRate used server-side stored pairs. Replace by fetchPairPrice to obtain market price.
  async function findRate(from,to){
    try{
      const p = await fetchPairPrice(from,to);
      // return market price as fallback (caller decides platform price)
      return p.market_price;
    }catch(e){
      console.warn('findRate err', e);
      return 1;
    }
  }

  // Utility: adaptive formatting: >=1 -> 2 decimals, <1 -> 6 decimals
  function fmtNumber(v){
    if(!Number.isFinite(v)) return '-';
    const abs = Math.abs(v);
    if(abs >= 1) return Number(v).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
    return Number(v).toFixed(6);
  }

  // Calculation for main page estimate (uses market_price)
  async function calculate(){
    const f = (fromEl.value||'').toUpperCase();
    const t = (toEl.value||'').toUpperCase();
    const amt = Number(amtEl.value || 0);
    if(!amt || !f || !t){ outEl.value = ''; updatePagePreview(); return; }
    try{
      const p = await fetchPairPrice(f,t);
      const v = Number(amt) * Number(p.market_price || 1);
      outEl.value = Number.isFinite(v) ? Number(v).toFixed(6) : '';
      updatePagePreview(); // keep page preview in sync when user types
    }catch(e){
      outEl.value = '';
      updatePagePreview();
    }
  }

  fromEl.addEventListener('change', () => { calculate(); });
  toEl.addEventListener('change', () => { calculate(); });
  amtEl.addEventListener('input', () => { calculate(); });

  // update page-level preview block (#preview-*)
  let pagePreviewInterval = null;
  async function updatePagePreview(force=false){
    const f = (fromEl.value||'').toUpperCase();
    const t = (toEl.value||'').toUpperCase();
    const amt = Number(amtEl.value || 0);
    if(!f || !t){
      if(previewPairEl) previewPairEl.innerText = '-';
      if(previewMarketEl) previewMarketEl.innerText = '-';
      if(previewAppliedEl) previewAppliedEl.innerText = '-';
      if(previewReceivedEl) previewReceivedEl.innerText = '-';
      if(previewLastUpdatedEl) previewLastUpdatedEl.innerText = '-';
      return;
    }
    try{
      const p = await fetchPairPrice(f,t, force);
      // determine applied price based on direction
      const type = determineType(f,t);
      let applied = p.market_price;
      if(type === 'crypto-fiat') applied = p.platform_buy_price;
      else if(type === 'fiat-crypto') applied = p.platform_sell_price;
      const estimatedReceived = amt ? (Number(amt) * Number(applied)) : '-';
      if(previewPairEl) previewPairEl.innerText = `${f} → ${t}`;
      if(previewMarketEl) previewMarketEl.innerText = `${fmtNumber(p.market_price)} ${t}`;
      if(previewAppliedEl) previewAppliedEl.innerText = `${fmtNumber(applied)} ${t}`;
      if(previewReceivedEl) previewReceivedEl.innerText = (estimatedReceived==='-' ? '-' : `${fmtNumber(estimatedReceived)} ${t}`);
      if(previewLastUpdatedEl) previewLastUpdatedEl.innerText = (p.timestamp ? new Date(p.timestamp).toLocaleString() : '-');
    }catch(e){
      console.warn('updatePagePreview err', e);
      if(previewPairEl) previewPairEl.innerText = `${f} → ${t}`;
      if(previewMarketEl) previewMarketEl.innerText = '—';
      if(previewAppliedEl) previewAppliedEl.innerText = '—';
      if(previewReceivedEl) previewReceivedEl.innerText = '—';
      if(previewLastUpdatedEl) previewLastUpdatedEl.innerText = '-';
    }
  }

  // auto refresh page preview every 15s
  function startPagePreviewPolling(){
    if(pagePreviewInterval) clearInterval(pagePreviewInterval);
    pagePreviewInterval = setInterval(()=> {
      try {
        updatePagePreview(false);
      } catch(e){}
    }, 15 * 1000);
  }

  refreshRatesBtn.addEventListener('click', async () => {
    // Force reload rates options, then force-update preview
    await loadRatesOptions();
    // force fetch price bypass client cache to get fresh server-side data
    await updatePagePreview(true);
    alert('Taux rafraîchis');
  });

  // Type determination
  function determineType(from,to){
    const fiat = ['USD','EUR','XOF','CFA','GHS'];
    const isFromFiat = fiat.includes((from||'').toUpperCase());
    const isToFiat = fiat.includes((to||'').toUpperCase());
    if(!isFromFiat && !isToFiat) return 'crypto-crypto';
    if(!isFromFiat && isToFiat) return 'crypto-fiat';
    if(isFromFiat && !isToFiat) return 'fiat-crypto';
    return 'fiat-fiat';
  }

  // Build payment method select with data-details to ensure immediate access
  function buildPaymentMethodSelect(nameAttr, filterType='fiat'){
    const sel = document.createElement('select');
    sel.name = nameAttr;
    sel.required = true;
    sel.style.padding = '8px';
    sel.style.borderRadius = '8px';
    sel.style.border = '1px solid var(--border)';
    sel.innerHTML = `<option value="">-- choisir moyen --</option>`;
    const filtered = paymentsCache.filter(p => (p.type||'').toLowerCase() === (filterType||'').toLowerCase() && p.active);
    if(filtered.length === 0){
      // fallback to defaults of that type
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

  // Helper: compute and format amount summary block (used inside modal)
  async function buildAmountSummaryBlock(base, lastPricePayload){
    // lastPricePayload = result of fetchPairPrice
    const amountFrom = Number(base.amountFrom || 0);
    const lp = lastPricePayload || { market_price: 0, platform_buy_price: 0, platform_sell_price: 0, timestamp: '' };
    // Determine which platform price applies:
    // - crypto -> fiat (client sells) => platform_buy_price (we buy)
    // - fiat -> crypto (client buys) => platform_sell_price (we sell)
    const t = determineType(base.from, base.to);
    let appliedPrice = lp.market_price;
    if(t === 'crypto-fiat') appliedPrice = lp.platform_buy_price;
    else if(t === 'fiat-crypto') appliedPrice = lp.platform_sell_price;
    else { appliedPrice = lp.market_price; }

    const estimatedTo = amountFrom * appliedPrice;

    const wrapper = document.createElement('div');
    wrapper.className = 'amount-summary';
    wrapper.style.borderTop = '1px solid #eee';
    wrapper.style.paddingTop = '8px';
    wrapper.innerHTML = `
      <div style="display:flex;justify-content:space-between"><div class="muted">Paire</div><div><strong>${escapeHtml(base.from)} → ${escapeHtml(base.to)}</strong></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px"><div class="muted">Cours marché</div><div>${fmtNumber(lp.market_price)} ${escapeHtml(base.to)}</div></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px"><div class="muted">Prix appliqué</div><div><strong>${fmtNumber(appliedPrice)} ${escapeHtml(base.to)}</strong></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px"><div class="muted">Montant envoyé</div><div>${escapeHtml(String(amountFrom))} ${escapeHtml(base.from)}</div></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px"><div class="muted">Vous recevrez (est.)</div><div><strong>${fmtNumber(estimatedTo)} ${escapeHtml(base.to)}</strong></div></div>
      <div class="small muted" style="margin-top:8px">Prix indicatif — mis à jour toutes les 15s. Dernière mise à jour : ${escapeHtml(lp.timestamp || '')}</div>
    `;
    return wrapper;
  }

  // PROOF upload helper kept (unchanged except small improvements)
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
        if(!resp.ok || !j || !j.success){
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
          img.style.maxWidth = '240px';
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
          const inUrl = document.createElement('input'); inUrl.type = 'hidden'; inUrl.name = 'proof_url'; inUrl.value = j.url || ''; form.appendChild(inUrl);
          const existing2 = form.querySelector('input[name="proof_public_id"]'); if(existing2) existing2.remove();
          const inId = document.createElement('input'); inId.type = 'hidden'; inId.name = 'proof_public_id'; inId.value = j.public_id || ''; form.appendChild(inId);
          const existing3 = form.querySelector('input[name="proof_mime"]'); if(existing3) existing3.remove();
          const inMime = document.createElement('input'); inMime.type = 'hidden'; inMime.name = 'proof_mime'; inMime.value = j.mimeType || ''; form.appendChild(inMime);
          const existing4 = form.querySelector('input[name="proof_filename"]'); if(existing4) existing4.remove();
          const inFn = document.createElement('input'); inFn.type = 'hidden'; inFn.name = 'proof_filename'; inFn.value = j.filename || ''; form.appendChild(inFn);
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

  // Modal creation with preview area, refresh button, auto polling, lock-on-confirm
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

    // Preview area at bottom of form (just before actions)
    const previewWrapper = document.createElement('div');
    previewWrapper.className = 'preview-wrapper';
    previewWrapper.style.borderTop = '1px solid #eee';
    previewWrapper.style.paddingTop = '8px';
    previewWrapper.style.marginTop = '8px';

    // refresh controls
    const refreshControl = document.createElement('div');
    refreshControl.style.display = 'flex'; refreshControl.style.alignItems = 'center'; refreshControl.style.gap = '8px';
    const refreshBtn = document.createElement('button'); refreshBtn.type = 'button'; refreshBtn.className = 'btn ghost'; refreshBtn.innerText = 'Rafraîchir';
    const spinner = document.createElement('span'); spinner.className = 'small muted'; spinner.innerText = '';
    refreshControl.appendChild(refreshBtn); refreshControl.appendChild(spinner);
    previewWrapper.appendChild(refreshControl);

    // place for summary
    const summaryPlace = document.createElement('div');
    summaryPlace.style.marginTop = '8px';
    previewWrapper.appendChild(summaryPlace);

    // instruction about indicative price
    const infoNote = document.createElement('div');
    infoNote.className = 'small muted';
    infoNote.style.marginTop = '8px';
    infoNote.innerText = 'Le prix est indicatif et est mis à jour toutes les 15s.';
    previewWrapper.appendChild(infoNote);

    form.appendChild(previewWrapper);

    // compute amountTo using current rates (via fetchPairPrice)
    let lastPricePayload = null;
    let pollingHandle = null;
    let previewLockedUntil = 0;
    const LOCK_MS_AFTER_CONFIRM = 10 * 1000; // 10 seconds lock as requested ("quelques secondes")

    async function refreshPreview(force=false){
      // if locked, ignore refresh requests (manual or auto)
      const now = Date.now();
      if(now < previewLockedUntil && !force){
        // show locked status briefly
        spinner.innerText = ' (prix verrouillé)';
        setTimeout(()=>{ spinner.innerText = ''; }, 1200);
        return;
      }
      spinner.innerText = 'chargement...';
      refreshBtn.disabled = true;
      try {
        const p = await fetchPairPrice(base.from, base.to, force);
        lastPricePayload = p;
        // build summary block with applied price logic
        const block = await buildAmountSummaryBlock(base, p);
        summaryPlace.innerHTML = '';
        summaryPlace.appendChild(block);
      } catch (e) {
        summaryPlace.innerHTML = '<div class="muted small">Impossible de récupérer le prix pour le moment.</div>';
      } finally {
        spinner.innerText = '';
        refreshBtn.disabled = false;
      }
    }

    // Start auto-polling every 15s
    (async function(){ await refreshPreview(true); pollingHandle = setInterval(()=>refreshPreview(false), 15 * 1000); })();

    // manual refresh
    refreshBtn.addEventListener('click', async () => { await refreshPreview(true); });

    // build dynamic UI based on type (same as before but we keep it lean)
    (async function build(){
      dyn.innerHTML = '';

      function appendProofUploader(container) {
        const wrapper = document.createElement('div');
        const lbl = document.createElement('label'); lbl.innerText = 'Preuve de paiement (optionnel)';
        const fi = document.createElement('input');
        fi.type = 'file';
        fi.name = 'proofFile';
        fi.accept = 'image/*,.jpg,.jpeg,.png,.pdf,.doc,.docx';
        wrapper.appendChild(lbl); wrapper.appendChild(fi);
        const preview = document.createElement('div'); preview.className = 'small muted'; preview.style.marginTop = '6px';
        wrapper.appendChild(preview);
        container.appendChild(wrapper);
        return fi;
      }

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
          const found = paymentsCache.find(p => (p.type||'') === 'crypto' && (p.network||'').toUpperCase() === (net||'').toUpperCase() && p.active);
          const details = found ? (found.details || found.addressOrAccount || '') : (networkAddresses[net] || (`ADRESSE_${net}_PAR_DEFAUT`));
          const amountTo = lastPricePayload ? (Number(base.amountFrom) * Number(lastPricePayload.platform_buy_price || lastPricePayload.market_price)) : '...';
          const txt = `<div class="tx-note">Envoyer <strong>${base.amountFrom}</strong> ${base.from} (≈ <strong>${(Number.isFinite(amountTo) ? Number(amountTo).toFixed(6) : amountTo)} ${base.to}</strong>) vers :</div><div style="margin-top:6px;font-family:monospace">${escapeHtml(details)}</div>`;
          sendAddrBox.querySelector('#send-address').innerHTML = txt;
        });

        recvMethodSelect.addEventListener('change', async () => {
          const opt = recvMethodSelect.selectedOptions[0];
          let details = opt && opt.dataset && opt.dataset.details ? decodeURIComponent(opt.dataset.details) : '';
          if(!details){
            const val = opt && opt.value ? decodeURIComponent(opt.value) : null;
            const found = paymentsCache.find(p => String(p._id) === String(val));
            details = found ? (found.details || found.addressOrAccount || '') : '';
          }
          let note = dyn.querySelector('.recv-method-note');
          if(!note){ note = document.createElement('div'); note.className = 'recv-method-note muted'; dyn.appendChild(note); }
          const amountTo = lastPricePayload ? (Number(base.amountFrom) * Number(lastPricePayload.platform_buy_price || lastPricePayload.market_price)) : '...';
          note.innerHTML = details ? `<div style="font-family:monospace">${escapeHtml(details)}</div><div class="small muted" style="margin-top:6px">Envoyer <strong>${base.amountFrom}</strong> ${base.from} (≈ <strong>${(Number.isFinite(amountTo) ? Number(amountTo).toFixed(6) : amountTo)} ${base.to}</strong>).</div>` : '-';
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
          const found = paymentsCache.find(p => (p.type||'') === 'crypto' && (p.network||'').toUpperCase() === (net||'').toUpperCase() && p.active);
          const details = found ? (found.details || found.addressOrAccount || '') : (networkAddresses[net] || (`ADRESSE_${net}_PAR_DEFAUT`));
          const txt = `<div class="tx-note">Envoyer <strong>${base.amountFrom}</strong> ${base.from} vers :</div><div style="margin-top:6px;font-family:monospace">${escapeHtml(details)}</div>`;
          sendAddrBox.querySelector('#send-address').innerHTML = txt;
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
            const found = paymentsCache.find(p => String(p._id) === String(val));
            details = found ? (found.details || found.addressOrAccount || '') : '';
          }
          const amountTo = lastPricePayload ? (Number(base.amountFrom) * Number(lastPricePayload.platform_sell_price || lastPricePayload.market_price)) : '...';
          payBox.querySelector('#pay-info').innerHTML = details
            ? `<div style="font-family:monospace">${escapeHtml(details)}</div><div class="small muted" style="margin-top:6px">Envoyer <strong>${base.amountFrom}</strong> ${base.from} (≈ <strong>${(Number.isFinite(amountTo) ? Number(amountTo).toFixed(6) : amountTo)} ${base.to}</strong>).</div>`
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
        const proofInput = appendProofUploader(dyn);

        paySel.addEventListener('change', async () => {
          const opt = paySel.selectedOptions[0];
          let details = opt && opt.dataset && opt.dataset.details ? decodeURIComponent(opt.dataset.details) : '';
          if(!details){
            const val = opt && opt.value ? decodeURIComponent(opt.value) : null;
            const found = paymentsCache.find(p => String(p._id) === String(val));
            details = found ? (found.details || found.addressOrAccount || '') : '';
          }
          const amountTo = lastPricePayload ? (Number(base.amountFrom) * Number(lastPricePayload.market_price)) : '...';
          payBox.querySelector('#pay-info').innerHTML = details
            ? `<div style="font-family:monospace">${escapeHtml(details)}</div><div class="small muted" style="margin-top:6px">Envoyer <strong>${base.amountFrom}</strong> ${base.from} (≈ <strong>${(Number.isFinite(amountTo) ? Number(amountTo).toFixed(6) : amountTo)} ${base.to}</strong>).</div>`
            : '-';
        });
      }
    })();

    // actions
    const actions = document.createElement('div');
    actions.style.display = 'flex'; actions.style.justifyContent='flex-end'; actions.style.gap = '8px'; actions.style.marginTop='10px';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn ghost'; cancel.innerText = 'Annuler';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'btn'; submit.innerText = 'Confirmer';
    actions.appendChild(cancel); actions.appendChild(submit);
    form.appendChild(actions);

    cancel.addEventListener('click', (e)=>{ e.preventDefault(); clearAndRemove(); });

    function clearAndRemove(){
      if(pollingHandle) { clearInterval(pollingHandle); pollingHandle = null; }
      modal.remove();
    }

    // Helper: find file input in form (if any)
    function findProofFileInput(formEl) {
      return formEl.querySelector('input[type="file"][name="proofFile"]');
    }

    // On submit: lock preview for LOCK_MS_AFTER_CONFIRM and proceed to create tx using lastPricePayload
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true; submit.innerText = 'Envoi...';

      // lock preview
      previewLockedUntil = Date.now() + LOCK_MS_AFTER_CONFIRM;
      refreshBtn.disabled = true;

      // gather form fields
      const fd = new FormData(form);
      const details = {};
      for (const [k,v] of fd.entries()) details[k] = v;

      // find chosen proof file input and upload if present
      const fileInput = findProofFileInput(form);
      let proof = null;
      try {
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
          const f = fileInput.files[0];
          const up = new FormData(); up.append('file', f, f.name);
          const upRes = await fetch('/api/upload-proof', { method: 'POST', body: up });
          const upJson = await upRes.json().catch(()=>null);
          if (upRes.ok && upJson && upJson.success) proof = upJson.proof || null;
        }
      } catch (uplErr) {
        console.warn('upload error', uplErr);
      }

      // Ensure we have a price payload to compute final amount
      try {
        if(!lastPricePayload){
          lastPricePayload = (await fetchPairPrice(base.from, base.to, true));
        }
      } catch(e) { /* ignore, will fallback */ }

      let appliedPrice = lastPricePayload ? lastPricePayload.market_price : 1;
      const t = determineType(base.from, base.to);
      if(t === 'crypto-fiat' && lastPricePayload) appliedPrice = lastPricePayload.platform_buy_price;
      else if(t === 'fiat-crypto' && lastPricePayload) appliedPrice = lastPricePayload.platform_sell_price;
      // else crypto-crypto or fiat-fiat: use market_price

      const amountTo = Number(base.amountFrom) * Number(appliedPrice || 1);

      const tx = {
        from: base.from,
        to: base.to,
        amountFrom: Number(base.amountFrom),
        amountTo: Number(amountTo),
        type: base.type,
        details,
        proof // may be null
      };

      // prepare headers
      const token = localStorage.getItem('token');
      const headers = {'Content-Type':'application/json'};
      if (token) headers['Authorization'] = 'Bearer ' + token;

      try {
        const resp = await fetch('/api/transactions', { method: 'POST', headers, body: JSON.stringify(tx) });
        const j = await resp.json().catch(()=>null);
        if (resp.ok && j && j.success) {
          alert('Transaction enregistrée (pending).');
          const local = JSON.parse(localStorage.getItem('guestTx') || '[]');
          local.unshift({ ...tx, status: 'pending', createdAt: new Date().toISOString(), _id: j.transaction ? j.transaction._id : ('local_'+Date.now()) });
          localStorage.setItem('guestTx', JSON.stringify(local));
          clearAndRemove();
          // keep lock for a brief moment (UX): redirect after small delay
          setTimeout(()=>{ window.location.href = '/historique'; }, 300);
          return;
        } else {
          console.warn('tx create not ok', j);
        }
      } catch (err) {
        console.warn('submit error', err);
      }

      // fallback to local save
      const local = JSON.parse(localStorage.getItem('guestTx') || '[]');
      local.unshift({ from: base.from, to: base.to, amountFrom: base.amountFrom, amountTo: base.amountFrom, type: base.type, details, status: 'pending', createdAt: new Date().toISOString(), _id: 'local_'+Date.now(), proof });
      localStorage.setItem('guestTx', JSON.stringify(local));
      alert('Serveur indisponible — transaction sauvegardée localement.');
      clearAndRemove();
      window.location.href = '/historique';
    });

    modal.addEventListener('click', (e)=> { if(e.target === modal) clearAndRemove(); });

    document.body.appendChild(modal);
    const first = form.querySelector('input[name="firstName"]');
    if(first) first.focus();
  }

  // helpers
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

  doBtn.addEventListener('click', async () => {
    const from = (fromEl.value || '').toUpperCase();
    const to = (toEl.value || '').toUpperCase();
    const amt = Number(amtEl.value || 0);
    if(!from || !to || !amt){ alert('Veuillez remplir les champs'); return; }
    const type = determineType(from,to);
    await loadPayments(); // ensure paymentsCache ready
    openTransactionModal({ from, to, amountFrom: amt, type });
  });

  (async function init(){
    await loadPayments();
    await loadRatesOptions();
    calculate();
    // start page-level preview polling
    startPagePreviewPolling();
    // initial page preview
    updatePagePreview(false);
  })();

  // expose helper for debugging / admin pages
  window.PYExchange = { loadPayments, loadRatesOptions, paymentsCache, fetchPairPrice, updatePagePreview };

})();
