// The browser snippets used to collect data/raw/guide.json and data/raw/wiki.json (both sites sit behind Cloudflare or
// block plain requests, so they were crawled from a real browser tab). Paste a snippet into the DevTools console of the site
// named in its heading, wait for it to finish, then post the result to `node tools/recv.js` with a form POST (a plain fetch
// from an https page to http://127.0.0.1 is held back by the browser):
//
//   const f = document.createElement('form'); f.method = 'POST'; f.action = 'http://127.0.0.1:48791/guide'; f.enctype = 'text/plain';
//   const t = document.createElement('textarea');
//   t.name = '{"realms":' + JSON.stringify(window.realms) + ',"data":' + JSON.stringify(window.data) + ',"_":"'; t.value = '"}';
//   f.appendChild(t); document.body.appendChild(f); f.submit();
//
// (for the wiki: action .../wiki and t.name = '{"pages":' + JSON.stringify(window.wiki) + ',"_":"')

/* ---- 1. on https://guide.sigmastorm.com/index.php?cmd=realms ------------------------------------------------------------ */
async function crawlGuide() {
  window.realms = [];
  for (let i = 0; i < 27; i++) { // the area list has 27 pages of 25
    const h = await fetch('index.php?cmd=realms&index=' + i + '&search_name=&search_level_min=&search_level_max=').then((r) => r.text());
    const d = new DOMParser().parseFromString(h, 'text/html');
    d.querySelectorAll('a[href*="subcmd=view"]').forEach((a) => {
      const tds = a.closest('tr').querySelectorAll('td');
      window.realms.push([a.getAttribute('href').match(/realm_id=(\d+)/)[1], a.textContent.trim(), tds[tds.length - 1].textContent.trim()]);
    });
  }
  // every area page is a table of 25px tiles: stairways are links to another realm_id, everything else is an image with a tooltip
  const parse = (h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    const name = (d.querySelector('td[bgcolor="#000000"][width="800"] b') || {}).textContent;
    const mt = [...d.querySelectorAll('table')].find((t) => t.rows[0] && t.rows[0].cells[0] && t.rows[0].cells[0].getAttribute('width') === '25');
    const res = { name, w: 0, h: 0, st: [], loc: [] };
    if (!mt) return res;
    res.h = mt.rows.length;
    [...mt.rows].forEach((tr, y) => {
      res.w = Math.max(res.w, tr.cells.length);
      [...tr.cells].forEach((td, x) => {
        const a = td.querySelector('a'), img = td.querySelector('img');
        if (!img) return;
        const src = img.getAttribute('src') || '';
        const tip = ((img.getAttribute('onmouseover') || '').match(/Tip\('([\s\S]*?)'\);/) || [])[1] || '';
        if (a && /realm_id=(\d+)/.test(a.getAttribute('href'))) res.st.push([x, y, +a.getAttribute('href').match(/realm_id=(\d+)/)[1], tip.replace(/^Stairway to /, '')]);
        else if (/\/tiles\//.test(src)) { /* floor tile */ }
        else res.loc.push([x, y, src.replace(/.*cdn.sigmastorm.com\//, ''), tip.replace(/&lt;/g, '<').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)]);
      });
    });
    return res;
  };
  window.data = {};
  const queue = window.realms.map((r) => r[0]);
  const worker = async () => { while (queue.length) { const id = queue.shift(); window.data[id] = parse(await fetch('index.php?cmd=realms&subcmd=view&realm_id=' + id).then((r) => r.text())); } };
  await Promise.all(Array.from({ length: 6 }, worker));
}

/* ---- 2. on https://sigmastorm2.fandom.com/wiki/Category:Areas ----------------------------------------------------------- */
async function crawlWiki() {
  window.wiki = {};
  let cont = '';
  for (;;) {
    const r = await fetch('/api.php?action=query&format=json&generator=categorymembers&gcmtitle=Category:Areas&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main' + cont).then((x) => x.json());
    Object.values(r.query.pages).forEach((p) => {
      const c = p.revisions[0].slots.main['*'];
      const k = c.indexOf('\n{|'); // keep the AreaHeader template, drop the tile table
      window.wiki[p.title] = (k > 0 ? c.slice(0, k) : c.slice(0, 3000)).slice(0, 4000);
    });
    if (!r.continue) break;
    cont = '&gcmcontinue=' + encodeURIComponent(r.continue.gcmcontinue);
  }
}
