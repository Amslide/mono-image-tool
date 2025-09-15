const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const form = document.getElementById("convert-form");

const target = document.getElementById("target");
const resizeInp = document.getElementById("resize");

const jpgOpts = document.getElementById("jpg-opts");
const jpgQuality = document.getElementById("jpg-quality");
const jpgQualityVal = document.getElementById("jpg-quality-val");
const bg = document.getElementById("bg");

const pngOpts = document.getElementById("png-opts");
const pngCompression = document.getElementById("png-compression");
const pngCompressionVal = document.getElementById("png-compression-val");

const heicOpts = document.getElementById("heic-opts");
const heicQuality = document.getElementById("heic-quality");
const heicQualityVal = document.getElementById("heic-quality-val");
const heicLossless = document.getElementById("heic-lossless");

const strip = document.getElementById("strip");
const zip = document.getElementById("zip");

const progress = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const results = document.getElementById("results");

const fileList = document.getElementById("file-list");
const fileListSummary = document.getElementById("file-list-summary");
const fileListItems = document.getElementById("file-list-items");
let previewUrls = [];

jpgQuality.addEventListener("input", () => (jpgQualityVal.textContent = jpgQuality.value));
pngCompression.addEventListener("input", () => (pngCompressionVal.textContent = pngCompression.value));
heicQuality.addEventListener("input", () => (heicQualityVal.textContent = heicQuality.value));
target.addEventListener("change", reflectTarget);
function reflectTarget() {
  const t = target.value;
  jpgOpts.hidden = t !== "jpg";
  pngOpts.hidden = t !== "png";
  heicOpts.hidden = t !== "heic";
}
reflectTarget();

["dragenter", "dragover"].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove("dragover"); })
);

dropzone.addEventListener("drop", e => {
  const dt = e.dataTransfer;
  if (dt?.files?.length) {
    fileInput.files = dt.files;
    renderSelection(fileInput.files);
  }
});
fileInput.addEventListener("change", () => renderSelection(fileInput.files));

function renderSelection(fileListLike) {
  previewUrls.forEach(u => URL.revokeObjectURL(u)); previewUrls = [];
  const files = Array.from(fileListLike || []);
  if (!files.length) { fileList.hidden=true; fileListItems.innerHTML=""; fileListSummary.textContent=""; return; }
  const fmt = n => { const u=["B","KB","MB","GB"]; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++;} return `${v.toFixed(1)} ${u[i]}`; };

  let total = 0; fileListItems.innerHTML = "";
  for (const f of files) {
    total += f.size||0;
    const li=document.createElement("li"); li.className="file";
    const th=document.createElement("div"); th.className="thumb";
    let blob; try { blob=URL.createObjectURL(f); previewUrls.push(blob); } catch {}
    if (blob && f.type?.startsWith("image/")) {
      const img=document.createElement("img"); img.src=blob; img.alt=f.name;
      img.onerror=()=>{ th.innerHTML=`<span class="ph">${(f.name.split(".").pop()||"").toUpperCase()}</span>`; };
      th.appendChild(img);
    } else {
      th.innerHTML=`<span class="ph">${(f.name.split(".").pop()||"").toUpperCase()}</span>`;
    }
    const meta=document.createElement("div"); meta.className="meta";
    const name=document.createElement("div"); name.className="name"; name.textContent=f.name;
    const size=document.createElement("div"); size.className="size"; size.textContent=fmt(f.size||0);
    meta.appendChild(name); meta.appendChild(size);
    li.appendChild(th); li.appendChild(meta); fileListItems.appendChild(li);
  }
  fileListSummary.textContent = `${files.length} archivo(s) · ${fmt(total)}`;
  fileList.hidden = false;
}

form.addEventListener("submit", e => {
  e.preventDefault(); results.innerHTML=""; if(!fileInput.files.length) return alert("Selecciona al menos una imagen.");

  const fd = new FormData();
  for (const f of fileInput.files) fd.append("images", f, f.name);
  fd.append("target", target.value);
  fd.append("resize", resizeInp.value);
  fd.append("strip", strip.checked);
  fd.append("zip", zip.checked);
  if (target.value === "jpg") {
    fd.append("quality", jpgQuality.value);
    fd.append("background", bg.value);
  } else if (target.value === "png") {
    fd.append("pngCompression", pngCompression.value);
  } else if (target.value === "heic") {
    fd.append("quality", heicQuality.value);
    fd.append("lossless", heicLossless.checked);
  }

  progress.hidden=false; setProgress(0,"Subiendo…"); setDisabled(true);

  const xhr = new XMLHttpRequest(); xhr.open("POST","/api/convert");
  xhr.upload.onprogress = e => { if(e.lengthComputable){ const p=Math.round((e.loaded/e.total)*80); setProgress(p,`Subiendo… ${p}%`);} };
  xhr.onloadstart=()=>setProgress(0,"Subiendo…");
  xhr.onreadystatechange=()=>{ if(xhr.readyState===XMLHttpRequest.HEADERS_RECEIVED) setIndeterminate("Procesando…"); };
  xhr.onerror=()=>endWithError("Error de red o del servidor.");
  xhr.onload=()=>{
    clearIndeterminate(); setProgress(100,"Completado"); setDisabled(false);
    let data; try{ data=JSON.parse(xhr.responseText); } catch{ return endWithError("Respuesta inválida del servidor."); }
    if(xhr.status<200||xhr.status>=300) return endWithError(data?.error||"Fallo inesperado");
    renderResults(data);
  };
  xhr.send(fd);
});

function setDisabled(d){ form.querySelector("button[type=submit]").disabled=d; fileInput.disabled=d; target.disabled=d; }
function setProgress(v,l){ if(!progressBar.hasAttribute("value")) progressBar.value=0; progressBar.value=v; progressLabel.textContent=l||""; }
function setIndeterminate(l){ progressBar.removeAttribute("value"); progressLabel.textContent=l||"Procesando…"; }
function clearIndeterminate(){ progressBar.value=0; }

function renderResults(data){
  progress.hidden=true;
  const fmt=n=>{ const u=["B","KB","MB","GB"]; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++;} return `${v.toFixed(1)} ${u[i]}`; };
  if(data.zip){
    const saved=(data.results||[]).reduce((a,r)=>a+(r.saved||0),0);
    const card=document.createElement("div"); card.className="card";
    card.innerHTML=`<div><b>Conversión completada</b></div>
      <div class="kv"><span>Archivos: ${data.results.length}</span><span>Ahorro total: ${fmt(saved)}</span></div>
      <div><a class="download" href="${data.zip}">Descargar ZIP</a></div>`;
    results.appendChild(card); return;
  }
  let totalSaved=0;
  for(const f of data.files){
    totalSaved+=f.saved||0;
    const card=document.createElement("div"); card.className="card";
    card.innerHTML=`<div><b>${f.original}</b></div>
      <small>→ ${f.converted}</small>
      <div class="kv">
        <span>Original: ${fmt(f.originalSize)}</span>
        <span>Convertido: ${fmt(f.convertedSize)}</span>
        <span>Ahorro: ${fmt(f.saved)}</span>
      </div>
      <div><a class="download" href="${f.url}" download>Descargar</a></div>`;
    results.appendChild(card);
  }
  const sum=document.createElement("div"); sum.className="card";
  sum.innerHTML=`<b>Ahorro total:</b> ${fmt(totalSaved)}`;
  results.prepend(sum);
}
function endWithError(msg){ progress.hidden=true; setDisabled(false); results.innerHTML=`<div class="card">Error: ${msg}</div>`; }
