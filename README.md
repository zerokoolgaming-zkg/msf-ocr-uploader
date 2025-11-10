# MSF Screenshot → Sheet Uploader (Portrait Recognition)

This version adds **automatic character name recognition** by comparing cropped portrait regions to your own portrait library.

## Two ways to provide portraits
1. **Committed folder (recommended):**
   - Put all PNG/JPG portraits in `/portraits/`
   - Run **tools/make-manifest.html** locally to generate `/portraits/manifest.json`
   - Commit both the folder and manifest to the repo
2. **Import ZIP at runtime:**
   - Click **Import portrait ZIP** on the site
   - Select a ZIP containing the portraits (filenames become names)
   - The portraits are read in your browser; nothing is uploaded to servers

> Matching uses a perceptual **average hash (aHash)** and **Hamming distance**. You can tune the threshold in `config.js` (`matchThreshold`, default 60 for hashSize 16).

## What it captures
- **N (Attack TCP)** and **O (Defense TCP)** via OCR (editable)
- **M (Punch Type)** – `IF(O>N, "Punch Up", "Punch Down")`
- **P (Power Diff)** – `ABS(N - O)`
- **Q (Victory Points)** via OCR (editable)
- **K (Season)** & **L (Room)** – defaults or per-card edit
- **Attack1–Attack5** and **Defense1–Defense5** — auto-filled after clicking **Match portraits** (editable)

## GitHub Pages + Google Sheet
Same steps as the previous build:
1. Deploy repo to GitHub Pages.
2. Create a Google Sheet and paste **apps_script_code.gs** into Apps Script.
3. Deploy as Web App and paste the URL into **config.js** → `backendUrl`.

## Cropping template
The app uses a heuristic crop (two horizontal strips, 5 columns each). If your screenshots differ, click the **⚙️** button on a card to edit the crop JSON (percent-based). Re-run **Match portraits** afterward.

## Performance tips
- Keep `hashSize` at 16 for a 256-bit hash (good balance).  
- Adjust `matchThreshold` (40–70 is typical). Lower → stricter matches; higher → more permissive.
