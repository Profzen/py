// routes/mail.js
// Module d'envoi d'e-mails via nodemailer
// - Gère le cas de certificats autosignés pour dev via SMTP_ALLOW_SELF_SIGNED=true
// - Fournit fallback test (ethereal) si SMTP pas configuré (optionnel)
// Usage: configure via .env (voir README below)

const nodemailer = require('nodemailer');

const ADMIN_MAIL = process.env.ADMIN_EMAIL || 'Profzzen@gmail.com';
const MAIL_FROM = process.env.MAIL_FROM || `PY Crypto <no-reply@yourdomain.com>`;

// SMTP config from env
const smtpConfig = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  secure: (process.env.SMTP_SECURE === 'true') || false, // true for 465
  auth: undefined,
  // tls may be attached below depending on env
};

if (process.env.SMTP_USER) {
  smtpConfig.auth = {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS || ''
  };
}

// Option to allow self-signed certs for development/testing only.
// Set SMTP_ALLOW_SELF_SIGNED=true in .env to enable (not recommended in prod).
if (process.env.SMTP_ALLOW_SELF_SIGNED === 'true') {
  smtpConfig.tls = smtpConfig.tls || {};
  smtpConfig.tls.rejectUnauthorized = false;
  console.warn('⚠️ SMTP_ALLOW_SELF_SIGNED=true -> tls.rejectUnauthorized = false (development only).');
}

let transporter;
let usingEthereal = false;

async function createTransporter() {
  if (transporter) return transporter;

  // If no SMTP host provided, create an ethereal test account (dev only)
  if (!smtpConfig.host) {
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      usingEthereal = true;
      console.log('ℹ️ No SMTP_HOST configured — using Ethereal test account (dev).');
    } catch (err) {
      console.error('Ethereal createTestAccount failed', err && err.message ? err.message : err);
      throw err;
    }
  } else {
    transporter = nodemailer.createTransport(smtpConfig);
  }

  // verify (best-effort)
  try {
    await transporter.verify();
    console.log('✅ SMTP transporter ready');
  } catch (err) {
    console.warn('⚠️ SMTP verify failed (check .env):', err && err.message ? err.message : err);
    // keep transporter even if verify failed (we'll attempt send and log errors)
  }
  return transporter;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function briefTxHtml(tx, clientEmail) {
  const lines = [
    `<p><strong>ID :</strong> ${tx._id}</p>`,
    `<p><strong>Type :</strong> ${escapeHtml(tx.type || '')}</p>`,
    `<p><strong>Pair :</strong> ${escapeHtml(tx.from || '')} → ${escapeHtml(tx.to || '')}</p>`,
    `<p><strong>Montant envoyé :</strong> ${escapeHtml(String(tx.amountFrom || ''))}</p>`,
    `<p><strong>Montant reçu estimé :</strong> ${escapeHtml(String(tx.amountTo || ''))}</p>`,
    `<p><strong>Statut :</strong> ${escapeHtml(tx.status || '')}</p>`,
    clientEmail ? `<p><strong>Client email :</strong> ${escapeHtml(clientEmail)}</p>` : '',
    `<h4>Détails fournis</h4>`,
    `<pre style="white-space:pre-wrap;border:1px solid #eee;padding:8px;border-radius:6px">${escapeHtml(JSON.stringify(tx.details || {}, null, 2))}</pre>`,
    `<p>Créée le : ${new Date(tx.createdAt || Date.now()).toLocaleString()}</p>`
  ];
  return lines.join('\n');
}

function briefTxText(tx, clientEmail) {
  let txt = `Transaction ID: ${tx._id}\nType: ${tx.type || ''}\nPair: ${tx.from || ''} -> ${tx.to || ''}\nMontant envoyé: ${tx.amountFrom}\nMontant reçu estimé: ${tx.amountTo}\nStatut: ${tx.status}\n`;
  if (clientEmail) txt += `Client email: ${clientEmail}\n`;
  txt += `Détails: ${JSON.stringify(tx.details || {}, null, 2)}\n`;
  txt += `Créée le: ${new Date(tx.createdAt || Date.now()).toLocaleString()}\n`;
  return txt;
}

async function sendMailSafe(mailOptions) {
  try {
    const tr = await createTransporter();
    const info = await tr.sendMail(mailOptions);
    // For ethereal, log preview url
    if (usingEthereal && info && info.messageId) {
      console.log('Mail sent (ethereal). Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    return { ok: true, info };
  } catch (err) {
    console.warn('mail send failed:', err && err.message ? err.message : err);
    return { ok: false, error: err };
  }
}

/**
 * Envoie mail après création transaction (admin + client if available)
 */
async function sendTransactionCreated(tx, clientEmail) {
  const subjectClient = `Confirmation : transaction initialisée (${tx._id})`;
  const htmlClient = `<p>Bonjour,</p>
    <p>Votre transaction a bien été enregistrée et est en statut <strong>pending</strong>.</p>
    ${briefTxHtml(tx, clientEmail)}
    <p>Cordialement,<br>PY Crypto</p>`;
  const textClient = `Bonjour,\n\nVotre transaction a bien été enregistrée et est en statut pending.\n\n${briefTxText(tx, clientEmail)}\n\nCordialement,\nPY Crypto`;

  const subjectAdmin = `[ADMIN] Nouvelle transaction (${tx._id})`;
  const htmlAdmin = `<p>Nouvelle transaction enregistrée :</p>${briefTxHtml(tx, clientEmail)}`;
  const textAdmin = `Nouvelle transaction créée:\n\n${briefTxText(tx, clientEmail)}`;

  const sends = [];
  if (clientEmail) {
    sends.push(sendMailSafe({
      from: MAIL_FROM,
      to: clientEmail,
      subject: subjectClient,
      text: textClient,
      html: htmlClient
    }));
  }

  sends.push(sendMailSafe({
    from: MAIL_FROM,
    to: ADMIN_MAIL,
    subject: subjectAdmin,
    text: textAdmin,
    html: htmlAdmin
  }));

  const results = await Promise.all(sends);
  return results;
}

/**
 * Envoie mail au client lors d'un changement de statut
 */
async function sendTransactionStatusChanged(tx, clientEmail) {
  if (!clientEmail) return { ok: false, error: 'no-client-email' };

  const subject = `Mise à jour statut transaction (${tx._id}) : ${tx.status}`;
  const html = `<p>Bonjour,</p>
    <p>Le statut de votre transaction <strong>${tx._id}</strong> a été mis à jour : <strong>${escapeHtml(tx.status || '')}</strong>.</p>
    ${briefTxHtml(tx, clientEmail)}
    <p>Cordialement,<br>PY Crypto</p>`;
  const text = `Bonjour,\n\nLe statut de votre transaction ${tx._id} a été mis à jour: ${tx.status}\n\n${briefTxText(tx, clientEmail)}\n\nCordialement,\nPY Crypto`;

  return await sendMailSafe({
    from: MAIL_FROM,
    to: clientEmail,
    subject,
    text,
    html
  });
}

module.exports = {
  sendTransactionCreated,
  sendTransactionStatusChanged,
  _debug: { smtpConfig, MAIL_FROM, ADMIN_MAIL }
};
