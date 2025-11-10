const el = id => document.getElementById(id);
const filesEl = el('files');
const logEl = el('log');
const statusEl = el('status');
const backendUrlEl = el('backendUrl');
const saveUrlBtn = el('saveUrl');

let backendUrl = localStorage.getItem('msf_backend_url') || DEFAULT_BACKEND_URL;
backendUrlEl.value = backendUrl;
saveUrlBtn.onclick = () => { backendUrl = backendUrlEl.value.trim(); localStorage.setItem('msf_backend_url', backendUrl); status(`Saved backend URL.`); };

function status(s){ statusEl.textContent = s; }

let portraitLib = [];
function fmtInt(s){ const t = String(s||'').replace(/[^\d]/g,''); return t?parseInt(t,10):''; }
function detectPunch(n,o){ if(n===''||o==='') return ''; return (o>n)?'Punch Up':'Punch Down'; }
function diffAbs(n,o){ if(n===''||o==='') return ''; return Math.abs(n-o); }
function urlToImage(url){ return new Promise((res,rej)=>{ const i=new Image(); i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=rej; i.src=url; }); }
function canvasHash(img, size=portraitConfig.hashSize){ const c=document.createElement('canvas'), ct=c.getContext('2d'); c.width=size; c.height=size; ct.drawImage(img,0,0,size,size); const d=ct.getImageData(0,0,size,size).data; const gray=[]; for(let i=0;i<d.length;i+=4){ gray.push(Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])); } const avg=gray.reduce((a,b)=>a+b,0)/gray.length; let bits=''; for(const g of gray){ bits+=g>=avg?'1':'0'; } return bits; }
function hamming(a,b){ const n=Math.min(a.length,b.length); let d=0; for(let i=0;i<n;i++) if(a[i]!==b[i]) d++; return d+Math.abs(a.length-b.length); }
function findBest(hash){ let best=null, bestD=1e9; for(const p of portraitLib){ const d=hamming(hash,p.hash); if(d<bestD){bestD=d; best=p;} } if(best&&bestD<=portraitConfig.matchThreshold) return best; return null; }

async function loadPortraits(){ try{ const res=await fetch('portraits/manifest.json',{cache:'no-store'}); if(!res.ok) throw new Error('no manifest'); const list=await res.json(); portraitLib=[]; let cnt=0; for(const item of list.slice(0, portraitConfig.maxCompare)){ const img=await urlToImage(item.url); portraitLib.push({name:item.name,url:item.url,hash:canvasHash(img)}); cnt++; if(cnt%100===0) status(`Loaded portraits: ${cnt}`);} status(`Loaded ${portraitLib.length} portraits.`);} catch(e){ status('Portrait manifest not found; name matching disabled.'); } }

function defaultCrop(){ return { attack:{x:.075,y:.235,w:.42,h:.22,cols:5}, defense:{x:.525,y:.235,w:.42,h:.22,cols:5} }; }
function cropToImage(img,x,y,w,h){ const c=document.createElement('canvas'), ct=c.getContext('2d'); c.width=w; c.height=h; ct.drawImage(img,x,y,w,h,0,0,w,h); return urlToImage(c.toDataURL('image/png')); }

async function matchPortraits(img,cfg){ if(!portraitLib.length) return {attack:['','','','',''],defense:['','','','','']}; const W=img.naturalWidth,H=img.naturalHeight; const outA=[],outD=[]; for(const side of ['attack','defense']){ const s=cfg[side]; const x=Math.round(s.x*W),y=Math.round(s.y*H),w=Math.round(s.w*W),h=Math.round(s.h*H); const cols=s.cols||5; const tileW=Math.floor(w/cols); for(let i=0;i<cols;i++){ const cx=x+i*tileW,cy=y,cw=tileW,ch=h; const sub=await cropToImage(img,cx,cy,cw,ch); const hit=findBest(canvasHash(sub)); (side==='attack'?outA:outD).push(hit?hit.name:''); } } return {attack:outA,defense:outD}; }

const HEADERS = ["Team Member 1","Team Member 2","Team Member 3","Team Member 4","Team Member 5","Counter Character 1","Counter Character 2","Counter Character 3","Counter Character 4","Counter Character 5","Season","ROOM","PUNCHUP OR DOWN","TCP TEAM","TCP COUNTER","TCP Difference","Victory Points"];
function ensureHeader(){ if(!logEl.value.trim().length){ logEl.value = HEADERS.join('\\t') + '\\n'; } }
function appendRowTSV(obj){ ensureHeader(); const vals=[...(obj.attack||['','','','','']).slice(0,5),...(obj.defense||['','','','','']).slice(0,5),obj.season||'',obj.room||'',obj.m||'',obj.n||'',obj.o||'',obj.p||'',obj.q||'']; logEl.value += vals.join('\\t') + '\\n'; logEl.scrollTop = logEl.scrollHeight; }

async function pushRow(r){ if(!backendUrl){ status('No backend URL set'); return; } const payload={season:r.season||'',room:r.room||'',n:r.n||'',o:r.o||'',m:r.m||'',p:r.p||'',q:r.q||'',attack:r.attack||[],defense:r.defense||[]}; const qs=new URLSearchParams({action:'addRow',data:JSON.stringify(payload),_:Date.now()}).toString(); const res=await fetch(`${backendUrl}?${qs}`); const ok=(await res.json().catch(()=>({ok:false}))).ok; status(ok?'Pushed row to Sheet.':'Push failed.'); }

async function processFile(file, seasonDefault, roomDefault){ const imgUrl=URL.createObjectURL(file); const worker=await Tesseract.createWorker('eng'); const {data}=await worker.recognize(imgUrl); await worker.terminate(); const text=(data.text||'').replace(/[, ]/g,''); const nums=Array.from(text.matchAll(/\\d{6,9}/g)).map(m=>parseInt(m[0],10)); let n='',o='',q=''; if(nums.length>=2){ n=nums[0]; o=nums[1]; } const vpMatch=(data.text||'').match(/(\\d[\\d,\\.]*)\\s*VP/i); if(vpMatch){ q=parseInt(vpMatch[1].replace(/[^\\d]/g,''),10); } const img=await urlToImage(imgUrl); const {attack,defense}=await matchPortraits(img, defaultCrop()); const row={season:seasonDefault,room:roomDefault,n,o,q,m:detectPunch(n,o),p:diffAbs(n,o),attack,defense}; appendRowTSV(row); await pushRow(row); }

filesEl.addEventListener('change', async (e)=>{ const files=Array.from(e.target.files||[]); if(!files.length) return; status(`Processing ${files.length} image(s)…`); const seasonDefault = prompt('Season (for all this batch)?','1') || ''; const roomDefault = prompt('Room (for all this batch)?','1') || ''; for(let i=0;i<files.length;i++){ status(`Processing ${i+1}/${files.length}…`); await processFile(files[i], seasonDefault, roomDefault); } status('Done.'); });

loadPortraits();