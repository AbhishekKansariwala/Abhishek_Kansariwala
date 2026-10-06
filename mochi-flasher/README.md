# Dasai Mochi — browser firmware installer

A static site that flashes ESP32 firmware for the Dasai Mochi desktop robot straight from
the browser, in the style of [themochi.huykhong.com](https://themochi.huykhong.com/).
No build step, no framework — open `index.html` and that's the whole site.

```
index.html                  the page
assets/css/styles.css       all styling; brand colours are the first 20 lines
assets/js/main.js           reads the manifest to fill in version + chip badge
firmware/manifest.json      which .bin goes at which offset  <- edit this
firmware/README.md          how to produce those .bin files
vendor/esp-web-tools/       flashing library, vendored (Apache-2.0, see LICENSE)
.nojekyll                   stops GitHub Pages mangling the vendor folder
```

## Status

The page is complete and the flashing library is wired up, but **no firmware binaries
are committed yet** — see `firmware/README.md`. Add them and the Install button works.

## Make it yours

| Change | Where |
|---|---|
| Colours, radius, fonts | `:root` at the top of `assets/css/styles.css` |
| Name, tagline, copy | `index.html` — plain semantic HTML, no templating |
| Setup hotspot SSID | `SETUP_SSID` at the top of `assets/js/main.js` |
| Bill of materials | the `.bom` table in `index.html` |
| Firmware version / boards | `firmware/manifest.json` (the page reads it at load) |

## Run it locally

Web Serial needs a secure context, and `localhost` counts as one, so plain HTTP is
fine for local testing:

```sh
cd mochi-flasher
python3 -m http.server 8000
# open http://localhost:8000
```

Flashing only works in desktop **Chrome, Edge or Opera** — Firefox and Safari have no
Web Serial API, and the page shows a notice saying so.

## Deploy

Any static host works. The one hard requirement is **HTTPS**, without which the
browser refuses serial access.

- **GitHub Pages** — push this folder as the repo root (or set Pages to serve a
  `/docs` folder) and enable Pages. `.nojekyll` is already here.
- **Cloudflare Pages / Netlify / Vercel** — no build command, output directory `/`.

Binaries are served as plain static files, so a large `dasaimochi.bin` counts against
whatever file-size limits your host has.

## Credit

Flashing is [ESP Web Tools](https://esphome.github.io/esp-web-tools/) by the ESPHome
project, vendored under `vendor/esp-web-tools/` with its Apache-2.0 licence. To
update it: `npm pack esp-web-tools` and copy `package/dist/web/*` over that folder.
