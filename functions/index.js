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
    + `&league=${encodeURIComponent(league || 'Mirage')}&tabIndex=0&tabs=1`;
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
    + `&league=${encodeURIComponent(league || 'Mirage')}&tabs=0`;

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
  const lg = req.query.league || 'Mirage';

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

  // ── STEP 1: Currency & Fragment ──────────────────────────────────────────
  // Strategy: overview ให้รายชื่อ + detailsId
  //           exchange overview ให้ primaryValue (แต่ id อาจไม่ตรง)
  //           exchange details ให้ rate ตรงๆ ถ้า match id ได้
  async function fetchCurrencyType(type) {
    try {
      const [exRes, ovRes] = await Promise.all([
        fetch(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H }),
        fetch(`${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H }),
      ]);
      const exData = exRes.ok ? await exRes.json() : { lines: [] };
      const ovData = ovRes.ok ? await ovRes.json() : { lines: [], currencyDetails: [] };

      // exchange overview: id → primaryValue
      const exById = {};
      (exData.lines || []).forEach(l => { if (l.id) exById[l.id] = l.primaryValue; });

      // icon map
      const iconByName = {};
      (ovData.currencyDetails || []).forEach(d => {
        if (d.name) iconByName[d.name.toLowerCase()] = d.icon;
        if (d.detailsId) iconByName[d.detailsId] = d.icon;
      });

      // items ที่ไม่มีราคาใน exchange overview → เก็บ detailsId ไว้ fetch details ทีหลัง
      const needDetails = [];

      (ovData.lines || []).forEach(line => {
        const name = line.currencyTypeName;
        if (!name) return;
        const key        = name.toLowerCase();
        const detailsId  = line.detailsId || '';
        const slug       = nameToSlug(name);

        // Exchange-first: ลอง match id หลายรูปแบบ
        const candidates = [
          detailsId, slug,
          detailsId.replace(/-orb$/, ''),
          detailsId.replace(/-scroll$/, ''),
          detailsId.split('-').filter(w => !['of','the','and','scroll'].includes(w)).join('-'),
        ].filter(Boolean);

        let exPrice = null;
        for (const c of candidates) {
          if (exById[c] != null) { exPrice = exById[c]; break; }
        }

        if (exPrice != null) {
          // มีราคาจาก exchange overview → ใช้เลย
          const entryEx = {
            chaosValue: exPrice,
            icon: iconByName[key] || iconByName[detailsId] || null,
            source: `ex-${type}`,
            detailsId,
          };
          priceMap[key] = entryEx;
          priceMap[key.replace(/'/g, '')] = entryEx; // key ไม่มี apostrophe
        } else if (line.chaosEquivalent && line.chaosEquivalent > 0) {
          // fallback chaosEquivalent แต่ mark ว่าอาจไม่แม่น
          const entryOv = {
            chaosValue: line.chaosEquivalent,
            icon: iconByName[key] || iconByName[detailsId] || null,
            source: `ov-${type}`,
            detailsId,
          };
          priceMap[key] = entryOv;
          priceMap[key.replace(/'/g, '')] = entryOv;
          // ลองดึง details เพื่อ override ด้วยราคาที่แม่นกว่า
          if (detailsId) needDetails.push({ key, detailsId, type, iconFallback: iconByName[key] || iconByName[detailsId] || null });
        } else {
          // ไม่มีเลย → ลอง details
          if (detailsId) needDetails.push({ key, detailsId, type, iconFallback: iconByName[key] || iconByName[detailsId] || null });
        }
      });

      // เพิ่ม exchange items ที่ไม่มีใน overview (slugToName + fetch details เพื่อได้ชื่อจริง)
      const mappedSlugs = new Set();
      (ovData.lines || []).forEach(l => {
        mappedSlugs.add(l.detailsId || '');
        mappedSlugs.add(nameToSlug(l.currencyTypeName || ''));
      });
      const extraItems = [];
      (exData.lines || []).forEach(l => {
        if (!l.id || l.primaryValue == null || mappedSlugs.has(l.id)) return;
        extraItems.push(l);
      });
      // fetch details เพื่อได้ชื่อจริงพร้อม apostrophe
      for (let i = 0; i < extraItems.length; i += 5) {
        const batch = extraItems.slice(i, i + 5);
        await Promise.all(batch.map(async (l) => {
          const d = await fetchExDetails(type, l.id);
          const realName = d?.name || slugToName(l.id);
          const key = realName.toLowerCase();
          // เก็บทั้ง key จริงและ key ไม่มี apostrophe
          const keyNoApos = key.replace(/'/g, '');
          const entry = {
            chaosValue: d?.chaosValue || l.primaryValue,
            icon: d?.icon || iconByName[l.id] || null,
            source: d ? `details-extra-${type}` : `ex-extra-${type}`,
            detailsId: l.id,
          };
          if (!priceMap[key]) priceMap[key] = entry;
          if (!priceMap[keyNoApos]) priceMap[keyNoApos] = entry;
        }));
      }

      // Chaos Orb hardcode
      if (!priceMap['chaos orb']) {
        priceMap['chaos orb'] = { chaosValue: 1, icon: iconByName['chaos orb'] || null, source: 'hardcoded', detailsId: 'chaos-orb' };
      }

      // Fetch details สำหรับ items ที่ miss หรือใช้ chaosEquivalent
      // Rate limit: ไม่เกิน 5 parallel
      for (let i = 0; i < needDetails.length; i += 5) {
        const batch = needDetails.slice(i, i + 5);
        await Promise.all(batch.map(async ({ key, detailsId, type, iconFallback }) => {
          const d = await fetchExDetails(type, detailsId);
          if (d && d.chaosValue > 0) {
            priceMap[key] = {
              chaosValue: d.chaosValue,
              icon: d.icon || iconFallback,
              source: `details-${type}`,
              detailsId,
            };
          }
        }));
      }

      console.log(`[${type}] ex=${Object.keys(exById).length} ov=${(ovData.lines||[]).length} details=${needDetails.length}`);
    } catch (e) { console.warn('[currency]', type, e.message); }
  }

  // ── STEP 2: Item types (Scarab, Oil etc.) ─────────────────────────────────
  async function fetchItemType(type) {
    try {
      const [exRes, itemRes] = await Promise.all([
        fetch(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H }),
        fetch(`${NINJA}/api/data/itemoverview?league=${encodeURIComponent(lg)}&type=${encodeURIComponent(type)}`, { headers: H }),
      ]);
      const exData   = exRes.ok   ? await exRes.json()   : { lines: [] };
      const itemData = itemRes.ok ? await itemRes.json() : { lines: [] };

      const exById = {};
      (exData.lines || []).forEach(l => { if (l.id) exById[l.id] = l.primaryValue; });

      const byDetailsId = {};
      const bySlug      = {};
      (itemData.lines || []).forEach(line => {
        if (line.detailsId) byDetailsId[line.detailsId] = line;
        if (line.name) bySlug[nameToSlug(line.name)] = line;
      });

      // Exchange-first
      (exData.lines || []).forEach(line => {
        if (!line.id || line.primaryValue == null) return;
        const item = byDetailsId[line.id] || bySlug[line.id] || bySlug[nameToSlug(slugToName(line.id))];
        if (!item) return;
        priceMap[item.name.toLowerCase()] = {
          chaosValue: line.primaryValue,
          icon: item.icon || null,
          source: `ex-${type}`,
          detailsId: line.id,
        };
      });

      // Fallback: overview items ที่ไม่มีใน exchange
      (itemData.lines || []).forEach(line => {
        if (!line.name || !line.chaosValue) return;
        const key = line.name.toLowerCase();
        if (!priceMap[key]) priceMap[key] = { chaosValue: line.chaosValue, icon: line.icon || null, source: `ov-${type}` };
      });

      // Exchange items ที่ map ไม่ได้ → slugToName
      (exData.lines || []).forEach(l => {
        if (!l.id || l.primaryValue == null) return;
        if (byDetailsId[l.id] || bySlug[l.id]) return;
        const key = slugToName(l.id).toLowerCase();
        if (!priceMap[key]) priceMap[key] = { chaosValue: l.primaryValue, icon: null, source: `ex-slug-${type}` };
      });

      console.log(`[${type}] ex=${Object.keys(exById).length} items=${(itemData.lines||[]).length}`);
    } catch (e) { console.warn('[item]', type, e.message); }
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

  await Promise.all([
    fetchCurrencyType('Currency'),
    fetchCurrencyType('Fragment'),
  ]);

  await Promise.all([
    'Scarab','Oil','Essence','DeliriumOrb','DivinationCard',
    'Artifact','Fossil','Resonator','Omen',
    'AllflameEmber','Runegraft','DjinnCoin','Astrolabe',
  ].map(fetchItemType));

  // Tattoo: ใช้ exchange overview โดยตรง (id = slug, primaryValue = chaos rate)
  await (async () => {
    try {
      const [exRes, itemRes] = await Promise.all([
        fetch(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(lg)}&type=Tattoo`, { headers: H }),
        fetch(`${NINJA}/api/data/itemoverview?league=${encodeURIComponent(lg)}&type=Tattoo`, { headers: H }),
      ]);
      const exData   = exRes.ok   ? await exRes.json()   : { lines: [] };
      const itemData = itemRes.ok ? await itemRes.json() : { lines: [] };

      // build icon map from itemoverview
      const iconBySlug = {};
      const iconByName = {};
      (itemData.lines || []).forEach(line => {
        if (line.name) {
          iconByName[line.name.toLowerCase()] = line.icon;
          iconBySlug[nameToSlug(line.name)]   = line.icon;
          // เก็บราคา fallback จาก itemoverview ด้วย
          if (!priceMap[line.name.toLowerCase()] && line.chaosValue) {
            priceMap[line.name.toLowerCase()] = { chaosValue: line.chaosValue, icon: line.icon||null, source: 'ov-Tattoo' };
          }
        }
      });

      // exchange-first: id → primaryValue, convert slug → real name
      (exData.lines || []).forEach(l => {
        if (!l.id || l.primaryValue == null) return;
        const realName = slugToName(l.id);
        const key      = realName.toLowerCase();
        const icon     = iconBySlug[l.id] || iconByName[key] || null;
        // override ด้วย exchange price
        priceMap[key]             = { chaosValue: l.primaryValue, icon, source: 'ex-Tattoo', detailsId: l.id };
        priceMap[l.id.replace(/-/g,' ')] = priceMap[key]; // slug with spaces fallback
      });
      console.log(`[Tattoo] ex=${(exData.lines||[]).length} items=${(itemData.lines||[]).length}`);
    } catch(e) { console.warn('[Tattoo]', e.message); }
  })();

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

// ── debug: ดู raw item data ────────────────────────────────────────────────
// GET /api/debug-item?accountName=X&league=Y&tabIndex=Z&sessid=S&search=ultimatum
app.get('/api/debug-item', async (req, res) => {
  const { accountName, league, tabIndex, sessid, search } = req.query;
  if (!accountName || !sessid) return res.status(400).json({ error: 'missing params' });
  const url = `https://www.pathofexile.com/character-window/get-stash-items`
    + `?accountName=${encodeURIComponent(accountName)}`
    + `&league=${encodeURIComponent(league || 'Mirage')}`
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

