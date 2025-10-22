// public/js/admin.js (currencies-aware)
(function(){
  // helpers
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  function toast(msg, ok=true){
    const t = document.createElement('div');
    t.style.position='fixed'; t.style.right='18px'; t.style.bottom='20px';
    t.style.background = ok ? 'linear-gradient(90deg,#17a063,#15b36a)' : 'linear-gradient(90deg,#e14b4b,#d83a3a)';
    t.style.color='#fff'; t.style.padding='10px 14px'; t.style.borderRadius='10px'; t.style.zIndex=99999;
    t.innerText = msg; document.body.appendChild(t); setTimeout(()=>t.remove(),3000);
  }
  function authFetch(url, opts = {}) {
    opts.headers = opts.headers || {};
    const token = localStorage.getItem('token');
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, opts);
  }

  // Global loader utilities
  const globalLoaderEl = $('#global-loader');
  const globalLoaderText = $('#global-loader-text');
  function showLoader(text='Traitement en cours…'){
    if(globalLoaderEl){
      globalLoaderText && (globalLoaderText.innerText = text);
      globalLoaderEl.classList.add('active');
      globalLoaderEl.setAttribute('aria-hidden','false');
      document.body.style.pointerEvents = 'none';
      document.documentElement.style.overflow = 'hidden';
    }
  }
  function hideLoader(){
    if(globalLoaderEl){
      globalLoaderEl.classList.remove('active');
      globalLoaderEl.setAttribute('aria-hidden','true');
      document.body.style.pointerEvents = '';
      document.documentElement.style.overflow = '';
    }
  }

  // token check
  const token = localStorage.getItem('token');
  if(!token){ alert('Accès admin requis. Connecte-toi.'); window.location.href='/login_admin'; }
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if(user && user.username && $('#admin-username')) $('#admin-username').innerText = user.username;

  // socket
  try {
    const socket = io();
    socket.on('connect', ()=> console.log('socket connected', socket.id));
    socket.on('newTransaction', ()=> { loadTransactions(); toast('Nouvelle transaction'); });
    socket.on('txStatusChanged', ()=> { loadTransactions(); toast('Statut transaction changé'); });
  } catch(e){ console.warn('socket init failed', e); }

  // DOM refs (guarded)
  const txTbody = $('#tx-tbody'), txCards = $('#tx-cards'), txFilter = $('#tx-filter'), btnRefreshTx = $('#btn-refresh-tx');
  const publishBtn = $('#publish-news'), updateBtn = $('#update-news'), clearBtn = $('#clear-news'), publishStatus = $('#publish-status');
  const nFile = $('#n-file'), nPreview = $('#n-preview'), nTitle = $('#n-title'), nDesc = $('#n-desc'), nContent = $('#n-content'), nId = $('#n-id');
  const nImageUrlHidden = $('#n-image-url'), nImageMeta = $('#n-image-meta'), nImageUrlLink = $('#n-image-url-link'), nImageInfo = $('#n-image-info'), nImageRemove = $('#n-image-remove');
  const newsList = $('#news-list'), btnLoadNews = $('#btn-load-news'), btnSeed = $('#btn-seed-sample');
  // currencies DOM
  const ratesList = $('#rates-list'); // keep name for compatibility
  const ratesFilter = $('#rates-filter'), ratesRefreshBtn = $('#rates-refresh');
  const rSymbol = $('#r-symbol'), rName = $('#r-name'), rType = $('#r-type'), rAdd = $('#r-add'), btnRefresh = $('#btn-refresh');
  // Payments DOM refs
  const pmListEl = $('#payments-list'), pmSearch = $('#pm-search'), pmRefresh = $('#pm-refresh');
  const pmId = $('#pm-id'), pmName = $('#pm-name'), pmType = $('#pm-type'), pmNetwork = $('#pm-network'), pmDetails = $('#pm-details'), pmActive = $('#pm-active');
  const pmSave = $('#pm-save'), pmClear = $('#pm-clear');

  // Safety: if critical DOM elements missing, log and bail for that section
  function requireEl(el, name){
    if(!el) console.warn(`Element missing: ${name}`);
    return !!el;
  }

  // minimal upload helper (kept from previous)
  async function uploadFileToServer(file){
    if(!file) return null;
    const candidates = ['/api/upload-proof','/admin/upload','/api/upload','/upload','/admin/upload-proof','/api/admin/upload'];
    const fd = new FormData(); fd.append('file', file);
    const token = localStorage.getItem('token');
    for(const ep of candidates){
      try {
        const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        const res = await fetch(ep, { method: 'POST', headers, body: fd });
        let json = null;
        try { json = await res.clone().json(); } catch(e){ /* not json */ }
        if(json){
          const url = json.url || json.file || json.location || (json.result && json.result.secure_url) || null;
          const public_id = json.public_id || (json.result && json.result.public_id) || null;
          const mime = json.mime || json.mimeType || (file && file.type) || null;
          if(url) return { url, public_id, mime };
        }
        const text = await res.clone().text().catch(()=>null);
        if(text && text.trim().startsWith('http')) return { url: text.trim(), public_id: null, mime: file.type || null };
      } catch(err){
        continue;
      }
    }
    throw new Error('Aucun endpoint d\'upload disponible (checked multiple paths)');
  }

  /* ---------------------------
     Transactions (client-side pagination)
     --------------------------- */
  let transactionsCache = []; let txPage = 0; const TX_PAGE_SIZE = 10;

  async function loadTransactions(){
    if(!requireEl(txTbody,'tx-tbody')) return;
    try {
      const res = await authFetch('/admin/transactions');
      if(!res.ok) throw new Error('Impossible de charger transactions');
      const txs = await res.json();
      transactionsCache = Array.isArray(txs) ? txs : [];
      txPage = 0;
      renderTransactionsPage();
    } catch(e){
      console.error(e); if(txTbody) txTbody.innerHTML = '<tr><td colspan="8" class="tiny">Erreur chargement</td></tr>'; if(txCards) txCards.innerHTML = '';
    }
  }

  function renderTransactionsPage(append=false){
    if(!requireEl(txTbody,'tx-tbody')) return;
    const q = (txFilter && txFilter.value || '').trim().toLowerCase();
    const filtered = transactionsCache.filter(t => {
      if(!q) return true;
      const u = (t.user && (t.user.username||t.user.email)) || 'guest';
      return String(u).toLowerCase().includes(q) || String(t.status||'').toLowerCase().includes(q) || ((t.from||'') + ' ' + (t.to||'')).toLowerCase().includes(q);
    });

    const end = (txPage + 1) * TX_PAGE_SIZE;
    const pageItems = filtered.slice(0, end);

    if(pageItems.length === 0){
      txTbody.innerHTML = '<tr><td colspan="8" class="tiny">Aucune transaction</td></tr>';
    } else {
      txTbody.innerHTML = pageItems.map(t => {
        const u = t.user ? (t.user.username || t.user.email) : 'Guest';
        const id = t._id || t.id || '';
        return `<tr data-txid="${escapeHtml(id)}">
          <td>${new Date(t.createdAt).toLocaleString()}</td>
          <td>${escapeHtml(u)}</td>
          <td>${escapeHtml(t.type||'')}</td>
          <td>${escapeHtml((t.from||'') + ' → ' + (t.to||''))}</td>
          <td>${escapeHtml(String(t.amountFrom||''))}</td>
          <td>${escapeHtml(String(t.amountTo||''))}</td>
          <td>${renderStatusChip(t.status||'')}</td>
          <td>
            <div class="actions">
              <button class="btn ghost" data-id="${id}" data-action="view">Voir</button>
              <button class="btn" data-id="${id}" data-action="approve">Valider</button>
              <button class="btn ghost" data-id="${id}" data-action="reject">Rejeter</button>
            </div>
          </td>
        </tr>`; }).join('');
    }

    if(requireEl(txCards,'tx-cards')){
      txCards.innerHTML = pageItems.map(t => {
        const u = t.user ? (t.user.username || t.user.email) : 'Guest';
        const id = t._id || t.id || '';
        return `<div class="tx-card" data-txid="${escapeHtml(id)}">
          <div class="row"><strong>${escapeHtml(u)}</strong><span class="tiny muted">${new Date(t.createdAt).toLocaleString()}</span></div>
          <div class="row"><span>Pair: <strong>${escapeHtml((t.from||'') + '→' + (t.to||''))}</strong></span><span>Status: <strong>${escapeHtml(t.status||'')}</strong></span></div>
          <div class="row"><span>Montant: ${escapeHtml(String(t.amountFrom||''))}</span><span>Reçu: ${escapeHtml(String(t.amountTo||''))}</span></div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn ghost" data-id="${id}" data-action="view">Voir</button>
            <button class="btn" data-id="${id}" data-action="approve">Valider</button>
            <button class="btn ghost" data-id="${id}" data-action="reject">Rejeter</button>
          </div>
        </div>`; }).join('');
    }

    const filteredCount = filtered.length;
    const loadMoreBtn = $('#tx-load-more');
    if(loadMoreBtn){
      if(end < filteredCount) loadMoreBtn.style.display = 'inline-block';
      else loadMoreBtn.style.display = 'none';
    }
  }

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if(!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-action');
    if(!id) return toast('ID transaction introuvable', false);
    if(act === 'view') return viewTx(id);
    if(act === 'approve') return setStatus(id, 'approved');
    if(act === 'reject') return setStatus(id, 'rejected');
  });

  function renderStatusChip(status){
    const s = String(status || '').toLowerCase();
    if(s === 'approved') return `<span class="status-chip status-approved">${escapeHtml(status)}</span>`;
    if(s === 'rejected') return `<span class="status-chip status-rejected">${escapeHtml(status)}</span>`;
    return `<span class="status-chip status-pending">${escapeHtml(status || 'pending')}</span>`;
  }

  const loadMoreButton = $('#tx-load-more');
  if(loadMoreButton) loadMoreButton.addEventListener('click', () => { txPage++; renderTransactionsPage(true); });
  if(txFilter) txFilter.addEventListener('input', () => { txPage = 0; renderTransactionsPage(); });

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---------------------------
     Transaction modal (readable) + proof display
     --------------------------- */
  window.viewTx = async function(id){
    try {
      const res = await authFetch('/admin/transactions/' + id);
      if(!res.ok) {
        const txt = await res.text().catch(()=>null);
        throw new Error('Impossible de charger transaction: ' + (txt||res.status));
      }
      const tx = await res.json();

      const modal = document.createElement('div'); modal.className='modal';
      const box = document.createElement('div'); box.className='box';
      box.style.maxWidth='720px';

      let userHtml = '<div class="tiny muted">Guest</div>';
      if(tx.user){
        const u = tx.user.username || tx.user.email || '';
        userHtml = `<div><strong>${escapeHtml(u)}</strong><div class="tiny muted">${escapeHtml(tx.user.email||'')}</div></div>`;
      }

      const det = tx.details || {};
      let detHtml = '';
      if(Object.keys(det).length === 0){
        detHtml = '<div class="small muted">Aucun détail fourni</div>';
      } else {
        detHtml = '<dl class="details">';
        for(const k of Object.keys(det)){
          const val = det[k] === null || typeof det[k] === 'undefined' ? '' : String(det[k]);
          const safeVal = escapeHtml(val).replace(/\n/g,'<br>').replace(/&lt;br&gt;/g, '<br>');
          detHtml += `<dt>${escapeHtml(k)}</dt><dd>${safeVal}</dd>`;
        }
        detHtml += '</dl>';
      }

      const txId = tx._id || tx.id || id;

      let proofHtml = '';
      if(tx.proof && tx.proof.url){
        const proofUrl = escapeHtml(tx.proof.url);
        const mime = (tx.proof.mime || tx.proof.mimeType || '').toLowerCase();
        if(mime.startsWith('image/') || /\.(jpeg|jpg|png|gif|webp)$/i.test(proofUrl)){
          proofHtml = `
            <div>
              <h4>Preuve de paiement</h4>
              <div class="proof-preview">
                <a href="${proofUrl}" target="_blank" rel="noopener">
                  <img src="${proofUrl}" alt="Preuve de paiement" />
                </a>
                <div class="proof-meta">Type: ${escapeHtml(mime || 'image')} — <a href="${proofUrl}" target="_blank" rel="noopener">Ouvrir en grand</a></div>
              </div>
            </div>
          `;
        } else {
          proofHtml = `
            <div>
              <h4>Preuve de paiement</h4>
              <div class="proof-preview">
                <div><strong>Fichier :</strong> <a href="${proofUrl}" target="_blank" rel="noopener">Télécharger / Ouvrir la preuve</a></div>
                <div class="proof-meta">Type: ${escapeHtml(mime || 'fichier')}</div>
              </div>
            </div>
          `;
        }
      }

      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3>Détails transaction</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="modal-status-select" style="padding:6px;border-radius:8px;border:1px solid var(--border)">
              <option value="pending">pending</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="cancelled">cancelled</option>
            </select>
            <button class="btn" id="modal-save-status">Enregistrer</button>
            <button class="btn ghost" id="close-x">Fermer</button>
          </div>
        </div>

        <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <div class="kv"><div class="col">${userHtml}</div><div class="col tiny muted">${new Date(tx.createdAt).toLocaleString()}</div></div>
            <div style="margin-top:8px"><strong>Pair:</strong> ${escapeHtml((tx.from||'') + ' → ' + (tx.to||''))}</div>
            <div style="margin-top:6px"><strong>Type:</strong> ${escapeHtml(tx.type||'')}</div>
            <div style="margin-top:6px"><strong>Montant:</strong> ${escapeHtml(String(tx.amountFrom||''))} → <strong>${escapeHtml(String(tx.amountTo||''))}</strong></div>
            <div style="margin-top:8px">${renderStatusChip(tx.status)}</div>
          </div>

          <div style="flex:1;min-width:220px">
            <div style="margin-top:4px"><strong>ID :</strong> ${escapeHtml(txId)}</div>
            <div style="margin-top:8px;color:var(--muted);font-size:13px">${escapeHtml(tx.details && tx.details.note ? String(tx.details.note) : '')}</div>
          </div>
        </div>

        <div class="details" style="margin-top:12px">
          <h4>Détails fournis</h4>
          ${detHtml}
        </div>

        ${proofHtml}
      `;

      modal.appendChild(box); document.body.appendChild(modal);
      const closeBtn = box.querySelector('#close-x');
      if(closeBtn) closeBtn.onclick = ()=> modal.remove();
      modal.onclick = (e)=> { if(e.target === modal) modal.remove(); };

      const sel = box.querySelector('#modal-status-select');
      if(sel) sel.value = tx.status || 'pending';

      const saveBtn = box.querySelector('#modal-save-status');
      if(saveBtn){
        saveBtn.onclick = async () => {
          const newStatus = sel.value;
          if(!confirm('Confirmer la mise à jour du statut ?')) return;
          if(!txId){ toast('ID transaction introuvable', false); return; }
          try {
            showLoader('Mise à jour du statut…');
            const resp = await authFetch(`/admin/transactions/${txId}/status`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ status: newStatus }) });
            const body = await resp.json().catch(()=>null);
            if(resp.ok && body && body.success){ toast('Statut mis à jour'); loadTransactions(); modal.remove(); }
            else { console.error('status update failed', resp, body); toast('Erreur mise à jour', false); }
          } catch(e){ console.error(e); toast('Erreur', false); }
          finally { hideLoader(); }
        };
      }
    } catch(e){ console.error('viewTx err', e); toast('Erreur chargement détail', false); }
  };

  /* ---------------------------
     setStatus shortcut (admin)
     --------------------------- */
  window.setStatus = async function(id, status){
    if(!confirm('Confirmer la mise à jour du statut ?')) return;
    if(!id){ toast('ID transaction introuvable', false); return; }
    try {
      showLoader('Mise à jour du statut…');
      const res = await authFetch('/admin/transactions/' + id + '/status', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ status }) });
      const body = await res.json().catch(()=>null);
      if(res.ok && body && body.success){ toast('Statut mis à jour'); loadTransactions(); } else { console.error('setStatus failed', res, body); toast('Erreur', false); }
    } catch(e){ console.error(e); toast('Erreur', false); }
    finally{ hideLoader(); }
  };

  /* ---------------------------
     NEWS logic
     --------------------------- */
  if(nFile){
    nFile.addEventListener('change', () => {
      const f = nFile.files[0];
      if(!f){ if(nPreview) { nPreview.style.display='none'; nPreview.src=''; } return; }
      if(nPreview){
        nPreview.src = URL.createObjectURL(f); nPreview.style.display='block';
        nPreview.onload = ()=> URL.revokeObjectURL(nPreview.src);
      }
    });
  }

  function clearNewsForm(){
    if(nId) nId.value=''; if(nTitle) nTitle.value=''; if(nDesc) nDesc.value=''; if(nContent) nContent.value='';
    if(nFile) nFile.value=''; if(nPreview) { nPreview.style.display='none'; nPreview.src=''; }
    if(nImageUrlHidden) nImageUrlHidden.value = '';
    if(nImageMeta) nImageMeta.style.display = 'none';
    if(publishBtn) publishBtn.style.display='inline-block';
    if(updateBtn) updateBtn.style.display='none';
  }
  if(clearBtn) clearBtn.addEventListener('click', clearNewsForm);

  function textToHtmlWithBr(text){
    if(!text) return '';
    return String(text).replace(/\r\n/g,'\n').replace(/\n/g,'<br>');
  }
  function htmlBrToText(html){
    if(!html) return '';
    return String(html).replace(/<br\s*\/?>/gi,'\n').replace(/&lt;br\s*\/?&gt;/gi,'\n');
  }

  function formatContentForDisplay(content){
    if(!content) return '';
    const s = String(content);
    if(/<\s*(br|p|div|span|h|ul|ol|li|strong|em)[\s>]/i.test(s)){
      return s;
    }
    return s.replace(/\r\n/g,'\n').replace(/\n/g,'<br>');
  }

  function showImageMeta(url, publicId){
    if(!nImageMeta || !nImageUrlLink) return;
    nImageUrlLink.href = url || '#';
    nImageUrlLink.innerText = url ? (url.length > 60 ? url.slice(0,60) + '…' : url) : '';
    nImageInfo.innerText = publicId ? `public_id: ${publicId}` : '';
    nImageMeta.style.display = url ? 'block' : 'none';
    if(nImageUrlHidden) nImageUrlHidden.value = url || '';
    if(nPreview && url){
      nPreview.src = url; nPreview.style.display = 'block';
    }
  }
  if(nImageRemove){
    nImageRemove.addEventListener('click', (e) => {
      e.preventDefault();
      if(!confirm('Retirer l\'image associée à cette news ?')) return;
      if(nImageUrlHidden) nImageUrlHidden.value = '';
      if(nPreview){ nPreview.src=''; nPreview.style.display='none'; }
      if(nImageMeta) nImageMeta.style.display='none';
    });
  }

  if(publishBtn){
    publishBtn.addEventListener('click', async () => {
      if(!nTitle){ alert('Titre requis'); return; }
      const title = nTitle.value.trim(); if(!title){ alert('Titre requis'); return; }
      publishBtn.disabled = true; if(publishStatus) publishStatus.innerText = 'Publication...';
      showLoader('Publication en cours…');
      try {
        let imageUrl = (nImageUrlHidden && nImageUrlHidden.value) ? nImageUrlHidden.value : '';
        let publicId = '';
        if(nFile && nFile.files && nFile.files[0] && nFile.files[0].size > 0){
          try {
            const up = await uploadFileToServer(nFile.files[0]);
            if(up && up.url){ imageUrl = up.url; publicId = up.public_id || ''; showImageMeta(imageUrl, publicId); }
          } catch(uerr){
            console.warn('upload failed, continue publishing without image', uerr && (uerr.message||uerr));
            toast('Upload image échoué — publication sans image', false);
          }
        }

        const body = {
          title,
          description: textToHtmlWithBr(nDesc && nDesc.value.trim() || ''),
          content: textToHtmlWithBr(nContent && nContent.value.trim() || ''),
          image: imageUrl || null,
          image_public_id: publicId || null
        };
        const res = await authFetch('/admin/news', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
        const j = await res.json().catch(()=>null);
        if(res.ok && j && j.success){ toast('Publication réussie'); clearNewsForm(); loadNews(); }
        else { console.error('publish failed', res, j); toast('Erreur publication', false); alert((j && j.message) || 'Erreur'); }
      } catch(err){ console.error(err); toast('Erreur upload/publication', false); alert(String(err)); }
      finally{ if(publishBtn){ publishBtn.disabled=false; } if(publishStatus) publishStatus.innerText=''; hideLoader(); }
    });
  }

  // update news
  window.editNews = function(id){
    const found = window.__newsCache && window.__newsCache.find(n => (n._id === id || n.id === id));
    if(!found) return alert('News introuvable');
    if(nId) nId.value = found._id || found.id || '';
    if(nTitle) nTitle.value = found.title || '';
    if(nDesc) nDesc.value = htmlBrToText(found.description || '');
    if(nContent) nContent.value = htmlBrToText(found.content || '');
    if(found.image){ showImageMeta(found.image, found.image_public_id || ''); }
    if(publishBtn) publishBtn.style.display='none';
    if(updateBtn) updateBtn.style.display='inline-block';
    const editorEl = document.getElementById('news-section');
    if(editorEl && typeof editorEl.scrollIntoView === 'function'){ editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else { window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };

  if(updateBtn){
    updateBtn.addEventListener('click', async () => {
      const id = nId && nId.value; if(!id) return alert('Aucune news sélectionnée');
      updateBtn.disabled = true; if(publishStatus) publishStatus.innerText = 'Mise à jour...';
      showLoader('Mise à jour en cours…');
      try {
        let imageUrl = (nImageUrlHidden && nImageUrlHidden.value) ? nImageUrlHidden.value : '';
        let publicId = '';
        if(nFile && nFile.files && nFile.files[0] && nFile.files[0].size > 0){
          try {
            const up = await uploadFileToServer(nFile.files[0]);
            if(up && up.url){ imageUrl = up.url; publicId = up.public_id || ''; showImageMeta(imageUrl, publicId); }
          } catch(uerr){
            console.warn('upload failed for update, continue without image', uerr && (uerr.message||uerr));
            toast('Upload image échoué — mise à jour sans changer l\'image', false);
          }
        }
        const body = {
          id,
          title: nTitle && nTitle.value.trim(),
          description: textToHtmlWithBr(nDesc && nDesc.value.trim() || ''),
          content: textToHtmlWithBr(nContent && nContent.value.trim() || ''),
          image: imageUrl || null,
          image_public_id: publicId || null
        };
        const res = await authFetch('/admin/news', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
        const j = await res.json().catch(()=>null);
        if(res.ok && j && j.success){ toast('Modification réussie'); clearNewsForm(); loadNews(); } else { console.error('update failed', res, j); toast('Erreur', false); alert((j && j.message) || 'Erreur'); }
      } catch(e){ console.error(e); toast('Erreur update', false); }
      finally{ updateBtn.disabled=false; if(publishStatus) publishStatus.innerText=''; hideLoader(); }
    });
  }

  // Render news list
  function renderNewsList(news){
    if(!news || news.length === 0){ if(newsList) newsList.innerHTML = '<div class="tiny muted">Aucune news</div>'; return; }
    window.__newsCache = news;
    if(!newsList) return;
    newsList.innerHTML = news.map(n => {
      const nid = (n._id || n.id || '');
      const when = new Date(n.date || n.createdAt || Date.now()).toLocaleString();
      const contentRaw = n.content || '';
      const descriptionRaw = n.description || '';
      const contentHtml = formatContentForDisplay(contentRaw);
      const descHtml = formatContentForDisplay(descriptionRaw);
      return `
        <div class="news-item" data-id="${escapeHtml(nid)}">
          ${n.image ? `<img class="news-thumb" src="${escapeHtml(n.image)}" alt="">` : `<div class="news-thumb"></div>`}
          <div class="news-body">
            <div class="news-meta" style="align-items:flex-start">
              <div style="min-width:0">
                <span class="news-title">${escapeHtml(n.title)}</span>
                <div class="tiny muted" style="margin-top:4px">${descHtml}</div>
              </div>
              <div class="tiny muted" style="margin-left:12px">${when}</div>
            </div>
            <div class="news-content collapsed" data-news-id="${escapeHtml(nid)}">${contentHtml}</div>
            <div style="display:flex;gap:8px;align-items:center;justify-content:flex-start;margin-top:6px">
              <button class="news-toggle" data-news-id="${escapeHtml(nid)}" aria-expanded="false">Afficher +</button>
              <div style="margin-left:auto;display:flex;gap:6px">
                <button class="btn" data-news-id="${escapeHtml(nid)}" data-news-action="edit">Modifier</button>
                <button class="btn ghost" data-news-id="${escapeHtml(nid)}" data-news-action="delete">Supprimer</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // delegate news clicks & toggle
  if(newsList){
    newsList.addEventListener('click', (ev) => {
      const toggleBtn = ev.target.closest('.news-toggle');
      if(toggleBtn){
        const nid = toggleBtn.getAttribute('data-news-id');
        const contentEl = document.querySelector(`.news-content[data-news-id="${CSS.escape(nid)}"]`);
        if(!contentEl) return;
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        if(expanded){
          contentEl.style.maxHeight = `calc(var(--news-collapse-lines) * 1.4em)`;
          toggleBtn.innerText = 'Afficher +';
          toggleBtn.setAttribute('aria-expanded', 'false');
        } else {
          contentEl.style.maxHeight = 'none';
          toggleBtn.innerText = 'Réduire';
          toggleBtn.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      const editBtn = ev.target.closest('[data-news-action]');
      if(!editBtn) return;
      const action = editBtn.getAttribute('data-news-action');
      const id = editBtn.getAttribute('data-news-id');
      if(!id) { toast('ID news introuvable', false); return; }
      if(action === 'edit') return editNews(id);
      if(action === 'delete') {
        if(!confirm('Supprimer cette news ?')) return;
        deleteNews(id);
      }
    });
  }

  async function deleteNews(id){
    if(!id){ toast('ID news invalide', false); return; }
    if(!confirm('Supprimer cette news ?')) return;
    try {
      showLoader('Suppression en cours…');
      const res = await authFetch('/admin/news/' + id, { method:'DELETE' });
      const j = await res.json().catch(()=>null);
      if(res.ok && j && j.success){ toast('Suppression réussie'); loadNews(); } else { console.error('deleteNews failed', res, j); toast('Erreur suppression', false); alert((j && j.message) || 'Erreur'); }
    } catch(e){ console.error('deleteNews err', e); toast('Erreur suppression', false); }
    finally{ hideLoader(); }
  }

  async function loadNews(){
    if(!requireEl(newsList,'news-list')) return;
    try {
      const res = await authFetch('/admin/news');
      if(!res.ok) throw new Error('Impossible de charger news');
      const news = await res.json();
      renderNewsList(news);
    } catch(e){ console.error(e); if(newsList) newsList.innerHTML = '<div class="tiny muted">Erreur chargement news</div>'; }
  }

  /* ---------------------------
     CURRENCIES (previously rates) logic + search
     --------------------------- */
  let ratesCache = [];

  // Loads currencies from /api/currencies (preferred) or fallback to /api/rates
  async function loadRates(){
    if(!requireEl(ratesList,'rates-list')) return;
    try {
      // prefer explicit endpoint
      let res = await fetch('/api/currencies');
      if(!res.ok) {
        // fallback
        res = await fetch('/api/rates');
      }
      const list = await res.json();
      // Expect array of { _id, symbol, name, type, active, createdAt }
      ratesCache = Array.isArray(list) ? list : [];
      renderRatesList(ratesCache);
    } catch (e){
      console.error('loadRates err', e);
      if(ratesList) ratesList.innerHTML = '<div class="tiny muted">Erreur chargement</div>';
    }
  }

  function renderRatesList(list){
    if(!ratesList) return;
    const q = (ratesFilter && ratesFilter.value || '').trim().toLowerCase();
    const filtered = list.filter(r => {
      if(!q) return true;
      const s = (r.symbol || r.pair || '').toString().toLowerCase();
      const n = (r.name || '').toString().toLowerCase();
      const t = (r.type || '').toString().toLowerCase();
      return s.includes(q) || n.includes(q) || t.includes(q);
    });
    if(!filtered || filtered.length === 0){ ratesList.innerHTML = '<div class="tiny muted">Aucune devise</div>'; return; }

    // Render each currency with symbol, type, name, id and createdAt
    ratesList.innerHTML = filtered.map(r => {
      const id = r._id || r.id || '';
      const symbol = (r.symbol || r.pair || '').toString().toUpperCase();
      const name = r.name || (r.desc||'') || '';
      const type = (r.type || 'crypto').toString();
      const when = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '';
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div style="min-width:0">
          <div style="font-weight:700">${escapeHtml(symbol)}</div>
          <div class="tiny muted" style="margin-top:4px">${escapeHtml(type)}${name ? ' • ' + escapeHtml(name) : ''}</div>
        </div>
        <div style="text-align:right;min-width:120px">
          <div class="tiny muted">id:${escapeHtml(id)}</div>
          <div class="tiny muted">${escapeHtml(when)}</div>
        </div>
      </div>`;
    }).join('');
  }

  if(ratesFilter) ratesFilter.addEventListener('input', ()=> renderRatesList(ratesCache));
  if(ratesRefreshBtn) ratesRefreshBtn.addEventListener('click', ()=> loadRates());

  if(rAdd){
    rAdd.addEventListener('click', async () => {
      const symbol = rSymbol && rSymbol.value ? rSymbol.value.trim().toUpperCase() : '';
      const name = rName && rName.value ? rName.value.trim() : '';
      const type = rType && rType.value ? rType.value : 'crypto';
      if(!symbol) return alert('Symbole requis (ex: BTC)');
      // build payload
      const payload = { symbol, name, type };
      try {
        showLoader('Enregistrement devise…');
        // try admin currency endpoint first
        let res = await authFetch('/admin/currencies', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
        if(!res.ok){
          // fallback to admin/rates if server not updated (best-effort)
          res = await authFetch('/admin/rates', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ pair: symbol, rate: 1, desc: name }) });
        }
        const j = await res.json().catch(()=>null);
        if(res.ok && j && (j.success || j.rate || j.currency)){
          toast('Devise ajoutée / modifiée');
          if(rSymbol) rSymbol.value=''; if(rName) rName.value=''; if(rType) rType.value='crypto';
          loadRates();
        } else {
          console.error('rAdd failed', res, j);
          toast('Erreur enregistrement devise', false);
          alert((j && j.message) || 'Erreur');
        }
      } catch(e){
        console.error('rAdd err', e);
        toast('Erreur serveur', false);
      } finally{ hideLoader(); }
    });
  }

  /* ---------------------------
     PAYMENTS management (admin)
     --------------------------- */
  let paymentsCache = [];

  async function loadPayments(){
    if(!requireEl(pmListEl,'payments-list')) return;
    try {
      const res = await authFetch('/admin/payment-methods');
      if(!res.ok) throw new Error('Impossible de charger paiements');
      const body = await res.json();
      if(!body || !body.success) { pmListEl.innerHTML = '<div class="tiny muted">Aucune méthode</div>'; paymentsCache = []; return; }
      paymentsCache = Array.isArray(body.methods) ? body.methods : [];
      renderPayments();
    } catch (e) {
      console.error(e); pmListEl.innerHTML = '<div class="tiny muted">Erreur chargement</div>'; paymentsCache = [];
    }
  }

  function renderPayments(){
    if(!requireEl(pmListEl,'payments-list')) return;
    const q = (pmSearch && pmSearch.value || '').trim().toLowerCase();
    const filtered = paymentsCache.filter(p => {
      if(!q) return true;
      return (p.name||'').toLowerCase().includes(q) || (p.network||'').toLowerCase().includes(q);
    });
    if(!filtered || filtered.length === 0){ pmListEl.innerHTML = '<div class="tiny muted">Aucune méthode</div>'; return; }

    pmListEl.innerHTML = filtered.map(p => {
      const id = p._id || p.id || '';
      const n = p.network ? ` (${escapeHtml(p.network)})` : '';
      const details = p.details ? `<div class="meta">${escapeHtml(p.details)}</div>` : '';
      return `<div class="payment-item" data-pmid="${escapeHtml(id)}">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px"><strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</strong>${n}${p.active ? '<span class="tiny" style="margin-left:8px;color:green">● actif</span>' : '<span class="tiny" style="margin-left:8px;color:#999">● inactif</span>'}</div>
          ${details}
        </div>
        <div class="actions">
          <button class="btn" data-pm-id="${escapeHtml(id)}" data-pm-action="edit">Modifier</button>
          <button class="btn ghost" data-pm-id="${escapeHtml(id)}" data-pm-action="delete">Supprimer</button>
        </div>
      </div>`;
    }).join('');
  }

  if(pmListEl){
    pmListEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-pm-action]');
      if(!btn) return;
      const action = btn.getAttribute('data-pm-action');
      const id = btn.getAttribute('data-pm-id');
      if(!id){ toast('ID méthode introuvable', false); return; }
      if(action === 'edit') return fillPaymentForm(id);
      if(action === 'delete') return deletePaymentMethod(id);
    });
  }

  function fillPaymentForm(id){
    const found = paymentsCache.find(p => String(p._id) === String(id) || String(p.id) === String(id));
    if(!found) return toast('Méthode introuvable', false);
    if(pmId) pmId.value = found._id || found.id || '';
    if(pmName) pmName.value = found.name || '';
    if(pmType) pmType.value = found.type || 'fiat';
    if(pmNetwork) pmNetwork.value = found.network || '';
    if(pmDetails) pmDetails.value = found.details || '';
    if(pmActive) pmActive.checked = !!found.active;
    if(pmName) pmName.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearPaymentForm(){
    if(pmId) pmId.value = ''; if(pmName) pmName.value=''; if(pmType) pmType.value='fiat'; if(pmNetwork) pmNetwork.value=''; if(pmDetails) pmDetails.value=''; if(pmActive) pmActive.checked=true;
  }

  if(pmClear) pmClear.addEventListener('click', (e) => { e.preventDefault(); clearPaymentForm(); });

  if(pmSave){
    pmSave.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = pmId && pmId.value || null;
      const name = pmName && pmName.value.trim();
      const type = pmType && pmType.value;
      const network = pmNetwork && pmNetwork.value.trim();
      const details = pmDetails && pmDetails.value.trim();
      const active = !!(pmActive && pmActive.checked);
      if(!name) return alert('Nom requis');
      try {
        showLoader('Enregistrement méthode…');
        const payload = { id, name, type, network, details, active };
        const res = await authFetch('/admin/payment-methods', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
        const j = await res.json().catch(()=>null);
        if(res.ok && j && j.success){
          toast('Méthode enregistrée');
          clearPaymentForm();
          loadPayments();
        } else {
          console.error('pm save failed', res, j);
          toast('Erreur sauvegarde', false);
        }
      } catch (err) {
        console.error(err);
        toast('Erreur serveur', false);
      } finally { hideLoader(); }
    });
  }

  async function deletePaymentMethod(id){
    if(!id) { toast('ID méthode introuvable', false); return; }
    if(!confirm('Supprimer cette méthode de paiement ?')) return;
    try {
      showLoader('Suppression méthode…');
      const res = await authFetch('/admin/payment-methods/' + id, { method:'DELETE' });
      const j = await res.json().catch(()=>null);
      if(res.ok && j && j.success){
        toast('Méthode supprimée');
        loadPayments();
      } else { console.error('pm delete failed', res, j); toast('Erreur suppression', false); }
    } catch(e){ console.error(e); toast('Erreur', false); }
    finally{ hideLoader(); }
  }

  if(pmRefresh) pmRefresh.addEventListener('click', () => { loadPayments(); });
  if(pmSearch) pmSearch.addEventListener('input', () => renderPayments());

  /* ---------------------------
     helpers / bindings
     --------------------------- */
  const logoutBtn = $('#btn-logout');
  if(logoutBtn) logoutBtn.addEventListener('click', ()=> { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href='/login_admin'; });
  const btnLoadNewsEl = $('#btn-load-news');
  if(btnLoadNewsEl) btnLoadNewsEl.addEventListener('click', loadNews);
  const btnSeedEl = $('#btn-seed-sample');
  if(btnSeedEl) btnSeedEl.addEventListener('click', async () => {
    if(!confirm('Créer une news test ?')) return;
    try {
      showLoader('Création sample…');
      const body = { title: 'News test ' + new Date().toLocaleTimeString(), description:'sample', content:'contenu sample' };
      const res = await authFetch('/admin/news', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(()=>null);
      if(res.ok && j && j.success){ toast('Seed OK'); loadNews(); } else { toast('Erreur seed', false); console.error('seed failed', res, j); }
    } catch(e){ console.error(e); toast('Erreur', false); }
    finally{ hideLoader(); }
  });

  const btnRefreshAll = $('#btn-refresh');
  if(btnRefreshAll) btnRefreshAll.addEventListener('click', ()=> { loadNews(); loadRates(); loadPayments(); });
  if(btnRefreshTx) btnRefreshTx.addEventListener('click', ()=> { loadTransactions(); });

  document.querySelectorAll('.admin-top-nav .nav-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      document.querySelectorAll('.admin-top-nav .nav-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const t = b.getAttribute('data-target');
      const el = document.getElementById(t);
      if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });

  // initial load
  loadTransactions(); loadNews(); loadRates(); loadPayments();

  // expose if needed
  window.editNews = window.editNews || editNews;
  window.deleteNews = deleteNews;
  window.viewTx = viewTx;
  window.setStatus = setStatus;

})(); // EOF
