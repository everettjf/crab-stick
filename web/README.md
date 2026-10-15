# Crab Stick project website

Static GitHub Pages source. This is the public project guide, separate from the authenticated local console in `crab/bridge/web/`.

- English by default, with a remembered Chinese toggle.
- No build, dependencies, analytics, credentials or device API calls.
- Relative assets support project subpaths, including the account’s inherited Pages domain: `https://xnu.app/crab-stick/`.
- `.github/workflows/pages.yml` checks the site and publishes only this folder from `main`.

Preview from the repository root:

```sh
python3 -m http.server 8080 --directory web
```

Open http://127.0.0.1:8080/. Validate with `python3 .github/scripts/check_web.py` (Python 3.9+) and `node --check web/app.js`.

GitHub repository Settings → Pages must use **GitHub Actions**. After deployment, the workflow's environment URL is the source of truth for the live address.

The animated crab is generated from the original MIT-licensed `crab/avatar/crab_pixel.c`; its preview GIF is included as a public website asset. Upstream Muse avatars are not used.
