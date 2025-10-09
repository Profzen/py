// public/js/script.js
(async function(){
  // inject header
  try {
    if(!document.body.classList.contains('no-header')){
      const r = await fetch('/partials/header.html');
      if(r.ok){
        const html = await r.text();
        const temp = document.createElement('div');
        temp.innerHTML = html;
        document.body.insertBefore(temp.firstElementChild, document.body.firstChild);
        // set active
        document.querySelectorAll('.nav-pc a, .icon-btn').forEach(a=>{
          try {
            const h = a.getAttribute('href');
            if(h === location.pathname || (h !== '/' && location.pathname.startsWith(h))) a.classList.add('active');
            if(h === '/' && location.pathname === '/') a.classList.add('active');
          } catch(e){}
        });
        // if user logged show username + logout
        const token = localStorage.getItem('token');
        const loginBtn = document.querySelector('.login-btn');
        if(token && loginBtn){
          const username = localStorage.getItem('username') || '';
          const menu = document.createElement('div');
          menu.style.display = 'flex'; menu.style.gap = '8px'; menu.style.alignItems = 'center';
          const name = document.createElement('div'); name.innerText = username || 'Mon compte'; name.style.fontWeight='700'; name.style.color='var(--accent)';
          const out = document.createElement('button'); out.className='btn ghost'; out.innerText='Déconnexion';
          out.onclick = ()=>{ localStorage.removeItem('token'); localStorage.removeItem('username'); location.reload(); };
          menu.appendChild(name); menu.appendChild(out);
          loginBtn.parentNode.replaceChild(menu, loginBtn);
        }
      }
    }
  } catch(e){ console.warn('header injection failed', e); }

  // connect socket.io
  let socket;
  try {
    socket = io();
    socket.on('connect', ()=>{ console.log('socket connected', socket.id); });
    socket.on('newTransaction', (tx) => {
      // show a small notification for admin pages
      console.log('newTransaction', tx);
      if(document.location.pathname === '/admin') {
        // reload admin table if present
        if(typeof loadAdmin === 'function') loadAdmin();
      }
    });
    socket.on('txStatusChanged', payload => {
      // payload = { id, status, tx }
      console.log('txStatusChanged', payload);
      // if user has local tx with this id, update localStorage and re-render history
      const local = JSON.parse(localStorage.getItem('local_txs') || '[]') || [];
      const idx = local.findIndex(x => (x._id === payload.id || x.id === payload.id));
      if(idx >= 0){
        local[idx].status = payload.status;
        localStorage.setItem('local_txs', JSON.stringify(local));
        if(typeof loadHistory === 'function') loadHistory();
        // show toast
        smallToast(`Transaction ${payload.id} mise à jour : ${payload.status}`);
      }
      // on admin page, refresh
      if(document.location.pathname === '/admin' && typeof loadAdmin === 'function') loadAdmin();
    });
  } catch(e){ console.warn('socket init failed', e); }

  // toast
  function smallToast(msg){
    const el = document.createElement('div');
    el.style.position='fixed'; el.style.right='18px'; el.style.bottom='90px'; el.style.background='rgba(10,20,30,0.9)';
    el.style.color='white'; el.style.padding='10px 14px'; el.style.borderRadius='10px'; el.style.zIndex=99999;
    el.innerText = msg;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 6000);
  }

  // price + sparkline logic
  async function loadPrices(){
    try {
      const r = await fetch('/api/prices');
      const payload = await r.json();
      const data = payload.prices || payload;
      const el = document.getElementById('crypto-prices');
      if(!el) return;
      el.innerHTML = '';
      const coins = [
        { id:'bitcoin', sym:'BTC' },
        { id:'ethereum', sym:'ETH' },
        { id:'tether', sym:'USDT' },
        { id:'usd-coin', sym:'USDC' },
        { id:'solana', sym:'SOL' },
        { id:'binancecoin', sym:'BNB' },
        { id:'cardano', sym:'ADA' },
        { id:'dogecoin', sym:'DOGE' },
        { id:'matic-network', sym:'MATIC' },
        { id:'litecoin', sym:'LTC' }
      ];
      for(const c of coins){
        const v = (data[c.id] && data[c.id].usd) ? data[c.id].usd : 'N/A';
        const div = document.createElement('div'); div.className='price-item';
        div.innerHTML = `<div class="left"><div class="coin-icon">${c.sym[0]}</div><div><div class="name">${c.sym}</div><div class="small">${c.id}</div></div></div><div style="display:flex;flex-direction:column;align-items:flex-end"><div class="value">$${formatNumber(v)}</div><div class="sparkline" id="sp-${c.sym}"></div></div>`;
        el.appendChild(div);
        drawSparkline(`#sp-${c.sym}`, c.id).catch(()=>{});
      }
    } catch(e){ console.error(e); }
  }

  async function drawSparkline(selector, coinId='bitcoin', days=1){
    try {
      const res = await fetch(`/api/market_chart?coin=${coinId}&days=${days}`);
      const payload = await res.json();
      const pts = payload.data || payload;
      if(!pts || !pts.length) {
        document.querySelector(selector).innerHTML = '';
        return;
      }
      const w = 100, h = 36, pad=4;
      const vals = pts.map(p=>p.v);
      const min = Math.min(...vals), max = Math.max(...vals);
      const xs = pts.map((p,i)=> (i/(pts.length-1))*(w-2*pad) + pad );
      const ys = pts.map(p=> (max===min? h/2 : pad + (1 - (p.v - min)/(max-min))*(h-2*pad)));
      const d = xs.map((x,i)=> `${i===0?'M':'L'} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(' ');
      const svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0b76d1'}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
      const el = document.querySelector(selector);
      if(el) el.innerHTML = svg;
    } catch(e){}
  }

  function formatNumber(n){
    if(n === undefined || n === null) return 'N/A';
    const num = Number(n);
    if(isNaN(num)) return 'N/A';
    if(num >= 1000) return Intl.NumberFormat().format(num.toFixed(2));
    return num.toFixed(2);
  }

  loadPrices(); setInterval(loadPrices, 30000);

  // modal helper for news/details
  window.openNewsModal = function(news){
    const existing = document.querySelector('.modal'); if(existing) existing.remove();
    const modal = document.createElement('div'); modal.className='modal';
    const box = document.createElement('div'); box.className='box';
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h3>${news.title||''}</h3><button id="close-x" class="btn ghost">Fermer</button></div>
      ${news.image?`<img src="${news.image}" style="width:100%;height:320px;object-fit:cover;border-radius:8px;margin-top:12px">`:''}
      <p class="small" style="margin-top:12px">${news.description||''}</p>
      <div style="margin-top:14px;color:var(--text)">${news.content||''}</div>`;
    modal.appendChild(box); document.body.appendChild(modal);
    box.querySelector('#close-x').onclick = ()=> modal.remove();
    modal.onclick = (e)=>{ if(e.target === modal) modal.remove(); };
  };

})();
