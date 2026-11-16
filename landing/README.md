# دیبا پل — Landing page

Static, dependency-free landing page for **DibaBridge / دیبا پل**. It is designed
for GitHub Pages and served from this folder.

## Preview locally

From the repository root:

```bash
python -m http.server 8090 --directory landing
```

Open <http://127.0.0.1:8090/>.

## Deploy to GitHub Pages

1. Push this folder and `.github/workflows/pages.yml` to the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
   This one-time setting must be done by a repository admin; `GITHUB_TOKEN`
   cannot create the Pages site itself.
4. Run the **Deploy landing page** workflow, or push a change under `landing/`.
5. The site is published at:

```text
https://dibachain-company.github.io/diba-bridge/
```

All paths are relative, so the page also works under a project subpath.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page structure and content |
| `styles.css` | Design tokens, layout and responsive styles |
| `app.js` | Mobile menu, tabs, copy button and footer year |
| `assets/` | Logo, provider marks and self-hosted Vazirmatn fonts |
| `assets/screens/` | Screenshots of the installer and the dashboard, taken from a local test instance with sample data |

Fonts: [Vazirmatn](https://github.com/rastikerdar/vazirmatn) under the SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).

No build step and no external JavaScript dependencies.
