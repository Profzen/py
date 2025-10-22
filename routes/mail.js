// routes/mail.js
// Module d'envoi d'e-mails via nodemailer
// - Gère le cas de certificats autosignés pour dev via SMTP_ALLOW_SELF_SIGNED=true
// - Fournit fallback test (ethereal) si SMTP pas configuré (optionnel)

const nodemailer = require('nodemailer');
const url = require('url');
const path = require('path');

const ADMIN_MAIL = process.env.ADMIN_EMAIL || 'Profzzen@gmail.com';
const MAIL_FROM = process.env.MAIL_FROM || `PY Crypto <no-reply@yourdomain.com>`;

// SMTP config from env
const smtpConfig = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  secure: (process.env.SMTP_SECURE === 'true') || false, // true for 465
  auth: undefined,
};

if (process.env.SMTP_USER) {
  smtpConfig.auth = {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS || ''
  };
}

// Allow self-signed certs in dev if requested
if (process.env.SMTP_ALLOW_SELF_SIGNED === 'true') {
  smtpConfig.tls = smtpConfig.tls || {};
  smtpConfig.tls.rejectUnauthorized = false;
  console.warn('⚠️ SMTP_ALLOW_SELF_SIGNED=true -> tls.rejectUnauthorized = false (development only).');
}

let transporter;
let usingEthereal = false;

async function createTransporter() {
  if (transporter) return transporter;

  if (!smtpConfig.host) {
    // Ethereal fallback for dev
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

  try {
    await transporter.verify();
    console.log('✅ SMTP transporter ready');
  } catch (err) {
    console.warn('⚠️ SMTP verify failed (check .env):', err && err.message ? err.message : err);
  }
  return transporter;
}

function escapeHtml(s) {
  if (s === null || typeof s === 'undefined') return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderDetailsHtml(details) {
  if (!details || typeof details !== 'object') return '<em>Aucun détail fourni</em>';
  const rows = Object.keys(details).map(k => {
    const v = details[k];
    const val = (typeof v === 'object') ? escapeHtml(JSON.stringify(v, null, 2)) : escapeHtml(String(v));
    return `<tr><td style="padding:6px 10px;border:1px solid #eee;font-weight:600;background:#fafafa;width:200px">${escapeHtml(k)}</td><td style="padding:6px 10px;border:1px solid #eee">${val}</td></tr>`;
  });
  return `<table style="border-collapse:collapse;margin-top:8px">${rows.join('')}</table>`;
}

/**
 * Build summary HTML.
 * includeProof: boolean -> whether to include/embed proof section.
 * attachments: optional array of nodemailer attachments (used to check cid presence)
 */
function briefTxHtml(tx, clientEmail, includeProof = false, attachments = []) {
  const created = new Date(tx.createdAt || Date.now()).toLocaleString();
  const proof = tx.proof && typeof tx.proof === 'object' ? tx.proof : null;

  let html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0b2b3a">
      <h2 style="margin:0 0 8px;color:#0b76d1">PY Crypto — Détails transaction</h2>
      <p style="margin:8px 0">Récapitulatif de la transaction <strong>${escapeHtml(String(tx._id || ''))}</strong></p>

      <table style="width:100%;border-collapse:collapse;margin-top:8px">
        <tr>
          <td style="padding:8px;border:1px solid #eee;width:180px;background:#f7fafc"><strong>Type</strong></td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(tx.type || '')}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;background:#f7fafc"><strong>Paire</strong></td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(tx.from || '')} → ${escapeHtml(tx.to || '')}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;background:#f7fafc"><strong>Montant envoyé</strong></td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(String(tx.amountFrom || ''))}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;background:#f7fafc"><strong>Montant reçu estimé</strong></td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(String(tx.amountTo || ''))}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;background:#f7fafc"><strong>Statut</strong></td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(tx.status || '')}</td>
        </tr>
        ${clientEmail ? `<tr><td style="padding:8px;border:1px solid #eee;background:#f7fafc"><strong>Client</strong></td><td style="padding:8px;border:1px solid #eee">${escapeHtml(clientEmail)}</td></tr>` : ''}
        <tr>
          <td style="padding:8px;border:1px solid #eee;background:#f7fafc"><strong>Créée le</strong></td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(created)}</td>
        </tr>
      </table>
  `;

  if (includeProof && proof && proof.url) {
    const proofUrl = escapeHtml(proof.url);
    const mime = (proof.mimeType || '').toLowerCase();
    const isImage = mime.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(proofUrl);

    html += `<div style="margin-top:12px"><h4 style="margin:6px 0 6px;color:#0b76d1">Preuve de paiement</h4>`;

    if (isImage) {
      const cid = `txproof_${tx._id}`;
      const hasCid = attachments && attachments.find(a => a.cid === cid);
      if (hasCid) {
        html += `<div style="margin:8px 0"><img src="cid:${cid}" alt="Preuve de paiement" style="max-width:420px;border:1px solid #eee;border-radius:6px" /></div>`;
        html += `<p style="margin:6px 0"><a href="${proofUrl}" target="_blank" rel="noopener">Ouvrir la preuve dans le navigateur</a></p>`;
      } else {
        html += `<div style="margin:8px 0"><img src="${proofUrl}" alt="Preuve de paiement" style="max-width:420px;border:1px solid #eee;border-radius:6px" /></div>`;
        html += `<p style="margin:6px 0"><a href="${proofUrl}" target="_blank" rel="noopener">Ouvrir la preuve</a></p>`;
      }
    } else {
      html += `<p style="margin:6px 0">Fichier de preuve : <a href="${proofUrl}" target="_blank" rel="noopener">Télécharger / Voir la preuve</a></p>`;
    }

    html += `</div>`;
  }

  // Détails fournis
  html += `<div style="margin-top:12px"><h4 style="margin:6px 0 6px;color:#0b76d1">Détails fournis</h4>`;
  html += renderDetailsHtml(tx.details || {});
  html += `</div>`;

  // If admin may want price snapshot included, it will be part of tx.details or top-level tx when includeProof true — briefTxHtml doesn't decide that
  html += `<div style="margin-top:14px;font-size:13px;color:#666">Cordialement,<br/>L'équipe PY Crypto</div>`;
  html += `</div>`;

  return html;
}

/**
 * Plain text summary. includeProof boolean controls whether proof URL is included.
 */
function briefTxText(tx, clientEmail, includeProof = false) {
  let txt = `Transaction ID: ${tx._id}\nType: ${tx.type || ''}\nPair: ${tx.from || ''} -> ${tx.to || ''}\nMontant envoyé: ${tx.amountFrom}\nMontant reçu estimé: ${tx.amountTo}\nStatut: ${tx.status}\n`;
  if (clientEmail) txt += `Client email: ${clientEmail}\n`;
  txt += `Créée le: ${new Date(tx.createdAt || Date.now()).toLocaleString()}\n\nDétails:\n${JSON.stringify(tx.details || {}, null, 2)}\n`;
  if (includeProof && tx.proof && tx.proof.url) {
    txt += `Preuve: ${tx.proof.url}\n`;
  }
  return txt;
}

/**
 * Sanitize a transaction object to remove sensitive snapshot info before sending to client.
 * It will shallow-clone tx and remove a set of known snapshot keys from top-level and from details.
 */
function sanitizeTxForClient(tx) {
  if (!tx || typeof tx !== 'object') return tx;
  // shallow clone top-level
  const cloned = { ...tx };
  // remove known snapshot fields on top-level
  delete cloned.priceSnapshot;
  delete cloned.snapshot_price;
  delete cloned.snapshot_coinbase;
  delete cloned.snapshot_timestamp;
  // sanitize details (clone)
  const det = (tx.details && typeof tx.details === 'object') ? { ...tx.details } : {};
  // remove snapshot keys from details if present
  delete det.priceSnapshot;
  delete det.snapshot_price;
  delete det.snapshot_coinbase;
  delete det.snapshot_timestamp;
  // attach sanitized details
  cloned.details = det;
  // Also ensure proof stays unchanged (we don't remove proof here)
  return cloned;
}

async function sendMailSafe(mailOptions) {
  try {
    const tr = await createTransporter();
    const info = await tr.sendMail(mailOptions);
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
 * sendTransactionCreated:
 * - client receives summary WITHOUT any price snapshot fields
 * - admin receives summary WITH proof + full transaction object (including snapshot if any)
 */
async function sendTransactionCreated(tx, clientEmail) {
  // prepare admin attachments if proof is image-like
  const attachments = [];
  const proof = tx.proof && typeof tx.proof === 'object' ? tx.proof : null;
  if (proof && proof.url) {
    const mime = (proof.mimeType || '').toLowerCase();
    const isImage = mime.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(proof.url);
    if (isImage) {
      const cid = `txproof_${tx._id}`;
      const filename = path.basename(url.parse(proof.url).pathname || `proof_${tx._id}`);
      attachments.push({
        filename,
        path: proof.url, // remote URL (cloudinary) or local public URL
        cid
      });
    }
  }

  // Client mail (NO price snapshot)
  const sanitizedTx = sanitizeTxForClient(tx);
  const subjectClient = `Confirmation : transaction initialisée (${tx._id})`;
  const textClient = `Bonjour,\n\nVotre transaction a bien été enregistrée et est en statut pending.\n\n${briefTxText(sanitizedTx, clientEmail, false)}\n\nCordialement,\nPY Crypto`;
  const htmlClient = `<div>${briefTxHtml(sanitizedTx, clientEmail, false)}</div>`;

  // Admin mail (INCLUDE proof + full tx)
  const subjectAdmin = `[ADMIN] Nouvelle transaction (${tx._id})`;
  const textAdmin = `Nouvelle transaction créée:\n\n${briefTxText(tx, clientEmail, true)}`;
  const htmlAdmin = `<div><h3>Nouvelle transaction enregistrée</h3>${briefTxHtml(tx, clientEmail, true, attachments)}<pre style="background:#f7fafc;padding:8px;border-radius:6px;margin-top:12px">${escapeHtml(JSON.stringify(tx, null, 2))}</pre></div>`;

  const promises = [];

  // Send client mail if email present
  if (clientEmail) {
    promises.push(sendMailSafe({
      from: MAIL_FROM,
      to: clientEmail,
      subject: subjectClient,
      text: textClient,
      html: htmlClient
      // no attachments for client
    }));
  }

  // Send admin mail (include attachments if present)
  promises.push(sendMailSafe({
    from: MAIL_FROM,
    to: ADMIN_MAIL,
    subject: subjectAdmin,
    text: textAdmin,
    html: htmlAdmin,
    attachments: attachments.length ? attachments : undefined
  }));

  const results = await Promise.all(promises);
  return results;
}

/**
 * sendTransactionStatusChanged:
 * - client: receives status update WITHOUT price snapshot
 * - admin: receives status update WITH proof and full tx (incl. snapshot)
 */
async function sendTransactionStatusChanged(tx, clientEmail) {
  if (!clientEmail) return { ok: false, error: 'no-client-email' };

  // prepare admin attachments if proof is image-like
  const attachments = [];
  const proof = tx.proof && typeof tx.proof === 'object' ? tx.proof : null;
  if (proof && proof.url) {
    const mime = (proof.mimeType || '').toLowerCase();
    const isImage = mime.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(proof.url);
    if (isImage) {
      const cid = `txproof_${tx._id}`;
      const filename = path.basename(url.parse(proof.url).pathname || `proof_${tx._id}`);
      attachments.push({
        filename,
        path: proof.url,
        cid
      });
    }
  }

  const sanitizedTx = sanitizeTxForClient(tx);

  const subjectClient = `Mise à jour statut transaction (${tx._id}) : ${tx.status}`;
  const textClient = `Bonjour,\n\nLe statut de votre transaction ${tx._id} a été mis à jour: ${tx.status}\n\n${briefTxText(sanitizedTx, clientEmail, false)}\n\nCordialement,\nPY Crypto`;
  const htmlClient = `<div>${briefTxHtml(sanitizedTx, clientEmail, false)}</div>`;

  const subjectAdmin = `[ADMIN] Mise à jour statut transaction (${tx._id}) : ${tx.status}`;
  const textAdmin = `Transaction ${tx._id} statut: ${tx.status}\n\n${briefTxText(tx, clientEmail, true)}`;
  const htmlAdmin = `<div><h3>Mise à jour statut</h3>${briefTxHtml(tx, clientEmail, true, attachments)}<pre style="background:#f7fafc;padding:8px;border-radius:6px;margin-top:12px">${escapeHtml(JSON.stringify(tx, null, 2))}</pre></div>`;

  const results = await Promise.all([
    sendMailSafe({
      from: MAIL_FROM,
      to: clientEmail,
      subject: subjectClient,
      text: textClient,
      html: htmlClient
    }),
    sendMailSafe({
      from: MAIL_FROM,
      to: ADMIN_MAIL,
      subject: subjectAdmin,
      text: textAdmin,
      html: htmlAdmin,
      attachments: attachments.length ? attachments : undefined
    })
  ]);

  return results;
}

module.exports = {
  sendTransactionCreated,
  sendTransactionStatusChanged,
  _debug: { smtpConfig, MAIL_FROM, ADMIN_MAIL }
};
