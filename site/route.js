// Routing over the Sigmastorm Path Finder data. No DOM here.
//   const R = SSRoute.create(data);   // data = window.SSAR (data.js) or the parsed route.json
//   R.findRoute('Memory Core', 'Data Store', [3, 8])  ->  steps (or null), steps.total = estimated moves
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSRoute = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class MinHeap {
    constructor() { this.a = []; }
    push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    }
    get size() { return this.a.length; }
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  // Master realms (sector maps) that really connect to each other. None are known: neither the guide nor the wiki says.
  // Each entry is a pair of master realm names, e.g. ['First Map', 'Second Map'].
  const WORLD_LINKS = [];
  const FREE_TO = 'Taulin Rad Lands'; // you can teleport here from anywhere...
  const TELEPORT_COST = 25; // ...for 25 energy, counted as 25 moves

  function create(D) {
    const byName = {};
    const realmByGuide = {};
    D.areas.forEach((a) => {
      byName[a.name] = a;
      if (a.guideId != null && a.kind === 'realm') realmByGuide[a.guideId] = a;
    });
    const masters = D.worlds.map((n) => byName[n]);
    const realms = D.areas.filter((a) => a.kind === 'realm');

    // graph: every area has a list of edges { to, kind, x, y, ax, ay, note }
    //   stairs (tile x,y -> arrive ax,ay), exit (area -> its master realm map), enter (master realm map -> area), world (next to each other)
    const adj = {};
    D.areas.forEach((a) => { adj[a.name] = []; });
    const addEdge = (a, b, kind, info) => adj[a].push(Object.assign({ to: b, kind }, info));
    const drawn = new Map(); // one entry per pair of connected areas, used by the website to draw lines
    const addDrawn = (a, b, kind) => { const k = [a, b].sort().join('\u0000'); if (!drawn.has(k)) drawn.set(k, { a, b, kind }); };
    realms.forEach((a) => {
      a.stairs.forEach((s) => {
        addEdge(a.name, s.to, 'stairs', { x: s.x, y: s.y, ax: s.arrive && s.arrive.x, ay: s.arrive && s.arrive.y, note: s.note || '' });
        addDrawn(a.name, s.to, 'stairs');
      });
      a.worldExits.forEach((e) => {
        if (!byName[e.world]) return;
        addEdge(a.name, e.world, 'exit', { x: e.x, y: e.y });
        addEdge(e.world, a.name, 'enter', { x: e.x, y: e.y });
        addDrawn(a.name, e.world, 'exit');
      });
    });
    masters.forEach((m) => {
      (m.entries || []).forEach((n) => {
        if (!adj[m.name].some((e) => e.to === n)) {
          addEdge(m.name, n, 'enter', {});
          addEdge(n, m.name, 'exit', {});
          addDrawn(m.name, n, 'exit');
        }
      });
    });
    WORLD_LINKS.forEach(([a, b]) => {
      if (!byName[a] || !byName[b]) throw new Error('WORLD_LINKS: unknown master realm ' + (byName[a] ? b : a));
      addEdge(a, b, 'world', {}); addEdge(b, a, 'world', {});
    });

    // Cost is in moves: walking inside an area is the straight-line distance between the tile you arrive on and the tile of
    // the next stairs or portal (diagonals allowed, obstacles ignored). A portal takes you to the sector map of any master realm,
    // and you can teleport to Taulin Rad Lands from anywhere for 25 energy, so the cheapest way may start with either.
    const cheb = (t, x, y) => (t && x != null ? Math.max(Math.abs(t[0] - x), Math.abs(t[1] - y)) : 0);
    function moveOptions(name, tile) {
      const out = [];
      adj[name].forEach((e) => {
        const walk = cheb(tile, e.x, e.y);
        if (e.kind === 'stairs') out.push({ e, walk, cost: walk + 1, at: e.ax != null ? [e.ax, e.ay] : null });
        else if (e.kind === 'exit') out.push({ e, walk, cost: walk + 1, at: null });
        else if (e.kind === 'enter') out.push({ e, walk: 0, cost: 4, at: e.x != null ? [e.x, e.y] : null });
        else out.push({ e, walk: 0, cost: 20, at: null });
      });
      // every portal leads to the same places, so only the nearest portal of an area counts
      let near = null;
      (byName[name].portals || []).forEach((p) => {
        const walk = cheb(tile, p.x, p.y);
        if (!near || walk < near.walk) near = { p, walk };
      });
      if (near) {
        masters.forEach((m) => {
          if (m.name === name) return;
          out.push({ e: { to: m.name, kind: 'portal', x: near.p.x, y: near.p.y, name: near.p.name }, walk: near.walk, cost: near.walk + 2, at: null });
        });
      }
      if (byName[FREE_TO] && name !== FREE_TO) out.push({ e: { to: FREE_TO, kind: 'free' }, walk: 0, cost: TELEPORT_COST, at: null });
      return out;
    }

    // Cheapest way from one area to another. `tile` is [x, y] of where you stand now (optional, makes the first walk exact).
    // Event-only areas are never used as a way through, only as the start or the destination.
    function findRoute(from, to, tile) {
      const key = (n, t) => n + '@' + (t ? t[0] + ',' + t[1] : '');
      const info = {};
      const dist = {};
      const prev = {};
      const heap = new MinHeap();
      const k0 = key(from, tile || null);
      info[k0] = { name: from, tile: tile || null };
      dist[k0] = 0;
      heap.push(0, k0);
      let goal = null;
      while (heap.size) {
        const [d, k] = heap.pop();
        if (d > dist[k]) continue;
        const st = info[k];
        if (st.name === to) { goal = k; break; }
        moveOptions(st.name, st.tile).forEach((o) => {
          if (o.e.to !== to && byName[o.e.to].event) return;
          const nk = key(o.e.to, o.at);
          const nd = d + o.cost;
          if (dist[nk] === undefined || nd < dist[nk]) {
            dist[nk] = nd; info[nk] = { name: o.e.to, tile: o.at };
            prev[nk] = { from: k, step: { from: st.name, edge: o.e, walk: o.walk, cost: o.cost } };
            heap.push(nd, nk);
          }
        });
      }
      if (!goal) return null;
      const steps = [];
      for (let k = goal; k !== k0; k = prev[k].from) steps.unshift(prev[k].step);
      steps.total = dist[goal];
      return steps;
    }

    // Name search: starts-with first, then contains, then every typed word somewhere in the name. Shorter names first.
    const index = D.areas.map((a) => ({ a, n: norm(a.name), w: a.name.toLowerCase() }));
    function search(q, limit) {
      const nq = norm(q);
      if (!nq) return [];
      const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
      const hits = [];
      index.forEach((e) => {
        let rank = -1;
        if (e.n.startsWith(nq)) rank = 0;
        else if (e.n.indexOf(nq) !== -1) rank = 1;
        else if (words.length > 1 && words.every((w) => e.w.indexOf(w) !== -1)) rank = 2;
        if (rank >= 0) hits.push([rank, e.a]);
      });
      hits.sort((x, y) => x[0] - y[0] || x[1].name.length - y[1].name.length || x[1].level - y[1].level);
      return hits.slice(0, limit || 8).map((h) => h[1]);
    }

    // Where the game says the player is: `realmId` is the game's realm_id, which is the guide's id.
    function fromGame(realmId) {
      return realmId != null && realmId > 0 && realmByGuide[realmId] ? realmByGuide[realmId] : null;
    }

    return { byName, masters, realms, adj, drawn, findRoute, search, fromGame };
  }

  return { create, MinHeap, norm };
}));
