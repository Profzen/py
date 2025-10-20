/* public/js/exchange.js
   - Usage: inclure ce script sur ta page exchange.html
   - Assure-toi que /api/transactions (POST) existe et accepte le body suivant :
     { from, to, amountFrom, amountTo, type, details } 
   - details: objet contenant nom/prenom/phone/cryptoAddress/paymentNumber etc.
*/

(function(){
  // helpers
  const $ = q => document.querySelector(q);
  function toast(msg, ok=true){
    const t=document.createElement('div');
    t.style.position='fixed';t.style.right='18px';t.style.bottom='18px';
    t.style.padding='10px 14px';t.style.borderRadius='10px';t.style.color='#fff';
    t.style.zIndex = 9999;
    t.style.background = ok ? 'linear-gradient(90deg,#17a063,#15b36a)' : 'linear-gradient(90deg,#e14b4b,#d83a3a)';
    t.innerText = msg; document.body.appendChild(t); setTimeout(()=>t.remove(),3000);
  }
  function authFetch(url, opts={}){
    opts.headers = opts.headers || {};
    const token = localStorage.getItem('token');
    if(token) opts.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, opts);
  }

  // format Transaction used by backend
  function buildTx({from, to, amountFrom, amountTo, type, details, userId=null}){
    return {
      from, to, amountFrom: Number(amountFrom), amountTo: Number(amountTo),
      type, details: details || {}, status: 'pending',
      user: userId || null,
      createdAt: new Date().toISOString()
    };
  }

  // save guest tx locally
  function saveGuestTxLocal(tx){
    const raw = localStorage.getItem('guestTx') || '[]';
    const arr = JSON.parse(raw);
    arr.unshift(tx); // latest first
    localStorage.setItem('guestTx', JSON.stringify(arr));
  }

  // submit transaction (called from confirm modal)
  // submitTransaction (à remplacer complètement)
async function submitTransaction(tx){
  try{
    // tentative de POST vers le serveur (même si non connecté)
    const res = await fetch('/api/transactions', { 
      method:'POST', 
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(tx)
    });

    if(res.ok){
      const j = await res.json();
      if(j && j.success){
        toast('Transaction enregistrée sur le serveur');
        // sauvegarde aussi en localStorage pour historique guest
        saveGuestTxLocal(tx);
        return { ok:true, server:true };
      }
    }
    // fallback local si erreur serveur
    saveGuestTxLocal(tx);
    toast('Serveur indisponible, transaction sauvegardée localement', false);
    return { ok:false, local:true };
  }catch(err){
    console.error('submitTransaction err', err);
    saveGuestTxLocal(tx);
    toast('Pas de connexion — transaction sauvegardée localement', false);
    return { ok:false, local:true };
  }
}


  // public API for page
  window.PYExchange = {
    openConfirmModal: function(txFormData){
      // txFormData expected {from,to,amountFrom,amountTo,type}
      // build modal to ask user for details depending on type (fiat-crypto, crypto-fiat, crypto-crypto, fiat-fiat)
      const modal = document.createElement('div'); modal.className='modal';
      const box = document.createElement('div'); box.className='box';
      box.style.maxWidth = '520px';
      box.innerHTML = `
        <h3 style="margin:0 0 8px">Confirmer la transaction</h3>
        <div style="margin-bottom:8px">Pair: <strong>${txFormData.from} → ${txFormData.to}</strong></div>
        <div style="margin-bottom:8px">Montant: <strong>${txFormData.amountFrom}</strong> → <strong>${txFormData.amountTo}</strong></div>
        <form id="tx-details-form" style="display:flex;flex-direction:column;gap:8px">
          <input name="firstName" placeholder="Prénom" required style="padding:8px;border-radius:8px;border:1px solid #e6eef7">
          <input name="lastName" placeholder="Nom" required style="padding:8px;border-radius:8px;border:1px solid #e6eef7">
          <input name="phone" placeholder="Téléphone (ex: +229...)" required style="padding:8px;border-radius:8px;border:1px solid #e6eef7">
          <input name="cryptoAddress" placeholder="Adresse crypto (si applicable)" style="padding:8px;border-radius:8px;border:1px solid #e6eef7">
          <select name="paymentMethod" style="padding:8px;border-radius:8px;border:1px solid #e6eef7">
            <option value="">Moyen de paiement (choisir)</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="bank_transfer">Virement bancaire</option>
            <option value="cash">Espèces</option>
          </select>
          <input name="paymentNumber" placeholder="Numéro sur lequel envoyer/recevoir" style="padding:8px;border-radius:8px;border:1px solid #e6eef7">
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
            <button type="button" id="tx-cancel" class="btn ghost">Annuler</button>
            <button type="submit" id="tx-submit" class="btn">Confirmer</button>
          </div>
        </form>
      `;
      modal.appendChild(box); document.body.appendChild(modal);

      // handlers
      modal.querySelector('#tx-cancel').onclick = ()=> modal.remove();
      modal.querySelector('#tx-details-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const details = {
          firstName: fd.get('firstName'),
          lastName: fd.get('lastName'),
          phone: fd.get('phone'),
          cryptoAddress: fd.get('cryptoAddress'),
          paymentMethod: fd.get('paymentMethod'),
          paymentNumber: fd.get('paymentNumber'),
        };
        const tx = buildTx({...txFormData, details});
        // attempt to submit
        const res = await submitTransaction(tx);
        modal.remove();
        // if local (guest), you may want to redirect to historique or update UI
        if(res.ok) {
          // redirect to historique if desired
          // window.location.href = '/historique';
        }
      };
    },

    // Call this after a successful login to sync guestTx -> server
    syncGuestTxToServer: async function(){
      const raw = localStorage.getItem('guestTx') || '[]';
      const arr = JSON.parse(raw);
      if(!arr || arr.length === 0) return { synced:0 };
      let synced = 0;
      for(const tx of arr.slice().reverse()){ // oldest first
        try{
          const res = await authFetch('/api/transactions', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(tx) });
          if(res.ok){
            const j = await res.json();
            if(j && j.success){ synced++; }
          }
        }catch(e){
          console.warn('sync tx error', e);
        }
      }
      if(synced > 0) {
        // remove all or remove only synced ones; simple approach: clear all guestTx after attempt
        localStorage.removeItem('guestTx');
        toast(`${synced} transaction(s) synchronisée(s) vers votre compte`);
      }
      return { synced };
    },

    // helper: get local guest transactions (for historique page)
    getGuestTxLocal: function(){ return JSON.parse(localStorage.getItem('guestTx') || '[]'); }
  };

  // Option: auto-sync on page load if user just logged in (token present)
  (async function autoSyncIfNeeded(){
    // if an auth flag 'justLogin' is set by login flow, sync then remove flag
    if(localStorage.getItem('justLogin') === '1'){
      localStorage.removeItem('justLogin');
      try{ await window.PYExchange.syncGuestTxToServer(); }catch(e){ console.warn(e); }
    }
  })();

})();
