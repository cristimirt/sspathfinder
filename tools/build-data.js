// Builds site/data.js and site/route.json from the raw crawl of the guide and the wiki.
//   node tools/build-data.js
// Inputs  (data/raw): guide.json  (guide.sigmastorm.com: area list + the tile map of every area)
//                     wiki.json   (sigmastorm2.fandom.com: AreaHeader template of every page in Category:Areas)
// Output  (site):     data.js     ->  window.SSAR = { built, pages, worlds, areas }
//                     route.json  ->  routing data only
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rawDir = path.join(root, 'data', 'raw');
const guide = JSON.parse(fs.readFileSync(path.join(rawDir, 'guide.json'), 'utf8'));
const wikiRaw = JSON.parse(fs.readFileSync(path.join(rawDir, 'wiki.json'), 'utf8')).pages;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (s) => String(s).replace(/\\/g, '').replace(/\s+/g, ' ').trim();

const PAGE_GROUP = 100; // one menu group per 100 levels
const PAGE_SIZE = 40;   // target number of areas per page
const PAGE_MIN = 12;    // a shorter leftover at the end of a group is merged into the page before it

// Areas that only exist for an event (Slaughterfest arenas): they have no stairs at all.
const EVENT_NAME = /^SF .* Arena$/;
// The guide shows a few master realms under different names than the wiki does; fixed by hand when they disagree.
const MASTER_ALIAS = {};
// Areas that are claimed by several master realms (or none) are filed by hand here: area -> master realm.
const WORLD_OVERRIDE = {};

// ---- guide: areas and their tile maps
const levelById = {};
guide.realms.forEach(([id, name, level]) => { levelById[id] = { name: clean(name), level: +level }; });
const byName = {};
const byNorm = {};
const byId = {};
const areas = [];
Object.keys(guide.data).forEach((id) => {
  const g = guide.data[id];
  const name = clean(levelById[id].name || g.name);
  if (byName[name]) throw new Error('duplicate area name: ' + name);
  const a = {
    name, kind: 'realm', level: levelById[id].level, world: null, guideId: +id, wikiTitle: '',
    dark: false, event: EVENT_NAME.test(name),
    shops: [], relics: [], quests: [], creatures: [], services: [],
    stairs: [], beyond: [], portals: [], shopSpots: [], relicSpots: [], worldExits: [],
    size: [g.w, g.h],
  };
  byName[name] = a; byNorm[norm(name)] = a; byId[id] = a;
  areas.push(a);
});

// ---- wiki: level, stairs / stores with tiles, missions, creatures
const wikiLink = (s) => { const m = s.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/); return m ? clean(m[1]) : null; };
const wikiBy = {};
Object.keys(wikiRaw).forEach((title) => { wikiBy[norm(title)] = { title, text: wikiRaw[title] }; });
let wikiHit = 0;
areas.forEach((a) => {
  const w = wikiBy[norm(a.name)];
  if (!w) return;
  wikiHit++;
  a.wikiTitle = w.title;
  const sec = {};
  let cur = null;
  w.text.replace(/<\/?p>/g, '\n').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\{\{AreaHeader\|\s*level\s*=\s*\d*\s*$/) || line.match(/^\|\s*(\w+)\s*=\s*(.*)$/) || line.match(/^\{\{AreaHeader\|\s*level\s*=\s*\d*\s*\|\s*(\w+)\s*=\s*(.*)$/);
    if (m && m[1]) { cur = m[1].toLowerCase(); sec[cur] = [m[2] || '']; }
    else if (cur) sec[cur].push(line);
  });
  // missions: lines that start with a single colon are the missions; "::" lines say where one starts
  (sec.missions || []).forEach((l) => {
    if (/^\s*::/.test(l)) return;
    const t = wikiLink(l);
    if (t && a.quests.indexOf(t) === -1) a.quests.push(t);
  });
  (sec.entities || []).forEach((l) => {
    const t = wikiLink(l);
    if (t && !a.creatures.some((c) => c.name === t)) a.creatures.push({ name: t, rank: '', race: '' });
    // several entities may share a line
    (l.match(/\[\[[^\]]+\]\]/g) || []).slice(1).forEach((x) => {
      const n = wikiLink(x);
      if (n && !a.creatures.some((c) => c.name === n)) a.creatures.push({ name: n, rank: '', race: '' });
    });
  });
});

// A bank is a building you keep Credits in. The guide names them differently everywhere (Bank, Vault, Savings, "Credit Core"...)
// and its tooltip talks about saving Credits; the repair / heal / build buildings say "for a Credit cost" instead.
const isBank = (name, note) => /\b(bank|vault|savings)\b/i.test(name) ||
  (!/cost/i.test(note) && /(sav(e|ing)|stor(e|ing)|protect|hoard|keep|back ?up|deposit|safe|stash|rainy)/i.test(note) && /(credit|creds|criedts|save)/i.test(note + ' ' + name));

// ---- the guide's tile map: stairs, master realm exits, shops, relics, portals, other buildings
const masterLevel = {};
const masterEntries = {};
areas.forEach((a) => {
  const g = guide.data[a.guideId];
  const seen = {};
  g.st.forEach(([x, y, to]) => {
    const t = byId[to];
    if (!t || t === a) return;
    const key = t.name + '@' + x + ',' + y;
    if (seen[key]) return;
    seen[key] = 1;
    a.stairs.push({ to: t.name, x, y, note: '' });
  });
  g.loc.forEach(([x, y, img, tipRaw]) => {
    const tip = clean(tipRaw.replace(/<[^>]*>/g, ' '));
    if (/^shops\//.test(img)) {
      const n = tip.replace(/^Shop:\s*/, '');
      a.shopSpots.push({ name: n, x, y });
      if (a.shops.indexOf(n) === -1) a.shops.push(n);
    } else if (/^relics\//.test(img)) {
      const n = tip.replace(/^Relic:\s*/, '');
      a.relicSpots.push({ name: n, x, y });
      if (a.relics.indexOf(n) === -1) a.relics.push(n);
    } else if (/^portals\//.test(img)) {
      a.portals.push({ name: 'Portal', x, y });
    } else if (/^stairways\//.test(img)) {
      const m = tip.match(/Master Realm '(.*)'$/) || tip.match(/Master Realm (.*)$/);
      if (!m) return;
      const mn = MASTER_ALIAS[clean(m[1])] || clean(m[1]);
      a.worldExits.push({ world: mn, x, y });
      (masterEntries[mn] = masterEntries[mn] || []).push(a.name);
      masterLevel[mn] = Math.min(masterLevel[mn] == null ? 1e9 : masterLevel[mn], a.level);
    } else if (/^locations\//.test(img)) {
      // a building with a "Name: what it does" tooltip (bank, mechanic, cloning facility...)
      const m = tip.match(/^([^:.<>]{2,34}):\s*(.*)$/);
      if (m && !/^Relic$|^Shop$/.test(m[1])) {
        const note = m[2].length > 70 ? '' : m[2];
        const sv = { name: m[1].trim(), note, x, y };
        if (isBank(m[1], m[2])) sv.bank = true;
        a.services.push(sv);
      }
    }
  });
});

// ---- master realms (the guide's "Master Realm" stairways = the sector maps)
const worldRows = Object.keys(masterEntries)
  .map((name) => ({ name, level: masterLevel[name], entries: masterEntries[name].filter((n, i, all) => all.indexOf(n) === i) }))
  .sort((p, q) => p.level - q.level || p.name.localeCompare(q.name))
  .map((m, i, all) => Object.assign(m, { prev: i ? all[i - 1].name : null, next: all[i + 1] ? all[i + 1].name : null }));
worldRows.forEach((m) => {
  if (byName[m.name]) throw new Error('master realm name clashes with an area: ' + m.name);
  const a = {
    name: m.name, kind: 'master', level: m.level, world: m.name, guideId: null,
    nearestPortal: '', moves: 0, main: [], entries: m.entries.slice(),
    stairs: [], beyond: [], portals: [], shops: [], relics: [], quests: [], creatures: [], services: [],
    shopSpots: [], relicSpots: [], worldExits: [],
  };
  byName[m.name] = a; byNorm[norm(m.name)] = a;
  areas.push(a);
});
const worldNames = worldRows.map((w) => w.name);

// ---- which master realm each area belongs to: the entries of a master realm are certain; the rest take the master
// realm that is the fewest stairways away (ties: the highest master level that is not above the area's level).
const adj = {};
areas.forEach((a) => { if (a.kind === 'realm') adj[a.name] = new Set(); });
areas.forEach((a) => a.stairs.forEach((s) => { adj[a.name].add(s.to); adj[s.to].add(a.name); }));
const dist = {}, owners = {};
let frontier = [];
worldRows.forEach((w) => w.entries.forEach((n) => {
  if (!(n in dist)) { dist[n] = 0; owners[n] = []; frontier.push(n); }
  if (owners[n].indexOf(w) === -1) owners[n].push(w);
}));
while (frontier.length) {
  const next = [];
  frontier.forEach((r) => adj[r].forEach((b) => {
    if (!(b in dist)) { dist[b] = dist[r] + 1; owners[b] = owners[r].slice(); next.push(b); }
    else if (dist[b] === dist[r] + 1) owners[r].forEach((o) => { if (owners[b].indexOf(o) === -1) owners[b].push(o); });
  }));
  frontier = next;
}
const pick = (list, a) => list.filter((m) => m.level <= a.level).sort((p, q) => q.level - p.level)[0] || list.slice().sort((p, q) => p.level - q.level)[0];
areas.filter((a) => a.kind === 'realm').forEach((a) => {
  const o = owners[a.name];
  if (WORLD_OVERRIDE[a.name]) a.world = WORLD_OVERRIDE[a.name];
  else if (o) a.world = o.length === 1 ? o[0].name : pick(o, a).name;
});
// areas with no way to a master realm at all (event arenas): filed under the master realm that fits their level
const masterByLevel = worldRows.slice().sort((p, q) => q.level - p.level);
areas.filter((a) => a.kind === 'realm' && !a.world).forEach((a) => {
  a.world = (masterByLevel.find((w) => w.level <= a.level) || masterByLevel[masterByLevel.length - 1]).name;
});

// ---- stairs are two-way: tell the other side where you arrive, and add links only one side lists
const declared = {};
areas.forEach((a) => a.stairs.forEach((s) => { declared[a.name + '\u0000' + s.to] = s; }));
areas.forEach((a) => {
  a.stairs.slice().forEach((s) => {
    const back = declared[s.to + '\u0000' + a.name];
    s.arrive = back ? { x: back.x, y: back.y } : null;
    if (!back && byName[s.to]) {
      const o = byName[s.to];
      const implied = { to: a.name, x: null, y: null, note: '', arrive: { x: s.x, y: s.y }, implied: true };
      o.stairs.push(implied);
      declared[s.to + '\u0000' + a.name] = implied;
    }
  });
});

// where the portals are, for the master realm headings
worldRows.forEach((w) => {
  const m = byName[w.name];
  m.portalAreas = areas.filter((a) => a.kind === 'realm' && a.world === w.name && a.portals.length).map((a) => a.name);
  m.prevWorld = w.prev; m.nextWorld = w.next;
});

// ---- pages: one group per PAGE_GROUP levels, each cut into pages of about PAGE_SIZE areas. A page starts on a level divisible by 5.
const buildPages = () => {
  const count = {};
  let top = 0;
  areas.forEach((a) => { if (a.kind === 'realm' && !a.event) { count[a.level] = (count[a.level] || 0) + 1; top = Math.max(top, a.level); } });
  const pages = [];
  for (let g = 0; g * PAGE_GROUP <= top; g++) {
    const first = Math.max(1, g * PAGE_GROUP), last = Math.min(g * PAGE_GROUP + PAGE_GROUP - 1, top);
    const group = 'Levels ' + first + ' – ' + (g * PAGE_GROUP + PAGE_GROUP - 1 > top ? top : g * PAGE_GROUP + PAGE_GROUP - 1);
    const mine = [];
    let start = first, acc = 0;
    for (let l = first; l <= last; l++) {
      acc += count[l] || 0;
      if (l < last && acc >= PAGE_SIZE && (l + 1) % 5 === 0) { mine.push({ min: start, max: l, n: acc }); start = l + 1; acc = 0; }
    }
    mine.push({ min: start, max: last, n: acc });
    if (mine.length > 1 && mine[mine.length - 1].n < PAGE_MIN) { const x = mine.pop(); mine[mine.length - 1].max = x.max; mine[mine.length - 1].n += x.n; }
    mine.forEach((m) => pages.push({ id: pages.length + 1, group, label: 'Levels ' + m.min + ' - ' + m.max, min: m.min, max: m.max }));
  }
  return pages;
};
const PAGES = buildPages();

const out = { built: new Date().toISOString().slice(0, 10), pages: PAGES, worlds: worldNames, areas };
fs.mkdirSync(path.join(root, 'site'), { recursive: true });
fs.writeFileSync(path.join(root, 'site', 'data.js'), 'window.SSAR = ' + JSON.stringify(out) + ';\n');

const routeOut = {
  built: out.built,
  worlds: worldNames,
  areas: areas.map((a) => {
    const r = { name: a.name, kind: a.kind, level: a.level, guideId: a.guideId };
    if (a.world) r.world = a.world;
    if (a.event) r.event = 1;
    r.stairs = a.stairs.map((s) => { const o = { to: s.to, x: s.x, y: s.y }; if (s.arrive) o.arrive = s.arrive; return o; });
    r.portals = a.portals || [];
    r.worldExits = a.worldExits || [];
    if (a.entries && a.entries.length) r.entries = a.entries;
    return r;
  }),
};
fs.writeFileSync(path.join(root, 'site', 'route.json'), JSON.stringify(routeOut));

// ---- report
const count = (f) => areas.filter(f).length;
console.log('areas', count((a) => a.kind === 'realm'), 'masters', worldRows.length, 'pages', PAGES.length);
console.log('wiki pages matched', wikiHit, 'of', Object.keys(wikiRaw).length, '; unmatched wiki:', Object.keys(wikiRaw).filter((t) => !byNorm[norm(t)]).length);
console.log('with quests', count((a) => a.quests.length), 'creatures', count((a) => a.creatures.length), 'shops', count((a) => a.shopSpots.length),
  'relics', count((a) => a.relicSpots.length), 'portals', count((a) => a.portals.length), 'services', count((a) => a.services.length), 'banks', count((a) => a.services.some((v) => v.bank)));
console.log('no stairs:', areas.filter((a) => a.kind === 'realm' && !a.stairs.length).map((a) => a.name).join(', ') || '-');
const sizes = {};
areas.filter((a) => a.kind === 'realm').forEach((a) => { sizes[a.world] = (sizes[a.world] || 0) + 1; });
console.log('per master realm:', worldRows.map((w) => w.name + ' [' + w.level + '] ' + (sizes[w.name] || 0)).join('; '));
console.log('multi-owner entries:', Object.keys(owners).filter((n) => owners[n].length > 1 && dist[n] === 0).join(', ') || '-');
console.log('levels', Math.min(...areas.filter((a) => a.kind === 'realm').map((a) => a.level)), '-', PAGES[PAGES.length - 1].max);
