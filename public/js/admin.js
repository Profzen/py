document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");
  if (!token) {
    alert("Non autorisé");
    window.location.href = "/login";
  }

  const socket = io();

  // ------------------ NEWS ------------------
  const newsList = document.getElementById("newsList");
  const addNewsBtn = document.getElementById("addNewsBtn");

  async function fetchNews() {
    const res = await fetch("/admin/news", {
      headers: { "Authorization": token }
    });
    const data = await res.json();
    renderNews(data);
  }

  function renderNews(news) {
    newsList.innerHTML = "";
    news.forEach(n => {
      const div = document.createElement("div");
      div.innerHTML = `
        <h3>${n.title}</h3>
        <p>${n.content}</p>
        <button onclick="editNews('${n._id}')">Modifier</button>
        <button onclick="deleteNews('${n._id}')">Supprimer</button>
      `;
      newsList.appendChild(div);
    });
  }

  addNewsBtn.addEventListener("click", () => {
    const title = prompt("Titre de la news :");
    const content = prompt("Contenu :");
    if (title && content) {
      fetch("/admin/news", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token
        },
        body: JSON.stringify({ title, content })
      }).then(fetchNews);
    }
  });

  window.editNews = async function(id) {
    const title = prompt("Nouveau titre :");
    const content = prompt("Nouveau contenu :");
    if (title && content) {
      await fetch(`/admin/news/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token
        },
        body: JSON.stringify({ title, content })
      });
      fetchNews();
    }
  }

  window.deleteNews = async function(id) {
    if (confirm("Supprimer cette news ?")) {
      await fetch(`/admin/news/${id}`, {
        method: "DELETE",
        headers: { "Authorization": token }
      });
      fetchNews();
    }
  }

  fetchNews();

  // ------------------ TRANSACTIONS ------------------
  const transactionsList = document.getElementById("transactionsList");

  async function fetchTransactions() {
    const res = await fetch("/admin/transactions", {
      headers: { "Authorization": token }
    });
    const data = await res.json();
    renderTransactions(data);
  }

  function renderTransactions(tx) {
    transactionsList.innerHTML = "";
    tx.forEach(t => {
      const div = document.createElement("div");
      div.innerHTML = `
        <p>${t.user} → ${t.amount} ${t.currency} : ${t.status}</p>
        <button onclick="setStatus('${t._id}', 'approved')">Approuver</button>
        <button onclick="setStatus('${t._id}', 'rejected')">Rejeter</button>
      `;
      transactionsList.appendChild(div);
    });
  }

  window.setStatus = async function(id, status) {
    await fetch(`/admin/transactions/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token
      },
      body: JSON.stringify({ status })
    });
    fetchTransactions();
  }

  fetchTransactions();

  socket.on("newTransaction", fetchTransactions);
  socket.on("txStatusChanged", fetchTransactions);

  // ------------------ RATES ------------------
  const ratesForm = document.getElementById("ratesForm");
  ratesForm.addEventListener("submit", async e => {
    e.preventDefault();
    const buyRate = ratesForm.buyRate.value;
    const sellRate = ratesForm.sellRate.value;
    await fetch("/admin/rates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token
      },
      body: JSON.stringify({ buyRate, sellRate })
    });
    alert("Rates mis à jour !");
  });
});
