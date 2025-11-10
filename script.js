/* MSF Screenshot → Sheet Uploader (Portrait Recognition)
 * - Multi-image OCR using Tesseract.js
 * - Portrait → name recognition via aHash + Hamming distance
 * - Optionally load portraits from /portraits/manifest.json OR import a ZIP
 * - Push rows to Google Sheet via Apps Script
 */
const el = (id) => document.getElementById(id);
const cardsEl = el("cards");
const fileInput = el("fileInput");
const zipInput = el("zipInput");
const progressEl = el("progress");
const pushAllBtn = el("pushAll");
const defaultSeasonEl = el("defaultSeason");
const defaultRoomEl = el("defaultRoom");
const portraitNotice = el("portraitNotice");

let rows = []; // {id, imgUrl, season, room, n, o, m, p, q, attackChars[5], defenseChars[5], crop}
let portraitLib = []; // {name, url, hash}

function fmtInt(s){
  if (s == null) return "";
  const num = String(s).replace(/[^\d]/g,"");
  return num ? parseInt(num,10) : "";
}
function detectPunch(n, o){
  if (n === "" || o === "") return "";
  return (o > n) ? "Punch Up" : "Punch Down";
}
function diffAbs(n,o){
  if (n === "" || o === "") return "";
  return Math.abs(o - n);
}

function canvasHash(img, size=portraitConfig.hashSize){
  const c = document.createElement("canvas"); const ct = c.getContext("2d");
  c.width = size; c.height = size;
  ct.drawImage(img, 0, 0, size, size);
  const data = ct.getImageData(0,0,size,size).data;
  // grayscale and compute avg
  const gray = [];
  for (let i=0;i<data.length;i+=4){
    const g = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
    gray.push(g);
  }
  const avg = gray.reduce((a,b)=>a+b,0)/gray.length;
  let bits = "";
  for (const g of gray){ bits += g >= avg ? "1" : "0"; }
  return bits; // string of bits length size*size
}
function hamming(a,b){
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i=0;i<n;i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

async function loadPortraitManifest(){
  try{
    const res = await fetch("portraits/manifest.json", {cache:"no-store"});
    if (!res.ok) throw new Error("manifest missing");
    const list = await res.json();
    portraitNotice.innerHTML = `Loaded ${list.length} portraits from <code>/portraits</code>.`;
    portraitLib = await Promise.all(list.slice(0, portraitConfig.maxCompare).map(async item => {
      const img = await urlToImage(item.url);
      const hash = canvasHash(img);
      return { name: item.name, url: item.url, hash };
    }));
  }catch(e){
    portraitNotice.innerHTML = `No <code>/portraits/manifest.json</code> found. You can still import a portrait ZIP above or use the <a href="tools/make-manifest.html" target="_blank">manifest builder</a>.`;
  }
}
async function urlToImage(url){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

zipInput.addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  portraitLib = [];
  progressEl.textContent = "Reading ZIP…";
  const zip = await JSZip.loadAsync(file);
  const entries = [];
  zip.forEach((path, entry)=>{
    if (!entry.dir && /\.(png|jpg|jpeg)$/i.test(path)){
      entries.push(entry);
    }
  });
  const limit = Math.min(entries.length, portraitConfig.maxCompare);
  let processed = 0;
  for (const entry of entries.slice(0, limit)){
    const blob = await entry.async("blob");
    const url = URL.createObjectURL(blob);
    // name from filename
    const raw = entry.name.split("/").pop();
    const base = raw.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
    const img = await urlToImage(url);
    const hash = canvasHash(img);
    portraitLib.push({ name: base, url, hash });
    processed++;
    progressEl.textContent = `Loaded ${processed}/${limit} portraits from ZIP…`;
  }
  progressEl.textContent = `Loaded ${processed} portraits.`;
});

function render(){
  cardsEl.innerHTML = "";
  rows.forEach((r, idx) => {
    const badge = r.m === "Punch Up" ? '<span class="badge up">Punch Up</span>' :
                  r.m === "Punch Down" ? '<span class="badge down">Punch Down</span>' : "";
    const html = `
      <article class="card" data-id="${r.id}">
        <header>
          <span>Screenshot ${idx+1}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="iconbtn tune" title="Adjust crop" data-id="${r.id}">⚙️</button>
            <button class="btn match" data-id="${r.id}">Match portraits</button>
            <button class="btn push" data-id="${r.id}">Push row</button>
          </div>
        </header>
        <div class="content">
          <img src="${r.imgUrl}" alt="screenshot" style="width:100%;border-radius:12px;border:1px solid #1b2a3b" />
          <div class="row">
            <div>
              <label>Season</label>
              <input class="season" value="${r.season ?? ""}" placeholder="e.g., 1" />
            </div>
            <div>
              <label>Room</label>
              <input class="room" value="${r.room ?? ""}" placeholder="e.g., 1" />
            </div>
          </div>
          <div class="row">
            <div>
              <label>Total Power (Attack) — Column N</label>
              <input class="n" value="${r.n ?? ""}" />
            </div>
            <div>
              <label>Total Power (Defense) — Column O</label>
              <input class="o" value="${r.o ?? ""}" />
            </div>
          </div>
          <div class="kv">
            <div>Column M: <strong>${r.m || ""}</strong> ${badge}</div>
            <div>Column P (|N-O|): <strong>${r.p !== "" ? r.p.toLocaleString() : ""}</strong></div>
            <div>Column Q (VP): <input class="q" value="${r.q ?? ""}" style="width:120px"/></div>
          </div>
          <div class="small" style="margin-top:8px">Characters (auto-filled after “Match portraits”, editable):</div>
          <div class="grid5">
            ${[0,1,2,3,4].map(i => `<input class="a${i}" placeholder="Attack ${i+1}" value="${r.attackChars[i] || ""}">`).join("")}
          </div>
          <div class="grid5">
            ${[0,1,2,3,4].map(i => `<input class="d${i}" placeholder="Defense ${i+1}" value="${r.defenseChars[i] || ""}">`).join("")}
          </div>
        </div>
      </article>`;
    cardsEl.insertAdjacentHTML("beforeend", html);
  });

  cardsEl.querySelectorAll(".card").forEach(card => {
    const id = card.dataset.id;
    const row = rows.find(r => r.id === id);
    const setAndRecalc = () => {
      row.n = fmtInt(card.querySelector(".n").value);
      row.o = fmtInt(card.querySelector(".o").value);
      row.q = fmtInt(card.querySelector(".q").value);
      row.season = card.querySelector(".season").value.trim() || defaultSeasonEl.value.trim();
      row.room = card.querySelector(".room").value.trim() || defaultRoomEl.value.trim();
      row.attackChars = [0,1,2,3,4].map(i => card.querySelector(".a"+i).value.trim());
      row.defenseChars = [0,1,2,3,4].map(i => card.querySelector(".d"+i).value.trim());
      row.m = detectPunch(row.n, row.o);
      row.p = diffAbs(row.n, row.o);
    };
    ["input","change"].forEach(ev => { card.querySelectorAll("input").forEach(inp => inp.addEventListener(ev, setAndRecalc)); });

    card.querySelector(".push").addEventListener("click", async () => { await pushRow(row); });
    card.querySelector(".match").addEventListener("click", async () => { await matchPortraits(row, card); });
    card.querySelector(".tune").addEventListener("click", () => { tuneCrop(row); });
  });

  pushAllBtn.disabled = rows.length === 0;
}

function defaultCrop(){
  // Heuristic crop (percentages based on typical MSF Crucible screenshot layout)
  return {
    attack: { x: .075, y: .235, w: .42, h: .22, cols: 5 },
    defense:{ x: .525, y: .235, w: .42, h: .22, cols: 5 }
  };
}

function tuneCrop(row){
  const crop = row.crop || defaultCrop();
  const vals = prompt("Edit crop as JSON (percents 0..1). Example:\\n" + JSON.stringify(crop, null, 2));
  if (!vals) return;
  try{
    const parsed = JSON.parse(vals);
    row.crop = parsed;
    alert("Saved crop. Click 'Match portraits' again.");
  }catch(e){
    alert("Invalid JSON.");
  }
}

async function ocrImage(file){
  const imgUrl = URL.createObjectURL(file);
  const worker = await Tesseract.createWorker("eng");
  const { data } = await worker.recognize(imgUrl);
  await worker.terminate();

  const text = (data.text || "").replace(/[, ]/g,"");
  const nums = Array.from(text.matchAll(/\d{6,9}/g)).map(m => parseInt(m[0],10));
  let n = "", o = "", q = "";
  if (nums.length >= 2){ n = nums[0]; o = nums[1]; }
  const vpMatch = (data.text || "").match(/(\d[\\d,\\.]*)\\s*VP/i);
  if (vpMatch){ q = parseInt(vpMatch[1].replace(/[^\\d]/g,""),10); }

  const id = crypto.randomUUID();
  const row = {
    id, imgUrl,
    season: defaultSeasonEl.value.trim(),
    room: defaultRoomEl.value.trim(),
    n, o, q,
    m: detectPunch(n,o),
    p: diffAbs(n,o),
    attackChars: ["","","","",""],
    defenseChars: ["","","","",""],
    crop: defaultCrop()
  };
  rows.push(row);
  render();
}

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  progressEl.textContent = `Processing ${files.length} image(s)...`;
  for (let i=0;i<files.length;i++){
    progressEl.textContent = `Processing ${i+1}/${files.length}...`;
    await ocrImage(files[i]);
  }
  progressEl.textContent = "Done.";
});

defaultSeasonEl.addEventListener("input", () => { rows.forEach(r => { if(!r.season) r.season = defaultSeasonEl.value.trim(); }); });
defaultRoomEl.addEventListener("input", () => { rows.forEach(r => { if(!r.room) r.room = defaultRoomEl.value.trim(); }); });

pushAllBtn.addEventListener("click", async () => { for (const r of rows){ await pushRow(r);} });

async function pushRow(r){
  if (!backendUrl){ alert("Set backendUrl in config.js to your Apps Script Web App URL."); return; }
  const payload = {
    season: r.season || "", room: r.room || "",
    n: r.n || "", o: r.o || "", m: r.m || "", p: r.p || "", q: r.q || "",
    attack: r.attackChars || [], defense: r.defenseChars || []
  };
  const qs = new URLSearchParams({ action: "addRow", data: JSON.stringify(payload), _: Date.now() }).toString();
  const res = await fetch(`${backendUrl}?${qs}`);
  const json = await res.json().catch(()=>({ok:false,error:"Invalid JSON"}));
  if (json.ok){ alert("Row added to sheet."); } else { alert("Failed: " + (json.error || "Unknown")); }
}

async function matchPortraits(row, cardEl){
  if (!portraitLib.length){
    alert("No portraits loaded. Either commit /portraits + manifest.json, or import a portrait ZIP.");
    return;
  }
  // Load screenshot
  const baseImg = await urlToImage(row.imgUrl);
  const crop = row.crop || defaultCrop();
  const attackNames = await sliceAndMatch(baseImg, crop.attack);
  const defenseNames = await sliceAndMatch(baseImg, crop.defense);
  row.attackChars = attackNames;
  row.defenseChars = defenseNames;
  render();
}

async function sliceAndMatch(baseImg, cfg){
  // cfg: {x,y,w,h,cols} as percents
  const W = baseImg.naturalWidth, H = baseImg.naturalHeight;
  const x = Math.round(cfg.x * W), y = Math.round(cfg.y * H);
  const w = Math.round(cfg.w * W), h = Math.round(cfg.h * H);
  const cols = cfg.cols || 5;
  const tileW = Math.floor(w / cols);
  const names = [];
  for (let i=0;i<cols;i++){
    const cx = x + i*tileW, cy = y, cw = tileW, ch = h;
    const cropImg = await cropToImage(baseImg, cx, cy, cw, ch);
    const hash = canvasHash(cropImg);
    const match = findBest(hash);
    names.push(match?.name || "");
  }
  return names;
}
function cropToImage(img, x, y, w, h){
  const c = document.createElement("canvas"), ct = c.getContext("2d");
  c.width = w; c.height = h;
  ct.drawImage(img, x, y, w, h, 0, 0, w, h);
  return urlToImage(c.toDataURL("image/png"));
}
function findBest(hash){
  let best = null, bestD = 1e9;
  for (const p of portraitLib){
    const d = hamming(hash, p.hash);
    if (d < bestD){ bestD = d; best = p; }
  }
  if (best && bestD <= portraitConfig.matchThreshold) return best;
  return null;
}

loadPortraitManifest();
