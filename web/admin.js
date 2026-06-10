'use strict';
// Page d'administration dédiée : gestion des comptes équipe + droits par vue (RBAC).
// Réservée aux admins (sinon redirection vers le reporting).

const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// Liste des vues (clé → libellé) — miroir des MODULES du reporting (mise à jour si on ajoute une vue).
const VIEWS = [
  ['direction', 'Direction'], ['commerciale', 'Analyse commerciale'], ['estore', 'Suivi e-store & trafic'], ['onsite', 'Comportement on-site'],
  ['acquisition', 'Acquisition (GA)'], ['international', 'International'], ['marketplace', 'Marketplace'],
  ['croisees', 'Analyses croisées'], ['saisonprod', 'Offre & Merchandising'], ['produit', 'Produit'],
  ['omnicanal', 'Omnicanal'], ['crosscanal', 'Cross-canal'], ['quotidien', 'Quotidien'], ['full', 'Full'],
];
const vLabel = k => (VIEWS.find(v => v[0] === k) || [k, k])[1];

function renderViewChecks(container, selected) {
  if (!container) return;
  const sel = new Set(selected || []);
  container.innerHTML = VIEWS.map(([k, lbl]) => `<label style="font-size:11px;display:inline-flex;align-items:center;gap:4px;background:var(--s);border:1px solid var(--br);border-radius:6px;padding:4px 8px;cursor:pointer"><input type="checkbox" data-view="${k}"${sel.has(k) ? ' checked' : ''}> ${esc(lbl)}</label>`).join('');
}
function readViewChecks(container) {
  return container ? [...container.querySelectorAll('input[data-view]')].filter(i => i.checked).map(i => i.dataset.view) : [];
}

async function loadUsers() {
  const list = document.getElementById('acList'); if (!list) return;
  const r = await fetch('/auth/users'); if (!r.ok) { list.innerHTML = '<div class="note">Erreur de chargement.</div>'; return; }
  const users = await r.json();
  if (!users.length) { list.innerHTML = '<div class="note">Aucun compte en base (le compte admin d’environnement reste actif).</div>'; return; }
  const rows = users.map(u => {
    const av = Array.isArray(u.allowed_views) && u.allowed_views.length ? u.allowed_views : null;
    const viewsTxt = u.role === 'admin' ? '<span class="na">toutes</span>' : (av ? esc(av.map(vLabel).join(', ')) : '<span class="na">toutes</span>');
    const editor = u.role === 'admin' ? '' :
      `<tr class="rights-row hidden" data-rights="${esc(u.username)}"><td colspan="5"><div class="note">Vues autorisées (aucune = toutes) :</div><div class="vbox" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0"></div><button class="btn blue" data-act="saverights" data-u="${esc(u.username)}">Enregistrer les droits</button></td></tr>`;
    return `<tr><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '🔑 Admin' : 'Utilisateur'}</td>
      <td>${u.active ? '<span class="pill">actif</span>' : '<span class="pill miss">inactif</span>'}</td>
      <td style="font-size:11px;color:var(--t2)">${viewsTxt}</td>
      <td>${u.role === 'admin' ? '' : `<button class="btn" data-act="rights" data-u="${esc(u.username)}">Droits</button> `}<button class="btn" data-act="toggle" data-u="${esc(u.username)}" data-v="${u.active ? 0 : 1}">${u.active ? 'Désactiver' : 'Réactiver'}</button> <button class="btn" data-act="del" data-u="${esc(u.username)}">Supprimer</button></td></tr>${editor}`;
  }).join('');
  list.innerHTML = `<table><thead><tr><th>Identifiant</th><th>Rôle</th><th>Statut</th><th>Vues autorisées</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  const rightsRow = u => [...list.querySelectorAll('tr[data-rights]')].find(tr => tr.dataset.rights === u);
  list.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const u = b.dataset.u;
    if (b.dataset.act === 'del') { if (!confirm(`Supprimer le compte « ${u} » ?`)) return; await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'DELETE' }); loadUsers(); }
    else if (b.dataset.act === 'toggle') { await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: b.dataset.v === '1' }) }); loadUsers(); }
    else if (b.dataset.act === 'rights') {
      const row = rightsRow(u); if (!row) return;
      const wasHidden = row.classList.toggle('hidden');
      if (!wasHidden) { const usr = users.find(x => x.username === u); renderViewChecks(row.querySelector('.vbox'), Array.isArray(usr.allowed_views) ? usr.allowed_views : null); }
    }
    else if (b.dataset.act === 'saverights') {
      const row = rightsRow(u); if (!row) return;
      const allowedViews = readViewChecks(row.querySelector('.vbox'));
      await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowedViews }) });
      document.getElementById('acNote').textContent = `✓ Droits de « ${u} » mis à jour.`;
      loadUsers();
    }
  }));
}

async function addUser() {
  const note = document.getElementById('acNote');
  const username = document.getElementById('acUser').value.trim();
  const password = document.getElementById('acPass').value;
  const role = document.getElementById('acRole').value;
  if (!username || !password) { note.textContent = '⚠ Identifiant et mot de passe requis.'; return; }
  const allowedViews = readViewChecks(document.getElementById('acViews'));
  const r = await fetch('/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role, allowedViews }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur'); return; }
  note.textContent = `✓ Compte « ${username} » enregistré${allowedViews.length ? ` (${allowedViews.length} vue(s))` : ' (toutes vues)'}.`;
  document.getElementById('acUser').value = ''; document.getElementById('acPass').value = '';
  loadUsers();
}

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  if (u.role !== 'admin') {
    document.getElementById('guard').innerHTML = '<div class="note">⛔ Accès réservé aux administrateurs. <a href="/app.html">Retour au reporting</a>.</div>';
    return;
  }
  if (!u.dbAccounts) {
    document.getElementById('guard').innerHTML = '<div class="note">⚠️ La gestion des comptes équipe nécessite une base de données (<code>DATABASE_URL</code>). Le compte admin d’environnement reste actif, mais les comptes créés ne seront pas persistés.</div>';
  } else {
    document.getElementById('guard').classList.add('hidden');
  }
  document.getElementById('adminBody').classList.remove('hidden');
  renderViewChecks(document.getElementById('acViews'), null);
  document.getElementById('acAdd').addEventListener('click', addUser);
  loadUsers();
})();
