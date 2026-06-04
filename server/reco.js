'use strict';
// ============================================================================
// reco.js — Moteur de recommandations stratégiques (API Claude Messages).
// Distille le reporting en résumé compact, l'envoie à Claude, renvoie des
// recommandations court / moyen / long terme. Inactif sans ANTHROPIC_API_KEY.
// Appel HTTP direct (fetch), prompt caching sur le system prompt stable.
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('./auth');
const { buildReport } = require('./reports');

const router = express.Router();

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
function isConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

// System prompt STABLE (caché) — aucune donnée volatile ici (sinon le cache casse).
const SYSTEM = `Tu es un consultant senior en stratégie e-commerce et retail pour une maison de mode française (prêt-à-porter et accessoires haut de gamme). Tu analyses un reporting chiffré et tu produis des recommandations stratégiques actionnables, hiérarchisées par horizon de temps.

Cadre d'analyse :
- Court terme (≤ 1 mois) : actions rapides à fort effet de levier (merchandising, réassort, prix, push d'un best-seller, correction d'un point de fuite conversion/retours).
- Moyen terme (1 à 3 mois) : optimisations structurantes (mix canal/marketplace, acquisition, campagnes, assortiment saison, pays/export).
- Long terme (3 à 12 mois) : orientations de fond (collection, positionnement, fidélisation, internationalisation, data).

Règles :
- Appuie CHAQUE recommandation sur un chiffre précis du reporting (cite la donnée).
- Priorise par impact business attendu. Sois concret et opérationnel, jamais générique.
- Tiens compte des spécificités mode : saisonnalité, nouveautés vs permanents, largeur d'offre, retours, omnicanal (EShop, boutiques, Galeries Lafayette, Printemps, Place des Tendances, Lulli).
- Si une donnée manque (ex. GA non chargé), signale-le brièvement plutôt que d'inventer.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, au format exact :
{
  "synthese": "2-3 phrases de diagnostic global",
  "court": [{ "titre": "...", "action": "...", "donnee": "...", "impact": "..." }],
  "moyen": [{ "titre": "...", "action": "...", "donnee": "...", "impact": "..." }],
  "long":  [{ "titre": "...", "action": "...", "donnee": "...", "impact": "..." }]
}
Entre 2 et 4 recommandations par horizon. Tout en français.`;

// ── Distillation du rapport en résumé compact ───────────────────────────────
const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const pct = v => (v == null ? '—' : (v * 100).toFixed(1) + '%');
const dl = (n, n1) => (n == null || n1 == null || n1 === 0) ? '' : ` (${((n - n1) / n1 * 100).toFixed(0)}% vs N-1)`;

function distill(rep) {
  const L = [];
  const m = rep.meta || {};
  L.push(`Période ${m.from}→${m.to} · dimension ${m.dim || 'global'}${m.scope === 'collection' ? ' · périmètre collection' : ''}${m.hasN1 ? ` · N-1 ${m.cf}→${m.ct}` : ' · pas de N-1'}.`);
  const k = rep.kpiEShop && rep.kpiEShop.n, k1 = (rep.kpiEShop && rep.kpiEShop.n1) || {};
  if (k) L.push(`KPI EShop : CA ${r0(k.ca)}€${dl(k.ca, k1.ca)}, commandes ${r0(k.commandes)}${dl(k.commandes, k1.commandes)}, panier moyen ${r0(k.pm)}€${dl(k.pm, k1.pm)}, sessions ${r0(k.sessions)}${dl(k.sessions, k1.sessions)}, taux de transfo ${pct(k.tt)}${dl(k.tt, k1.tt)}.`);
  const c = rep.ca && rep.ca.n;
  if (c) L.push(`CA : Global ${r0(c.caGlob)}€, France ${r0(c.caFR)}€, International ${r0(c.caInt)}€, Full Price ${r0(c.caFP)}€, Off Price ${r0(c.caOP)}€.`);
  if (rep.marketplace && rep.marketplace.n && rep.marketplace.n.total) {
    const mk = rep.marketplace.n;
    L.push(`Marketplace ${r0(mk.total)}€ : GL ${r0(mk.glTotal)}€, Printemps ${r0(mk.printemps)}€, PDT ${r0(mk.pdt)}€, Lulli ${r0(mk.lulli)}€.`);
  }
  if (rep.channels && rep.channels.n && rep.channels.n.length) {
    L.push('Canaux (sessions/conv/revenu) : ' + rep.channels.n.slice(0, 5).map(x => `${x.canal} ${r0(x.sessions)}/${pct(x.convRate)}/${r0(x.revenue)}€`).join(' ; ') + '.');
  }
  if (rep.gaFunnel && rep.gaFunnel.n) {
    const g = rep.gaFunnel.n;
    L.push(`Funnel : sessions ${r0(g.sessions)} → paniers ${r0(g.addToCarts)} → checkouts ${r0(g.checkouts)} → achats ${r0(g.purchases)} (conv. globale ${pct(g.overallConv)}).`);
  }
  if (rep.produits && rep.produits.topN && rep.produits.topN.length) {
    L.push('Top produits : ' + rep.produits.topN.slice(0, 5).map(p => `${p.des} (${r0(p.ca)}€)`).join(', ') + '.');
  }
  if (rep.produits && rep.produits.manquants && rep.produits.manquants.length) {
    L.push('Produits à reconquérir (forts N-1, en retrait) : ' + rep.produits.manquants.slice(0, 4).map(p => `${p.produit} (−${r0(p.perte)}€)`).join(', ') + '.');
  }
  if (rep.famille && rep.famille.length) {
    L.push('Familles : ' + rep.famille.slice(0, 6).map(f => `${f.fam} ${r0(f.n)}€${dl(f.n, f.n1)}`).join(' ; ') + '.');
  }
  if (rep.seasonCompare) {
    const s = rep.seasonCompare.counts;
    L.push(`Saison E26 vs E25 : ${r0(s.modN)} modèles (vs ${r0(s.modN1)}), ${r0(s.saisonniers)} saisonniers, ${r0(s.permanents)} permanents, ${r0(s.manquants)} sortis, ${r0(s.nonVendus)} non vendus.`);
    if (rep.seasonCompare.bests && rep.seasonCompare.bests.length) L.push('Bests saison : ' + rep.seasonCompare.bests.slice(0, 4).map(b => `${b.name} (${r0(b.ca)}€)`).join(', ') + '.');
  }
  if (rep.crossChannel && rep.crossChannel.totals) {
    L.push('Cross-canal CA : ' + rep.crossChannel.totals.map(t => `${t.channel} ${r0(t.ca)}€`).join(' ; ') + '.');
    if (rep.crossChannel.recos && rep.crossChannel.recos.length) L.push('Signaux cross-canal : ' + rep.crossChannel.recos.slice(0, 3).join(' ') );
  }
  if (rep.campaigns && rep.campaigns.length) {
    const weak = rep.campaigns.filter(x => x.sessions >= 100 && x.conv != null && x.conv < 0.005).slice(0, 3);
    if (weak.length) L.push('Campagnes à faible conversion : ' + weak.map(x => `${x.campaign} (${r0(x.sessions)} sess., ${pct(x.conv)})`).join(', ') + '.');
  }
  if (rep.pays && rep.pays.length) {
    L.push('Top pays : ' + rep.pays.slice(0, 6).map(p => `${p.pays} ${r0(p.n.ca)}€${p.n1 ? dl(p.n.ca, p.n1.ca) : ''}`).join(' ; ') + '.');
  }
  if (rep.returns && rep.returns.n) L.push(`Retours clients : ${r0(rep.returns.n.caRetourne)}€ (taux ${pct(rep.returns.tauxRetour)}).`);
  if (rep.cancellations && rep.cancellations.n) L.push(`Annulations EShop : ${r0(rep.cancellations.n.qteAnnulee)} pièces non expédiées (taux ${pct(rep.cancellations.n.tauxPieces)}).`);
  return L.join('\n');
}

// ── Appel Claude (fetch direct, retries 429/5xx) ────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function callClaude(context, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          // System stable → mis en cache (cache_control). Données volatiles dans le message user.
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: `Voici le reporting à analyser :\n\n${context}\n\nProduis les recommandations stratégiques au format JSON demandé.` }],
        }),
      });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Claude API ${res.status}`); if (i < tries) { await sleep(1200 * i); continue; } }
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Claude API ${res.status} : ${t.slice(0, 200)}`); }
      const j = await res.json();
      const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      return { text, usage: j.usage };
    } catch (e) { lastErr = e; if (i < tries) { await sleep(1200 * i); continue; } throw e; }
  }
  throw lastErr;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) { /* fallback */ }
  const m = text.match(/\{[\s\S]*\}/); // extrait le 1er bloc {...}
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* ignore */ } }
  return null;
}

// Cache mémoire court (évite de repayer un appel identique) — clé = hash du contexte
const CACHE = new Map();

router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured() }));

router.get('/', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'Moteur de recommandations non configuré (ANTHROPIC_API_KEY absent côté serveur).' });
  try {
    const { preset, from, to, dim, cfrom, cto, scope } = req.query;
    const isAll = req.query.isAll === '1';
    const rep = await buildReport({ preset, from, to, isAll, dim, cfrom, cto, scope });
    if (rep.empty) return res.status(400).json({ error: rep.message || 'Aucune donnée à analyser.' });
    const context = distill(rep);
    const key = crypto.createHash('sha1').update(MODEL + '|' + context).digest('hex');
    if (CACHE.has(key)) return res.json(CACHE.get(key));
    const { text } = await callClaude(context);
    const reco = parseJSON(text);
    const out = reco ? { reco } : { raw: text };
    CACHE.set(key, out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, isConfigured };
