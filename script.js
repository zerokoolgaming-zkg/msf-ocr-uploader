/* Fully automatic pipeline:
 * - OCR on upload
 * - Portrait matching using aHash
 * - Auto push to Google Sheet
 */
const el = (id) => document.getElementById(id);
const cardsEl = el("cards");
const fileInput = el("fileInput");
const progressEl = el("progress");
const defaultSeasonEl = el("defaultSeason");
const defaultRoomEl = el("defaultRoom");

let rows = []; // rows per screenshot
let portraitLib = []; // {name, url, hash}

function fmtInt(s){ const num = String(s||"").replace(/[^\d]/g,""); return num?parseInt(num,10):""; }
function detectPunch(n,o){ if(n===""||o==="") return ""; return (o>n)?"Punch Up":"Punch Down"; }
function diffAbs(n,o){ if(n===""||o==="") return ""; return Math.abs(n-o); }

function canvasHash(img, size=portraitConfig.hashSize){
  const c = document.createElement("canvas"), ct = c.getContext("2d");
  c.width=size; c.height=size; ct.drawImage(img,0,0,size,size);
  const d = ct.getImageData(0,0,size,size).data;
  const gray=[]; for(let i=0;i<d.length;i+=4){ gray.push(Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])); }
  const avg = gray.reduce((a,b)=>a+b,0)/gray.length;
  let bits=""; for(const g of gray){ bits += g>=avg ? "1":"0"; }
  return bits;
}
function hamming(a,b){ const n=Math.min(a.length,b.length); let d=0; for(let i=0;i<n;i++) if(a[i]!==b[i]) d++; return d+Math.abs(a.length-b.length); }
function urlToImage(url){ return new Promise((res,rej)=>{ const img=new Image(); img.crossOrigin="anonymous"; img.onload=()=>res(img); img.onerror=rej; img.src=url; }); }

async function loadPortraits(){
  try{
    const res = await fetch("portraits/manifest.json", {cache:"no-store"});
    if (!res.ok) throw new Error("No manifest");
    const list = await res.json();
    let count = 0;
    portraitLib = [];
    for (const item of list.slice(0, portraitConfig.maxCompare)){
      const img = await urlToImage(item.url);
      const hash = canvasHash(img);
      portraitLib.push({ name:item.name, url:item.url, hash });
      count++;
      if (count % 100 === 0) console.log("Loaded portraits:", count);
    }
    console.log("Portraits loaded:", portraitLib.length);
  }catch(e){ console.warn("Portrait manifest not found; portrait match disabled.", e); }
}

function defaultCrop(){
  return {
    attack: { x: .075, y: .235, w: .42, h: .22, cols: 5 },
    defense:{ x: .525, y: .235, w: .42, h: .22, cols: 5 }
  };
}
function cropToImage(img, x, y, w, h){
  const c=document.createElement("canvas"), ct=c.getContext("2d");
  c.width=w; c.height=h; ct.drawImage(img, x,y,w,h, 0,0,w,h);
  return urlToImage(c.toDataURL("image/png"));
}
function findBest(hash){
  let best=null, bestD=1e9;
  for (const p of portraitLib){
    const d = hamming(hash, p.hash);
    if (d<bestD){ bestD=d; best=p; }
  }
  if (best && bestD <= portraitConfig.matchThreshold) return best;
  return null;
}

function render(){
  cardsEl.innerHTML="";
  rows.forEach((r,i)=>{
    const html = `
      <article class="card">
        <header><span>Screenshot ${i+1}</span></header>
        <div class="content">
          <img src="${r.imgUrl}" alt="screenshot" style="width:100%;border-radius:12px;border:1px solid #1b2a3b" />
          <div class="row">
            <input value="${r.season||""}" readonly/>
            <input value="${r.room||""}" readonly/>
          </div>
          <div class="row">
            <input value="Attack TCP: ${r.n||""}" readonly/>
            <input value="Defense TCP: ${r.o||""}" readonly/>
          </div>
          <div class="row">
            <input value="Punch: ${r.m||""}" readonly/>
            <input value="Diff: ${r.p||""}" readonly/>
          </div>
          <div class="row">
            <input value="VP: ${r.q||""}" readonly/>
            <input value="Pushed: ${r.pushed ? 'Yes' : 'No'}" readonly/>
          </div>
        </div>
      </article>`;
    cardsEl.insertAdjacentHTML("beforeend", html);
  });
}

async function sliceAndMatch(baseImg, cfg){
  if (!portraitLib.length) return ["","","","",""];
  const W = baseImg.naturalWidth, H = baseImg.naturalHeight;
  const x = Math.round(cfg.x * W), y = Math.round(cfg.y * H);
  const w = Math.round(cfg.w * W), h = Math.round(cfg.h * H);
  const cols = cfg.cols || 5;
  const tileW = Math.floor(w / cols);
  const names = [];
  for (let i=0;i<cols;i++){
    const cx = x + i*tileW, cy=y, cw=tileW, ch=h;
    const cropImg = await cropToImage(baseImg, cx, cy, cw, ch);
    const hash = canvasHash(cropImg);
    const hit = findBest(hash);
    names.push(hit ? hit.name : "");
  }
  return names;
}

async function pushRow(r){
  if (!backendUrl){ console.warn("backendUrl missing"); return; }
  const payload = {
    season: r.season||"", room: r.room||"",
    n: r.n||"", o: r.o||"", m: r.m||"", p: r.p||"", q: r.q||"",
    attack: r.attackChars||[], defense: r.defenseChars||[]
  };
  const qs = new URLSearchParams({ action:"addRow", data: JSON.stringify(payload), _: Date.now() }).toString();
  const res = await fetch(`${backendUrl}?${qs}`);
  const json = await res.json().catch(()=>({ok:false}));
  r.pushed = !!json.ok;
  render();
}

async function matchPortraits(r){
  try{
    const baseImg = await urlToImage(r.imgUrl);
    const crop = r.crop || defaultCrop();
    r.attackChars = await sliceAndMatch(baseImg, crop.attack);
    r.defenseChars = await sliceAndMatch(baseImg, crop.defense);
  }catch(e){ console.error("Portrait matching failed:", e); }
}

async function ocrImage(file){
  const imgUrl = URL.createObjectURL(file);
  const worker = await Tesseract.createWorker("eng");
  const { data } = await worker.recognize(imgUrl);
  await worker.terminate();

  const text = (data.text || "").replace(/[, ]/g,"");
  const nums = Array.from(text.matchAll(/\d{6,9}/g)).map(m=>parseInt(m[0],10));
  let n="", o="", q="";
  if (nums.length>=2){ n=nums[0]; o=nums[1]; }
  const vpMatch = (data.text||"").match(/(\d[\d,\.]*)\s*VP/i);
  if (vpMatch){ q = parseInt(vpMatch[1].replace(/[^\d]/g,""),10); }

  const row = {
    id: crypto.randomUUID(),
    imgUrl,
    season: defaultSeasonEl.value.trim(),
    room: defaultRoomEl.value.trim(),
    n, o, q,
    m: detectPunch(n,o),
    p: diffAbs(n,o),
    attackChars: ["","","","",""],
    defenseChars: ["","","","",""],
    pushed: false,
    crop: defaultCrop()
  };
  rows.push(row);
  render();

  // Fully automatic: match portraits then push row
  await matchPortraits(row);
  await pushRow(row);
}

fileInput.addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files||[]);
  progressEl.textContent = `Processing ${files.length} image(s)…`;
  for (let i=0;i<files.length;i++){
    progressEl.textContent = `Processing ${i+1}/${files.length}…`;
    await ocrImage(files[i]);
  }
  progressEl.textContent = "Done.";
});

loadPortraits();
