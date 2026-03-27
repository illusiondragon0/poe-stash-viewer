// Firebase Cloud Function — wraps the Express app from server.js
// Deploy: firebase deploy --only functions

const { onRequest } = require('firebase-functions/v2/https');
const express        = require('express');
const fetch          = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const H_NINJA = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
const BASE_NINJA = 'https://poe.ninja';

// ── PoE API headers ────────────────────────────────────────────────────────
const POE_HEADERS = (sessid) => ({
  'Cookie': `POESESSID=${sessid}`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.pathofexile.com/account/view-profile',
  'Origin': 'https://www.pathofexile.com',
  'X-Requested-With': 'XMLHttpRequest',
});

// ── /api/tabs ──────────────────────────────────────────────────────────────
app.get('/api/tabs', async (req, res) => {
  const { accountName, league, sessid } = req.query;
  if (!accountName || !sessid) return res.status(400).json({ error: 'missing params' });
  const url = `https://www.pathofexile.com/character-window/get-stash-items`
    + `?accountName=${encodeURIComponent(accountName)}`
    + `&league=${encodeURIComponent(league || 'Mirage')}&tabIndex=0&tabs=1`;
  try {
    const r    = await fetch(url, { headers: POE_HEADERS(sessid) });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `PoE API: ${r.status}`, body: text });
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /api/stash ─────────────────────────────────────────────────────────────
app.get('/api/stash', async (req, res) => {
  const { accountName, league, tabIndex, sessid } = req.query;
  if (!accountName || !sessid) return res.status(400).json({ error: 'missing params' });
  const url = `https://www.pathofexile.com/character-window/get-stash-items`
    + `?accountName=${encodeURIComponent(accountName)}`
    + `&league=${encodeURIComponent(league || 'Mirage')}`
    + `&tabIndex=${tabIndex || 0}&tabs=0`;
  try {
    const r    = await fetch(url, { headers: POE_HEADERS(sessid) });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `PoE API: ${r.status}`, body: text });
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /api/ninja-prices ─────────────────────────────────────────────────────
app.get('/api/ninja-prices', async (req, res) => {
  const lg = req.query.league || 'Mirage';

  // ── helpers ──────────────────────────────────────────────────────────────
  function nameToSlug(name) {
    return name.toLowerCase()
      .replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  const SMALL = new Set(['of','the','and','in','a','an','to','for','with','on','at','from','by','or']);
  function slugToName(slug) {
    return slug.split('-').map((w, i) =>
      (i === 0 || !SMALL.has(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w
    ).join(' ');
  }

  const priceMap    = {};
  const stashItemMap = {};
  const stashNameMap = {};
  const clusterMap   = {};

  // ── Currency / Fragment ───────────────────────────────────────────────────
  async function fetchCurrencyType(type) {
    try {
      const [exRes, ovRes] = await Promise.all([
        fetch(`${BASE_NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H_NINJA }),
        fetch(`${BASE_NINJA}/api/data/currencyoverview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H_NINJA }),
      ]);
      const exData = exRes.ok ? await exRes.json() : { lines: [] };
      const ovData = ovRes.ok ? await ovRes.json() : { lines: [], currencyDetails: [] };

      const exById = {};
      (exData.lines || []).forEach(l => { if (l.id) exById[l.id] = l.primaryValue; });

      const iconByName = {};
      (ovData.currencyDetails || []).forEach(d => {
        if (d.name) iconByName[d.name.toLowerCase()] = d.icon;
        if (d.detailsId) iconByName[d.detailsId] = d.icon;
      });

      (ovData.lines || []).forEach(line => {
        const name = line.currencyTypeName;
        if (!name) return;
        const key = name.toLowerCase();
        const detailsId = line.detailsId || '';
        const slug = nameToSlug(name);
        const candidates = [
          detailsId, slug,
          detailsId.replace(/-orb$/, ''), detailsId.replace(/-scroll$/, ''),
          detailsId.split('-').filter(w => !['of','the','and','scroll'].includes(w)).join('-'),
        ].filter(Boolean);
        let exPrice = null;
        for (const c of candidates) { if (exById[c] != null) { exPrice = exById[c]; break; } }
        const chaosValue = exPrice ?? line.chaosEquivalent;
        if (!chaosValue || chaosValue <= 0) return;
        priceMap[key] = { chaosValue, icon: iconByName[key] || iconByName[detailsId] || null, source: exPrice != null ? `ex-${type}` : `ov-${type}`, detailsId };
      });

      if (!priceMap['chaos orb']) priceMap['chaos orb'] = { chaosValue: 1, icon: iconByName['chaos orb'] || null, source: 'hardcoded', detailsId: 'chaos-orb' };

      const mappedSlugs = new Set();
      (ovData.lines || []).forEach(l => { mappedSlugs.add(l.detailsId || ''); mappedSlugs.add(nameToSlug(l.currencyTypeName || '')); });
      (exData.lines || []).forEach(l => {
        if (!l.id || l.primaryValue == null || mappedSlugs.has(l.id)) return;
        const key = slugToName(l.id).toLowerCase();
        if (!priceMap[key]) priceMap[key] = { chaosValue: l.primaryValue, icon: iconByName[l.id] || null, source: `ex-extra-${type}`, detailsId: l.id };
      });
    } catch (e) { console.warn('[currency]', type, e.message); }
  }

  // ── Item types with exchange ──────────────────────────────────────────────
  async function fetchItemType(type) {
    try {
      const [exRes, itemRes] = await Promise.all([
        fetch(`${BASE_NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H_NINJA }),
        fetch(`${BASE_NINJA}/api/data/itemoverview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H_NINJA }),
      ]);
      const exData   = exRes.ok   ? await exRes.json()   : { lines: [] };
      const itemData = itemRes.ok ? await itemRes.json() : { lines: [] };

      const exById = {};
      (exData.lines || []).forEach(l => { if (l.id) exById[l.id] = l.primaryValue; });

      const byDetailsId = {};
      const bySlug = {};
      (itemData.lines || []).forEach(line => {
        if (line.detailsId) byDetailsId[line.detailsId] = line;
        if (line.name) bySlug[nameToSlug(line.name)] = line;
      });

      (exData.lines || []).forEach(line => {
        if (!line.id || line.primaryValue == null) return;
        const item = byDetailsId[line.id] || bySlug[line.id] || bySlug[nameToSlug(slugToName(line.id))];
        if (!item) return;
        priceMap[item.name.toLowerCase()] = { chaosValue: line.primaryValue, icon: item.icon || null, source: `ex-${type}`, detailsId: line.id };
      });

      (itemData.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue) return;
        const key = line.name.toLowerCase();
        if (!priceMap[key]) priceMap[key] = { chaosValue: line.chaosValue, icon: line.icon || null, source: `ov-${type}` };
      });

      (exData.lines || []).forEach(l => {
        if (!l.id || l.primaryValue == null) return;
        if (byDetailsId[l.id] || bySlug[l.id]) return;
        const key = slugToName(l.id).toLowerCase();
        if (!priceMap[key]) priceMap[key] = { chaosValue: l.primaryValue, icon: null, source: `ex-slug-${type}` };
      });
    } catch (e) { console.warn('[item]', type, e.message); }
  }

  // ── Item-only types ───────────────────────────────────────────────────────
  async function fetchItemOnly(type) {
    try {
      const r = await fetch(`${BASE_NINJA}/api/data/itemoverview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H_NINJA });
      if (!r.ok) return;
      const data = await r.json();
      (data.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue) return;
        const key = line.name.toLowerCase();
        if (!priceMap[key]) priceMap[key] = { chaosValue: line.chaosValue, icon: line.icon || null, source: type };
      });
    } catch (e) { console.warn('[item-only]', type, e.message); }
  }

  // ── Stash item overview (Unique / Gem / variants) ─────────────────────────
  async function fetchStashItemType(type) {
    try {
      const r = await fetch(`${BASE_NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H_NINJA });
      if (!r.ok) return;
      const data = await r.json();
      (data.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue) return;
        const entry = {
          chaosValue: line.chaosValue, icon: line.icon || null,
          name: line.name, baseType: line.baseType || '',
          variant: line.variant || '', links: line.links || 0,
          levelRequired: line.levelRequired || 0, detailsId: line.detailsId || '',
          source: `stash-${type}`,
          isFoulborn: (line.name || '').startsWith('Foulborn '),
          mutatedMods: (line.mutatedModifiers || []).map(m => m.text),
        };
        if (entry.detailsId) stashItemMap[entry.detailsId] = entry;
        const k = line.name.toLowerCase();
        if (!stashNameMap[k]) stashNameMap[k] = [];
        stashNameMap[k].push(entry);
      });
      Object.keys(stashNameMap).forEach(k => stashNameMap[k].sort((a, b) => b.chaosValue - a.chaosValue));
    } catch (e) { console.warn('[stash]', type, e.message); }
  }

  // ── Cluster Jewels ────────────────────────────────────────────────────────
  async function fetchClusterJewels() {
    try {
      const r = await fetch(`${BASE_NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(lg)}&type=ClusterJewel`, { headers: H_NINJA });
      if (!r.ok) return;
      const data = await r.json();
      (data.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue || !line.detailsId) return;
        const passives = parseInt((line.variant || '').replace(/\D/g, '')) || 0;
        clusterMap[line.detailsId] = {
          chaosValue: line.chaosValue, icon: line.icon || null,
          name: line.name, baseType: line.baseType || '',
          variant: line.variant || '', passives,
          levelRequired: line.levelRequired || 0, detailsId: line.detailsId,
          source: 'stash-ClusterJewel',
        };
      });
    } catch (e) { console.warn('[ClusterJewel]', e.message); }
  }

  // ── Run all fetches ───────────────────────────────────────────────────────
  await Promise.all([fetchCurrencyType('Currency'), fetchCurrencyType('Fragment')]);

  await Promise.all([
    'Scarab','Oil','Essence','DeliriumOrb','DivinationCard',
    'Artifact','Fossil','Resonator','Tattoo','Omen',
    'AllflameEmber','Runegraft','DjinnCoin','Astrolabe',
  ].map(fetchItemType));

  await Promise.all([
    fetchStashItemType('UniqueWeapon'), fetchStashItemType('UniqueArmour'),
    fetchStashItemType('UniqueAccessory'), fetchStashItemType('UniqueFlask'),
    fetchStashItemType('UniqueJewel'), fetchStashItemType('ForbiddenJewel'),
    fetchStashItemType('ShrineBelt'), fetchStashItemType('UniqueTincture'),
    fetchStashItemType('UniqueRelic'), fetchStashItemType('SkillGem'),
    fetchClusterJewels(),
  ]);

  await Promise.all(['Map','UniqueMap','Invitation','Vial','Incubator','Beast'].map(fetchItemOnly));

  const divinePrice = priceMap['divine orb']?.chaosValue || 1;

  res.json({ prices: priceMap, stashItems: stashItemMap, stashNames: stashNameMap, clusterMap, divinePrice });
});

// Export as Firebase Function (v2)
exports.api = onRequest({ region: 'asia-southeast1', timeoutSeconds: 120, memory: '512MiB' }, app);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on port ${PORT}`));
