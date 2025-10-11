// public/js/login_admin.js
(function(){
  const form = document.getElementById('login-form');
  const msg = document.getElementById('msg');

  async function loginAdmin(email, password){
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if(!res.ok || !data.success){
        throw new Error(data.message || 'Erreur de connexion');
      }

      // Vérifie que c'est bien un admin
      if(!(data.user.role === 'admin' || data.user.isAdmin)){
        throw new Error('Accès réservé aux administrateurs');
      }

      // Sauvegarde token + infos user
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('justLogin', '1');

      msg.style.color = '#00ff9d';
      msg.innerText = 'Connexion réussie, redirection...';

      setTimeout(()=>{
        window.location.href = '/admin';
      }, 800);

    } catch(err){
      console.error('loginAdmin err', err);
      msg.innerText = err.message || 'Erreur de connexion';
      msg.style.color = '#ff6d6d';
    }
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    msg.innerText = '';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    if(!email || !password){
      msg.innerText = 'Veuillez remplir tous les champs.';
      return;
    }
    msg.innerText = 'Connexion en cours...';
    await loginAdmin(email, password);
  });

})();
