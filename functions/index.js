// PoE Stash API Server — runs on Render.com
const express = require('express');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const H     = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
const NINJA = 'https://poe.ninja';

// ── PoE API proxy headers ─────────────────────────────────────────────────
const POE_HEADERS = (sessid) => ({
  'Cookie': `POESESSID=${sessid}`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.pathofexile.com/account/view-profile',
  'Origin': 'https://www.pathofexile.com',
  'X-Requested-With': 'XMLHttpRequest',
});

// ── /api/tabs ─────────────────────────────────────────────────────────────
app.get('/api/tabs', async (req, res) => {
  const { accountName, league, sessid } = req.query;
  if (!accountName || !sessid) return res.status(400).json({ error: 'missing params' });
  const url = `https://www.pathofexile.com/character-window/get-stash-items`
    + `?accountName=${encodeURIComponent(accountName)}`
    + `&league=${encodeURIComponent(league || 'Allflame')}&tabIndex=0&tabs=1`;
  try {
    const r = await fetch(url, { headers: POE_HEADERS(sessid) });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `PoE API: ${r.status}`, body: text });
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /api/stash ────────────────────────────────────────────────────────────
app.get('/api/stash', async (req, res) => {
  const { accountName, league, tabIndex, tabType, tabId, sessid } = req.query;
  if (!accountName || !sessid) return res.status(400).json({ error: 'missing params' });

  const TYPE_TABS = new Set([
    'MapStash','GemStash','DivinationCardStash','EssenceStash','FragmentStash',
    'DelveStash','BlightStash','UltimatumStash','DeliriumStash',
    'UniqueStash','FlaskStash','MetamorphStash','HeistStash','CurrencyStash',
    'SocketableStash','RitualStash',
  ]);

  const base = `https://www.pathofexile.com/character-window/get-stash-items`
    + `?accountName=${encodeURIComponent(accountName)}`
    + `&league=${encodeURIComponent(league || 'Allflame')}&tabs=0`;

  const typeParam = (tabType && TYPE_TABS.has(tabType)) ? `&type=${encodeURIComponent(tabType)}` : '';

  // สร้าง URL หลายแบบ เรียงลำดับที่จะลอง
  const urls = [];
  if (tabType === 'MapStash' && tabId) {
    // MapStash: ลองทุก parameter combination
    urls.push(base + `&tabIndex=${tabIndex || 0}` + typeParam);
    urls.push(base + `&id=${encodeURIComponent(tabId)}` + typeParam);
    urls.push(base + `&tabIndex=${tabIndex || 0}`); // ไม่มี type
    urls.push(base + `&id=${encodeURIComponent(tabId)}`); // ไม่มี type
  } else {
    urls.push(base + `&tabIndex=${tabIndex || 0}` + typeParam);
  }

  let lastErr = '';
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: POE_HEADERS(sessid) });
      const text = await r.text();
      console.log('[stash]', tabType||'normal', 'tabIndex:', tabIndex, 'status:', r.status, '\nURL:', url, '\nbody:', text.slice(0,200));
      if (r.ok) {
        // MapStash: items อาจอยู่ใน mapLayout แทน items array
        // inject items จาก mapLayout ถ้า items ว่าง
        try {
          const parsed = JSON.parse(text);
          if(tabType === 'MapStash' && (!parsed.items || !parsed.items.length) && parsed.mapLayout) {
            const mapItems = Object.values(parsed.mapLayout).flatMap(tier =>
              Array.isArray(tier) ? tier : (tier.items || [])
            );
            if(mapItems.length) {
              parsed.items = mapItems;
              res.setHeader('Content-Type', 'application/json');
              return res.json(parsed);
            }
          }
        } catch(e2) {}
        res.setHeader('Content-Type', 'application/json');
        return res.send(text);
      }
      lastErr = text;
      if (r.status !== 404) break;
    } catch (e) { lastErr = e.message; break; }
  }
  res.status(404).json({ error: 'PoE API: 404', body: lastErr });
});

// ── /api/ninja-prices ─────────────────────────────────────────────────────
app.get('/api/ninja-prices', async (req, res) => {
  const lg = req.query.league || 'Allflame';

  function nameToSlug(name) {
    return name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  const SMALL = new Set(['of','the','and','in','a','an','to','for','with','on','at','from','by','or']);
  function slugToName(slug) {
    return slug.split('-').map((w, i) =>
      (i === 0 || !SMALL.has(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w
    ).join(' ');
  }

  // ── Exchange details API: ดึงราคาตรงๆ จาก details endpoint ──────────────
  // GET /poe1/api/economy/exchange/current/details?league=X&type=Y&id=Z
  // → pairs[{id:"chaos", rate: N}]  (N chaos ต่อ 1 item)
  async function fetchExDetails(type, detailsId) {
    try {
      const r = await fetch(
        `${NINJA}/poe1/api/economy/exchange/current/details?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}&id=${encodeURIComponent(detailsId)}`,
        { headers: H }
      );
      if (!r.ok) return null;
      const data = await r.json();
      const chaosPair = (data.pairs || []).find(p => p.id === 'chaos');
      if (!chaosPair) return null;
      return {
        chaosValue: chaosPair.rate,
        icon: data.item?.image ? `https://web.poecdn.com${data.item.image}` : null,
        name: data.item?.name || slugToName(detailsId),
        detailsId,
      };
    } catch { return null; }
  }

  const priceMap     = {};
  const stashItemMap = {};
  const stashNameMap = {};
  const clusterMap   = {};

  // ── STEP 1: Exchange types (Currency, Fragment, Oil, Tattoo ...) ──────────────────────────────────────────
  // exchange overview: lines[] = ราคา (id, primaryValue), items[] = ชื่อ/รูป (id, name, image)
  async function fetchCurrencyType(type) {
    try {
      const r = await fetch(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H });
      if (!r.ok) { console.warn('[currency]', type, r.status); return; }
      const data = await r.json();
      const byId = {};
      (data.items || []).forEach(i => { byId[i.id] = i; });
      (data.lines || []).forEach(l => {
        const it = byId[l.id];
        if (!it || !it.name || l.primaryValue == null) return;
        const entry = {
          chaosValue: l.primaryValue,
          icon: it.image ? `https://web.poecdn.com${it.image}` : null,
          source: `ex-${type}`,
          detailsId: it.detailsId || l.id,
        };
        const key = it.name.toLowerCase();
        priceMap[key] = entry;
        priceMap[key.replace(/'/g, '')] = entry;
        priceMap[l.id.replace(/-/g, ' ')] = entry;
      });
      if (!priceMap['chaos orb']) {
        priceMap['chaos orb'] = { chaosValue: 1, icon: null, source: 'hardcoded', detailsId: 'chaos-orb' };
      }
      console.log(`[${type}] lines=${(data.lines || []).length}`);
    } catch (e) { console.warn('[currency]', type, e.message); }
  }

  // ── STEP 3: Item-only (no exchange) ──────────────────────────────────────
  async function fetchItemOnly(type) {
    try {
      const r = await fetch(`${NINJA}/api/data/itemoverview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H });
      if (!r.ok) return;
      const data = await r.json();
      (data.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue) return;
        const key = line.name.toLowerCase();
        if (!priceMap[key]) priceMap[key] = { chaosValue: line.chaosValue, icon: line.icon || null, source: type };
      });
    } catch (e) { console.warn('[item-only]', type, e.message); }
  }

  // ── STEP 4: Stash item overview (Unique / Gem / variants) ─────────────────
  async function fetchStashItemType(type) {
    try {
      const r = await fetch(`${NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H });
      if (!r.ok) return;
      const data = await r.json();
      (data.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue) return;
        const entry = {
          chaosValue:   line.chaosValue,
          icon:         line.icon || null,
          name:         line.name,
          baseType:     line.baseType || '',
          variant:      line.variant  || '',
          links:        line.links    || 0,
          levelRequired: line.levelRequired || 0,
          detailsId:    line.detailsId || '',
          source:       `stash-${type}`,
          isFoulborn:   (line.name || '').startsWith('Foulborn '),
          mutatedMods:  (line.mutatedModifiers || []).map(m => m.text),
          corrupted:    line.corrupted  === true,
          gemLevel:     line.gemLevel   != null ? line.gemLevel   : null,
          gemQuality:   line.gemQuality != null ? line.gemQuality : null,
        };
        if (entry.detailsId) stashItemMap[entry.detailsId] = entry;
        const k = line.name.toLowerCase();
        if (!stashNameMap[k]) stashNameMap[k] = [];
        stashNameMap[k].push(entry);
      });
      Object.keys(stashNameMap).forEach(k =>
        stashNameMap[k].sort((a, b) => b.chaosValue - a.chaosValue)
      );
      console.log(`[stash-${type}] ${(data.lines||[]).length} variants`);
    } catch (e) { console.warn('[stash]', type, e.message); }
  }

  // ── STEP 5: Cluster Jewels ────────────────────────────────────────────────
  async function fetchClusterJewels() {
    try {
      const r = await fetch(`${NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(lg)}&type=ClusterJewel`, { headers: H });
      if (!r.ok) return;
      const data = await r.json();
      (data.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue || !line.detailsId) return;
        const passives = parseInt((line.variant || '').replace(/\D/g, '')) || 0;
        clusterMap[line.detailsId] = {
          chaosValue:    line.chaosValue,
          icon:          line.icon || null,
          name:          line.name,
          baseType:      line.baseType || '',
          variant:       line.variant  || '',
          passives,
          levelRequired: line.levelRequired || 0,
          detailsId:     line.detailsId,
          source:        'stash-ClusterJewel',
        };
      });
      console.log(`[ClusterJewel] ${Object.keys(clusterMap).length} variants`);
    } catch (e) { console.warn('[ClusterJewel]', e.message); }
  }

  // ── RUN ───────────────────────────────────────────────────────────────────
  console.log(`\n[prices] loading: ${lg}`);

  // ทุกประเภทที่มีใน exchange overview ใช้ฟังก์ชันเดียวกัน
  await Promise.all([
    'Currency','Fragment','Oil','Essence','DeliriumOrb','DivinationCard',
    'Artifact','Fossil','Resonator','Omen','AllflameEmber','Runegraft','DjinnCoin',
    'Tattoo','Astrolabe',
  ].map(fetchCurrencyType));

  await Promise.all([
    fetchStashItemType('UniqueWeapon'),
    fetchStashItemType('UniqueArmour'),
    fetchStashItemType('UniqueAccessory'),
    fetchStashItemType('UniqueFlask'),
    fetchStashItemType('UniqueJewel'),
    fetchStashItemType('ForbiddenJewel'),
    fetchStashItemType('ShrineBelt'),
    fetchStashItemType('UniqueTincture'),
    fetchStashItemType('UniqueRelic'),
    fetchStashItemType('SkillGem'),
    fetchStashItemType('BlightedMap'),
    fetchStashItemType('BlightRavagedMap'),
    fetchStashItemType('Map'),
    fetchStashItemType('UniqueMap'),
    fetchStashItemType('ValdoMap'),
    fetchClusterJewels(),
  ]);

  await Promise.all([
    'Map','Invitation','Vial','Incubator','Beast',
  ].map(fetchItemOnly));

  // Hardcoded scarabs ที่ id ไม่ตรงกับ name → fetch details โดยตรง
  const HARDCODED_SCARABS = [
    { id: 'betrayal-scarab-of-unbreaking',       name: 'Betrayal Scarab of Unbreaking' },
    { id: 'breach-scarab-of-the-hive',           name: 'Breach Scarab of the Hive' },
    { id: 'expedition-scarab-of-infusion',       name: 'Expedition Scarab of Infusion' },
    { id: 'legion-scarab-of-treasures',          name: 'Legion Scarab of Treasures' },
    { id: 'breach-scarab-of-the-marshal',        name: 'Breach Scarab of the Marshal' },
    { id: 'abyss-scarab-of-descending',          name: 'Abyss Scarab of Descending' },
    { id: 'influencing-scarab-of-interference',  name: 'Influencing Scarab of Interference' },
  ];
  await Promise.all(HARDCODED_SCARABS.map(async ({ id, name }) => {
    try {
      const r = await fetch(
        `${NINJA}/poe1/api/economy/exchange/current/details?league=${encodeURIComponent(lg)}&type=Scarab&id=${encodeURIComponent(id)}`,
        { headers: H }
      );
      if (!r.ok) return;
      const d    = await r.json();
      const rate = (d.pairs||[]).find(p => p.id === 'chaos')?.rate;
      if (!rate) return;
      const icon  = d.item?.image ? `https://web.poecdn.com${d.item.image}` : null;
      const key   = name.toLowerCase();
      const entry = { chaosValue: rate, icon, source: 'ex-Scarab-hardcoded', detailsId: id };
      priceMap[key]               = entry;
      priceMap[key.replace(/'/g,'')] = entry;
    } catch(e2) { console.warn('[scarab-hardcoded]', id, e2.message); }
  }));
  console.log('[scarab-hardcoded] done');

  const divinePrice = priceMap['divine orb']?.chaosValue || 1;

  // ดึงราคา Mirror of Kalandra เป็น divine จาก exchange details
  let mirrorDivine = null;
  try {
    const mr = await fetch(
      `${NINJA}/poe1/api/economy/exchange/current/details?league=${encodeURIComponent(lg)}&type=Currency&id=mirror-of-kalandra`,
      { headers: H }
    );
    if(mr.ok){
      const md = await mr.json();
      const divPair = (md.pairs||[]).find(p => p.id === 'divine');
      if(divPair && divPair.rate) mirrorDivine = divPair.rate;
    }
  } catch(e) { console.warn('[mirror]', e.message); }

  console.log(`[prices] done: ${Object.keys(priceMap).length} items, ${Object.keys(stashItemMap).length} variants, 1d=${divinePrice.toFixed(1)}c, mirror=${mirrorDivine}d`);

  res.json({
    prices:     priceMap,
    stashItems: stashItemMap,
    stashNames: stashNameMap,
    clusterMap,
    divinePrice,
    mirrorDivine,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ready on port ${PORT}`));

// ── /api/scarab-prices ────────────────────────────────────────────────────
// endpoint แยก เพื่อไม่บล็อก ninja-prices (Scarab มี 300+ ตัว ต้อง fetch details ทุกตัว)
app.get('/api/scarab-prices', async (req, res) => {
  const lg = req.query.league || 'Allflame';
  const H2 = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
  const result = {};

  function slugToName2(slug) {
    const SMALL = new Set(['of','the','and','in','a','an','to','for','with','on','at','from','by','or']);
    return slug.split('-').map((w,i) =>
      (i===0||!SMALL.has(w)) ? w.charAt(0).toUpperCase()+w.slice(1) : w
    ).join(' ');
  }

  try {
    const exRes = await fetch(
      `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(lg)}&type=Scarab`,
      { headers: H2 }
    );
    if(!exRes.ok) return res.json(result);
    const exData = await exRes.json();
    const lines  = (exData.lines||[]).filter(l => l.id);
    console.log(`[scarab-prices] fetching ${lines.length} details...`);

    for(let i = 0; i < lines.length; i += 20){
      const batch = lines.slice(i, i+20);
      await Promise.all(batch.map(async l => {
        try {
          const dr = await fetch(
            `https://poe.ninja/poe1/api/economy/exchange/current/details?league=${encodeURIComponent(lg)}&type=Scarab&id=${encodeURIComponent(l.id)}`,
            { headers: H2 }
          );
          if(!dr.ok) return;
          const dd   = await dr.json();
          const rate = (dd.pairs||[]).find(p => p.id==='chaos')?.rate;
          if(rate == null) return;
          const name    = dd.item?.name || slugToName2(l.id);
          const icon    = dd.item?.image ? `https://web.poecdn.com${dd.item.image}` : null;
          const key     = name.toLowerCase();
          result[key]                        = { chaosValue: rate, icon, detailsId: l.id };
          result[key.replace(/'/g,'')]       = result[key];
          result[l.id.replace(/-/g,' ')]     = result[key];
          result[slugToName2(l.id).toLowerCase()] = result[key];
        } catch(e2){}
      }));
    }
    console.log(`[scarab-prices] done ${Object.keys(result).length} entries`);
  } catch(e) { console.error('[scarab-prices]', e.message); }

  res.json(result);
});

// ── debug: ดู raw item data ────────────────────────────────────────────────
// GET /api/debug-item?accountName=X&league=Y&tabIndex=Z&sessid=S&search=ultimatum
app.get('/api/debug-item', async (req, res) => {
  const { accountName, league, tabIndex, sessid, search } = req.query;
  if (!accountName || !sessid) return res.status(400).json({ error: 'missing params' });
  const url = `https://www.pathofexile.com/character-window/get-stash-items`
    + `?accountName=${encodeURIComponent(accountName)}`
    + `&league=${encodeURIComponent(league || 'Allflame')}`
    + `&tabIndex=${tabIndex || 0}&tabs=0`;
  try {
    const r    = await fetch(url, { headers: POE_HEADERS(sessid) });
    const data = await r.json();
    const items = (data.items || []).filter(it =>
      !search || JSON.stringify(it).toLowerCase().includes(search.toLowerCase())
    ).slice(0, 3); // แค่ 3 ชิ้นแรก
    res.json({ count: (data.items||[]).length, sample: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// static-icons: removed, using hardcoded STASH_ICONS in client

