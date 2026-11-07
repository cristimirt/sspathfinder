# Sigmastorm Path Finder (levels 1-440)

A path finder and area browser for [Sigmastorm](https://www.sigmastorm.com/), modelled on the [Fallen Sword Path Finder](https://cristimirt.github.io/fspathfinder/). Plain HTML/CSS/JS, no database, no build step for the page itself. The look follows the Sigmastorm website (black page under an orange sky, steel panels, yellow/black hazard stripes, cyan links); the Theme button switches to a plain dark theme.

## Run it
Open `site/index.html` in a browser (it is all relative files), or run `node tools/serve.js` and go to http://127.0.0.1:48790/.

## Hosting
`.github/workflows/pages.yml` publishes the `site/` folder to GitHub Pages on every push to `main`. One-time setup: repository Settings, Pages, Build and deployment, Source: GitHub Actions. After changing data run `node tools/build-data.js` and commit the regenerated `site/data.js` and `site/route.json`.

## What it shows
Same structure as the Fallen Sword Path Finder (the in-game helper widget is developed separately, in the Sigmastorm helper userscript):
- A left menu with one group per 100 levels, split into pages of about 40 areas (always starting on a level divisible by 5), and a "Go to level" box.
- One section per **master realm** (the sector maps that the guide's "Stairway to Master Realm" tiles lead to: Taulin Rad Lands, Highridge Mines, Nargith Plain, ...), with its areas laid out in rows by distance from the sector map (ELK layered layout in `site/vendor/`, EPL-2.0) and a line for every stairway.
- Hover or click an area for its card: creatures and missions (wiki), shops, artifacts, portals and other buildings with their tiles (guide), every exit with its tile coordinates. Every area has Guide and Wiki links.
- Search (`/`), creature search, drag-to-rearrange boxes, and a route finder (shortest path over stairs and sector maps, with the tile of every stairway).

## Data
`data/raw/` holds what was crawled with a browser (`tools/crawl-browser.js` has the snippets; `node tools/recv.js` receives their output):
- `guide.json`: guide.sigmastorm.com. The area list (652 areas, id, name, level) and, per area, its tile map: stairways (target area and tile), exits to a master realm, shops, artifacts, portals and buildings, each with its tile. **The guide is the source of truth** for areas, levels, stairs and tiles.
- `wiki.json`: the `AreaHeader` template of the 497 pages in sigmastorm2.fandom.com `Category:Areas`. Used for missions and creatures (the guide has neither), and for the wiki page title of each area. 452 of the 497 pages match a guide area by name.

`node tools/build-data.js` turns them into `site/data.js` and `site/route.json`. Manual fixes live at the top of that file (`EVENT_NAME`, `MASTER_ALIAS`, `WORLD_OVERRIDE`).

## Known gaps / assumptions
- Wiki data is player-maintained and covers fewer areas than the guide, so many areas list no creatures or missions (and creatures have no rank or race).
- The sector maps themselves are not documented. A master realm is connected to the areas that have its exit tile; which sector map is next to which is unknown, so none are linked. An area belongs to the master realm it is entered from, otherwise to the one fewest stairways away.
- Portals: every portal teleports to the sector map of any master realm (cost: the walk to it plus 2 moves), and Taulin Rad Lands can be reached from anywhere for 25 energy (counted as 25 moves). Both are used for routing (source: the game, told by the site owner).
- The four Slaughterfest arenas have no stairs and are shown as special event areas.
- Route lengths are estimates: walking is the straight-line distance between tiles and obstacles are ignored.
