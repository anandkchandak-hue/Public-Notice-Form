// Each row: fixed standard column width per Newspaper+City, and BASE + ADD-ON rate per cm height, per category.
// Base = rate for the 1st column. Add-on = rate for each extra column beyond the 1st.
const DEFAULT_RATES = [
  {newspaper:"Times of India", city:"Hyderabad", standardWidth:3,
    publicNoticeRate:200, courtSummonRate:200, lostDocumentRate:200, obituaryRate:200},
  {newspaper:"Times of India", city:"Bangalore", standardWidth:3,
    publicNoticeRate:675, courtSummonRate:675, lostDocumentRate:675, obituaryRate:675},
];

// Height auto-calculation assumptions — tune to match your real layout
// Max characters that fit on one line, calibrated so a 3cm-wide column fits ~25 characters/line.
const CHARS_PER_CM_WIDTH = 25 / 3;
const LINE_HEIGHT_CM = 0.24;      // cm of height per line of text
const PADDING_CM = 0.15;          // extra cm for heading/border
const ROUND_TO_CM = 1;            // round the final height up to a whole cm (no decimals)

// Simulates real word-wrapping (like a layout engine would) instead of guessing from
// total character count — walks word by word, breaks the line once the next word
// would exceed maxCharsPerLine, and counts how many lines that actually takes.
function countWrappedLines(content, maxCharsPerLine){
  const paragraphs = content.split('\n');
  let totalLines = 0;
  paragraphs.forEach(para => {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if(words.length === 0){ totalLines += 1; return; } // blank line still takes a line
    let lineLen = 0;
    let linesInPara = 1;
    words.forEach(word => {
      const wordLen = word.length;
      if(lineLen === 0){
        lineLen = wordLen;
      } else if(lineLen + 1 + wordLen <= maxCharsPerLine){
        lineLen += 1 + wordLen;
      } else {
        linesInPara += 1;
        lineLen = wordLen;
      }
    });
    totalLines += linesInPara;
  });
  return totalLines;
}

function calculateHeight(content, widthCm){
  const maxCharsPerLine = Math.max(8, Math.round(widthCm * CHARS_PER_CM_WIDTH));
  const lines = countWrappedLines(content, maxCharsPerLine);
  let height = lines * LINE_HEIGHT_CM + PADDING_CM;
  height = Math.ceil(height / ROUND_TO_CM) * ROUND_TO_CM;
  return Math.round(height); // whole cm — no decimals
}

let rates = [];
let selectedDateValue = ''; // yyyy-mm-dd, set by the inline calendar
let calViewYear, calViewMonth;
let obituaryPhotoDataUrl = null;
let obituaryDesignImageDataUrl = null; // when set, bypasses templates entirely
let selectedGalleryDesign = 'design-cream-memorial'; // fallback built-in style if no real templates exist
let selectedRealTemplate = null; // holds a real uploaded template {imageUrl, photoZone, textZone, ...} once picked

// ============================================================
// PASTE YOUR FIREBASE CONFIG HERE (same one used in admin-script.js)
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDzpTMq8AoAMKn8VL_RlE7p2OqRiCMNliM",
  authDomain: "obituary-templates.firebaseapp.com",
  projectId: "obituary-templates",
  storageBucket: "obituary-templates.firebasestorage.app",
  messagingSenderId: "981896501332",
  appId: "1:981896501332:web:4743b7a66f9a4bceaf35c1"
};
// ============================================================
let fbDb = null;
function initFirebase(){
  if(fbDb || !window.firebase) return;
  try{
    firebase.initializeApp(firebaseConfig);
    fbDb = firebase.firestore();
  }catch(e){
    console.warn('Firebase not configured yet — design gallery will use built-in styles only.', e);
  }
}


function initCalendar(){
  const today = new Date();
  calViewYear = today.getFullYear();
  calViewMonth = today.getMonth();
  renderCalendar();
}

function renderCalendar(){
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').innerText = monthNames[calViewMonth] + ' ' + calViewYear;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d=>{
    const lbl = document.createElement('div');
    lbl.className = 'cal-day-label';
    lbl.innerText = d;
    grid.appendChild(lbl);
  });

  const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  for(let i = 0; i < firstDay; i++){
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  for(let day = 1; day <= daysInMonth; day++){
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    cell.innerText = day;
    const mm = String(calViewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const iso = `${calViewYear}-${mm}-${dd}`;
    if(iso === selectedDateValue) cell.classList.add('selected');
    cell.onclick = ()=>{
      selectedDateValue = iso;
      renderCalendar();
      updateSelectionSummary();
      if(selectedCat === 'Obituary') recalc();
    };
    grid.appendChild(cell);
  }
}

document.getElementById('calPrevBtn').addEventListener('click', ()=>{
  calViewMonth--;
  if(calViewMonth < 0){ calViewMonth = 11; calViewYear--; }
  renderCalendar();
});
document.getElementById('calNextBtn').addEventListener('click', ()=>{
  calViewMonth++;
  if(calViewMonth > 11){ calViewMonth = 0; calViewYear++; }
  renderCalendar();
});
initCalendar();


let lastTranslatedLang = null; // tracks what language the content box is currently in
let selectedCity = "", selectedPub = "", selectedCat = "", selectedSize = null;
let userEditedSize = false; // becomes true once staff manually change Width/Height

document.getElementById('manualW').addEventListener('input', ()=>{ userEditedSize = true; document.getElementById('resetSizeLink').style.display='block'; recalc(); });

document.getElementById('uploadImgBtn').addEventListener('click', ()=>{
  document.getElementById('imgFileInput').click();
});

// ===== Obituary: photo upload for the deceased =====
document.getElementById('obituaryPhotoBtn').addEventListener('click', ()=>{
  document.getElementById('obituaryPhotoInput').click();
});
document.getElementById('obituaryPhotoInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    obituaryPhotoDataUrl = ev.target.result;
    document.getElementById('obituaryPhotoPreview').src = obituaryPhotoDataUrl;
    document.getElementById('obituaryPhotoPreviewWrap').style.display = 'block';
    if(selectedCat === 'Obituary') recalc();
  };
  reader.readAsDataURL(file);
});

// ===== Obituary: upload an already-finished design (skips templates entirely) =====
document.getElementById('obituaryDesignUploadBtn').addEventListener('click', ()=>{
  document.getElementById('obituaryDesignFileInput').click();
});
document.getElementById('obituaryDesignFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('obituaryDesignUploadStatus');
  statusEl.className = 'status';
  statusEl.innerText = 'Loading design...';
  const reader = new FileReader();
  reader.onload = (ev)=>{
    const img = new Image();
    img.onload = ()=>{
      obituaryDesignImageDataUrl = ev.target.result;
      const widthCm = Math.max(1, Math.round(img.naturalWidth / PX_PER_CM));
      const heightCm = Math.max(1, Math.round(img.naturalHeight / PX_PER_CM));
      statusEl.className = 'status ok';
      statusEl.innerText = `Design loaded (${widthCm} x ${heightCm} cm). Rate will use this size.`;
      renderObituarySizeOptionsForUploadedDesign(widthCm, heightCm);
    };
    img.onerror = ()=>{
      statusEl.className = 'status err';
      statusEl.innerText = 'Could not read that image — try a different file.';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// When a ready-made design is uploaded, size is fixed to the image's own dimensions —
// just show that one size/rate instead of the usual 4 tiers.
function renderObituarySizeOptionsForUploadedDesign(widthCm, heightCm){
  const box = document.getElementById('obituarySizeOptions');
  if(!selectedCity || !selectedPub){
    box.innerHTML = '<div class="empty">Select City and Publication above to see the rate.</div>';
    selectedSize = null;
    checkReady();
    return;
  }
  const row = rates.find(r=>r.city===selectedCity && r.newspaper===selectedPub);
  const field = catField(selectedCat);
  const perSqCm = row ? (row[field] || 0) : 0;
  const rate = Math.round(widthCm * heightCm * perSqCm * 100) / 100;
  selectedSize = {width: widthCm, height: heightCm, rate: rate};
  box.innerHTML = `<div class="size-opt selected">${widthCm} x ${heightCm} cm<small>Rs ${rate.toFixed(2)}</small></div>`;
  checkReady();
}

// ===== Obituary: design gallery ("View More Designs") =====
const DESIGN_GALLERY = [
  {id:'design-royal-blue', label:'Royal Blue Frame', swatchColor:'#1a3a52', swatchText:'#f0d98c'},
  {id:'design-cream-memorial', label:'Cream Memorial', swatchColor:'#c9a869', swatchText:'#5a4321'},
  {id:'design-classic-frame', label:'Classic Frame', swatchColor:'#444444', swatchText:'#ffffff'},
  {id:'design-blue-anniversary', label:'Blue Anniversary', swatchColor:'#2f56b8', swatchText:'#f5d976'},
  {id:'design-golden-prayer', label:'Golden Prayer', swatchColor:'#9c1f1f', swatchText:'#f6ecd2'},
];

async function openDesignGallery(){
  initFirebase();

  const overlay = document.createElement('div');
  overlay.className = 'design-gallery-overlay';
  overlay.id = 'designGalleryOverlay';
  overlay.innerHTML = `
    <div class="design-gallery-box">
      <h3>Choose a Design</h3>
      <div class="note" id="galleryLoadingNote">Loading your uploaded templates...</div>
      <div class="design-gallery-grid" id="realTemplateGrid"></div>
      <div class="note" id="builtInDivider" style="margin-top:14px; display:none;">Or use a built-in style:</div>
      <div class="design-gallery-grid" id="builtInGrid" style="margin-top:6px;"></div>
      <button type="button" class="design-gallery-close" id="designGalleryCloseBtn">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('designGalleryCloseBtn').onclick = ()=>{ document.body.removeChild(overlay); };
  overlay.onclick = (e)=>{ if(e.target === overlay) document.body.removeChild(overlay); };

  // Built-in CSS styles are always shown as a fallback option
  const builtInGrid = document.getElementById('builtInGrid');
  builtInGrid.innerHTML = DESIGN_GALLERY.map(d => `
    <div class="design-gallery-item" data-id="${d.id}">
      <div class="design-gallery-swatch" style="background:${d.swatchColor}; color:${d.swatchText};">${d.label}</div>
    </div>`).join('');
  builtInGrid.querySelectorAll('.design-gallery-item').forEach(item=>{
    item.onclick = ()=>{
      selectedGalleryDesign = item.dataset.id;
      selectedRealTemplate = null;
      document.body.removeChild(overlay);
      if(selectedCat === 'Obituary' && selectedSize){
        document.getElementById('genBtn').click();
      }
    };
  });

  // Try to load your real uploaded templates from Firebase, filtered to this publication
  const loadingNote = document.getElementById('galleryLoadingNote');
  const realGrid = document.getElementById('realTemplateGrid');
  if(!fbDb){
    loadingNote.innerText = 'No template backend connected yet — showing built-in styles only.';
    document.getElementById('builtInDivider').style.display = 'block';
    return;
  }
  try{
    const snapshot = await fbDb.collection('obituaryTemplates').orderBy('createdAt', 'desc').get();
    const all = [];
    snapshot.forEach(doc => all.push({id: doc.id, ...doc.data()}));

    // Prefer templates matching this city + publication + obituary type; fall back to showing everything.
    const obitType = document.getElementById('obituaryTypeSelect').value;
    let matches = all.filter(t =>
      (!t.city || t.city.toLowerCase() === (selectedCity || '').toLowerCase()) &&
      (!t.publication || t.publication.toLowerCase() === (selectedPub || '').toLowerCase()) &&
      (!t.category || t.category === 'Any' || t.category === obitType)
    );
    // If nothing matches all three, relax to just city + obituary type (publication can vary within a city)
    if(matches.length === 0){
      matches = all.filter(t =>
        (!t.city || t.city.toLowerCase() === (selectedCity || '').toLowerCase()) &&
        (!t.category || t.category === 'Any' || t.category === obitType)
      );
    }
    if(matches.length === 0) matches = all;

    if(matches.length === 0){
      loadingNote.innerText = 'No templates uploaded yet — showing built-in styles only.';
      document.getElementById('builtInDivider').style.display = 'block';
      return;
    }

    loadingNote.style.display = 'none';
    document.getElementById('builtInDivider').style.display = 'block';
    realGrid.innerHTML = matches.map(t => `
      <div class="design-gallery-item" data-tid="${t.id}">
        <img src="${t.imageUrl}" alt="${t.name}" style="width:100%; height:80px; object-fit:cover; border-radius:3px; margin-bottom:6px;">
        <div style="font-size:.72rem;">${t.name}</div>
      </div>`).join('');
    realGrid.querySelectorAll('.design-gallery-item').forEach(item=>{
      item.onclick = ()=>{
        const chosen = matches.find(t => t.id === item.dataset.tid);
        selectedRealTemplate = chosen;
        document.body.removeChild(overlay);
        if(selectedCat === 'Obituary' && selectedSize){
          document.getElementById('genBtn').click();
        }
      };
    });
  }catch(e){
    console.error(e);
    loadingNote.innerText = 'Could not reach the template backend — showing built-in styles only.';
    document.getElementById('builtInDivider').style.display = 'block';
  }
}

let tesseractLoaded = false;
function loadTesseract(){
  return new Promise((resolve, reject)=>{
    if(tesseractLoaded && window.Tesseract){ resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = ()=>{ tesseractLoaded = true; resolve(); };
    script.onerror = ()=>reject(new Error('Could not load text-reading library'));
    document.head.appendChild(script);
  });
}

let pdfJsLoaded = false;
function loadPdfJs(){
  return new Promise((resolve, reject)=>{
    if(pdfJsLoaded && window.pdfjsLib){ resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = ()=>{
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      pdfJsLoaded = true;
      resolve();
    };
    script.onerror = ()=>reject(new Error('Could not load PDF-reading library'));
    document.head.appendChild(script);
  });
}

let mammothLoaded = false;
function loadMammoth(){
  return new Promise((resolve, reject)=>{
    if(mammothLoaded && window.mammoth){ resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
    script.onload = ()=>{ mammothLoaded = true; resolve(); };
    script.onerror = ()=>reject(new Error('Could not load Word-reading library'));
    document.head.appendChild(script);
  });
}

async function extractPdfText(file){
  await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({data: arrayBuffer}).promise;
  let fullText = '';
  for(let i = 1; i <= pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map(item => item.str).join(' ') + '\n';
  }
  return fullText.trim();
}

async function extractDocxText(file){
  await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({arrayBuffer});
  let text = (result && result.value) ? result.value.trim() : '';

  // Fallback: some documents (e.g. text mostly inside tables) extract better via HTML,
  // so if the raw-text method comes back empty, try converting to HTML and stripping tags.
  if(!text){
    const htmlResult = await window.mammoth.convertToHtml({arrayBuffer});
    if(htmlResult && htmlResult.value){
      const tmp = document.createElement('div');
      tmp.innerHTML = htmlResult.value;
      text = (tmp.innerText || tmp.textContent || '').trim();
    }
  }

  if(result && result.messages && result.messages.length){
    console.warn('mammoth messages:', result.messages);
  }
  return text;
}

function fileToCleanDataUrl(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = ()=>reject(new Error('Could not decode that image in the browser (unsupported format, e.g. HEIC).'));
      img.src = e.target.result;
    };
    reader.onerror = ()=>reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

document.getElementById('imgFileInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('ocrStatus');
  const fileName = file.name.toLowerCase();
  const isImage = file.type.startsWith('image/');
  const isPDF = file.type === 'application/pdf' || fileName.endsWith('.pdf');
  const isDocx = fileName.endsWith('.docx');
  const isDoc = fileName.endsWith('.doc') && !isDocx;
  const isTxt = file.type === 'text/plain' || fileName.endsWith('.txt');

  statusEl.className = 'status';
  let text = '';

  try{
    if(isImage){
      const langCode = document.getElementById('ocrLangSelect').value;
      statusEl.innerText = 'Reading text from image... this can take a few seconds (first time may download language data).';
      await loadTesseract();
      let ocrInput = file;
      try{
        ocrInput = await fileToCleanDataUrl(file);
      }catch(convErr){
        console.warn('Could not pre-convert image, trying original file instead:', convErr);
      }
      const result = await Tesseract.recognize(ocrInput, langCode);
      text = (result && result.data && result.data.text) ? result.data.text.trim() : '';
    } else if(isPDF){
      statusEl.innerText = 'Reading text from PDF...';
      text = await extractPdfText(file);
    } else if(isDocx){
      statusEl.innerText = 'Reading text from Word document...';
      text = await extractDocxText(file);
    } else if(isTxt){
      statusEl.innerText = 'Reading text file...';
      text = (await file.text()).trim();
    } else if(isDoc){
      statusEl.className = 'status err';
      statusEl.innerText = 'Old .doc format isn\'t supported — please save it as .docx or PDF and upload again.';
      e.target.value = '';
      return;
    } else {
      statusEl.className = 'status err';
      statusEl.innerText = 'Unsupported file type — please upload an image, PDF, Word (.docx), or text file.';
      e.target.value = '';
      return;
    }

    if(text){
      const existing = document.getElementById('content').value.trim();
      document.getElementById('content').value = existing ? (existing + '\n' + text) : text;
      statusEl.className = 'status ok';
      statusEl.innerText = 'Text extracted — please check it for accuracy before generating the ad.';
      lastTranslatedLang = null;
      suggestSize();
      recalc();
    } else {
      statusEl.className = 'status err';
      statusEl.innerText = 'Could not find readable text in that file — try typing it manually.';
    }
  }catch(err){
    console.error('File extraction error:', err);
    statusEl.className = 'status err';
    statusEl.innerText = isImage
      ? 'Could not read that image — if it\'s a HEIC/iPhone photo or unusual format, try re-saving it as JPG or PNG and upload again, or type the content manually.'
      : 'Could not read that file — try typing the content manually.';
  }
  e.target.value = '';
});

// Breaks long text into pieces short enough to translate as separate requests
// (avoids hitting URL-length limits with the free translation service).
function chunkTextForTranslation(text, maxChunkLen){
  const paragraphs = text.split('\n');
  const chunks = [];
  let current = '';
  paragraphs.forEach(para => {
    let remaining = para;
    while(remaining.length > maxChunkLen){
      let cut = remaining.lastIndexOf(' ', maxChunkLen);
      if(cut <= 0) cut = maxChunkLen;
      const piece = remaining.slice(0, cut);
      if((current + '\n' + piece).length > maxChunkLen && current){
        chunks.push(current);
        current = piece;
      } else {
        current = current ? current + '\n' + piece : piece;
      }
      remaining = remaining.slice(cut).trim();
    }
    if((current + '\n' + remaining).length > maxChunkLen && current){
      chunks.push(current);
      current = remaining;
    } else {
      current = current ? current + '\n' + remaining : remaining;
    }
  });
  if(current) chunks.push(current);
  return chunks;
}

async function translateChunk(text, sourceLang, targetLang){
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl='
    + sourceLang + '&tl=' + targetLang + '&dt=t&q=' + encodeURIComponent(text)
    + '&_=' + Date.now();
  const res = await fetch(url);
  if(!res.ok) throw new Error('translate request failed with status ' + res.status);
  const data = await res.json();
  return (data && data[0]) ? data[0].map(seg => seg[0]).join('') : '';
}

document.getElementById('translateBtn').addEventListener('click', async ()=>{
  const contentEl = document.getElementById('content');
  const text = contentEl.value.trim();
  const statusEl = document.getElementById('translateStatus');
  if(!text){
    statusEl.className = 'status err';
    statusEl.innerText = 'Type or upload some content first, then translate it.';
    return;
  }
  const targetLang = document.getElementById('translateLangSelect').value;

  if(targetLang === lastTranslatedLang){
    statusEl.className = 'status err';
    statusEl.innerText = 'The content is already in that language.';
    return;
  }

  statusEl.className = 'status';
  try{
    // Use the known current language as the source when we have it (more reliable than
    // auto-detect for translating back), otherwise let Google auto-detect the first time.
    const sourceLang = lastTranslatedLang || 'auto';
    const chunks = chunkTextForTranslation(text, 450);
    let translatedParts = [];

    for(let i = 0; i < chunks.length; i++){
      statusEl.innerText = chunks.length > 1
        ? `Translating part ${i+1} of ${chunks.length}...`
        : 'Translating...';
      const part = await translateChunk(chunks[i], sourceLang, targetLang);
      if(!part) throw new Error('empty translation response for a chunk');
      translatedParts.push(part);
    }

    const translated = translatedParts.join('\n').trim();
    if(translated){
      contentEl.value = translated;
      lastTranslatedLang = targetLang;
      statusEl.className = 'status ok';
      statusEl.innerText = 'Translated — please check the wording before generating the ad.';
      suggestSize();
      recalc();
    } else {
      throw new Error('empty translation overall');
    }
  }catch(err){
    console.error('Translate error:', err);
    // If translating with a remembered source language failed, retry once with auto-detect
    // before giving up — the remembered language can occasionally be wrong.
    if(lastTranslatedLang){
      lastTranslatedLang = null;
      statusEl.innerText = 'Retrying...';
      document.getElementById('translateBtn').click();
      return;
    }
    statusEl.className = 'status err';
    statusEl.innerText = 'Could not translate right now — please check the content manually or try again.';
  }
});
document.getElementById('manualH').addEventListener('input', ()=>{ userEditedSize = true; document.getElementById('resetSizeLink').style.display='block'; recalc(); });
document.getElementById('content').addEventListener('input', ()=>{
  lastTranslatedLang = null;
  if(selectedCat === 'Obituary'){
    obituaryDesignImageDataUrl = null;
    selectedRealTemplate = null;
    renderObituarySizeOptions();
  } else {
    suggestSize();
    recalc();
  }
});
document.getElementById('resetSizeLink').addEventListener('click', ()=>{
  userEditedSize = false;
  document.getElementById('resetSizeLink').style.display='none';
  suggestSize();
  recalc();
});

async function loadRates(){
  const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1rGWoaMokSmx3jaJhP0_4_QSsdLLvQebZILtvrKJfFMc/gviz/tq?tqx=out:csv&gid=862575659";
  const statusEl = document.getElementById('sheetStatus');
  try{
    const res = await fetch(SHEET_CSV_URL + "&_=" + Date.now());
    if(!res.ok) throw new Error("fetch failed");
    const text = await res.text();
    const parsed = parseRatesCSV(text);
    if(parsed.length){
      rates = parsed;
      if(statusEl){
        statusEl.className = 'status ok';
        statusEl.innerText = 'Rates loaded from Google Sheet (' + rates.length + ' rows).';
      }
    } else {
      throw new Error("no rate rows found in sheet");
    }
  }catch(e){
    // Fall back to whatever was last saved locally, or the built-in defaults
    try{
      const local = await window.storage.get('rates', true);
      rates = local && local.value ? JSON.parse(local.value) : DEFAULT_RATES;
    }catch(e2){
      rates = DEFAULT_RATES;
    }
    if(statusEl){
      statusEl.className = 'status err';
      statusEl.innerText = 'Could not reach Google Sheet — using last saved rates instead.';
    }
  }
  renderCityList();
}

// Parses the published CSV. Expects headers: Newspaper, City, Standard Column Width (cm),
// Public Notice Base Rate (per cm), Public Notice Add-on Rate (per cm),
// Court Summon Base Rate (per cm), Court Summon Add-on Rate (per cm),
// Lost Document Base Rate (per cm), Lost Document Add-on Rate (per cm), ...
// Skips order rows (rows where Customer Name is filled) and note/blank rows.
function parseRatesCSV(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if(lines.length < 2) return [];
  const parseLine = (line) => {
    const out = []; let cur = ''; let inQuotes = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(ch === '"'){
        if(inQuotes && line[i+1] === '"'){ cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if(ch === ',' && !inQuotes){
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(v=>v.trim());
  };
  const headers = parseLine(lines[0]).map(h=>h.toLowerCase());
  const idx = (name) => headers.findIndex(h => h.includes(name));
  const iNews = idx('newspaper');
  const iCity = idx('city');
  const iStdW = idx('standard width');
  const iPN = idx('public notice');
  const iCS = idx('court summon');
  const iLD = idx('lost document');
  const iOB = idx('obituary');
  const iCust = idx('customer name');
  if(iNews < 0 || iCity < 0) return [];

  const out = [];
  for(let i=1;i<lines.length;i++){
    const cols = parseLine(lines[i]);
    const newspaper = cols[iNews] || '';
    const city = cols[iCity] || '';
    const customer = iCust >= 0 ? (cols[iCust] || '') : '';
    if(!newspaper || !city) continue;   // skip blank/note rows
    if(customer) continue;              // skip order rows, keep only rate rows
    out.push({
      newspaper, city,
      standardWidth: iStdW >= 0 ? (Number(cols[iStdW]) || 3) : 3,
      publicNoticeRate: Number(cols[iPN]) || 0,
      courtSummonRate: Number(cols[iCS]) || 0,
      lostDocumentRate: Number(cols[iLD]) || 0,
      obituaryRate: iOB >= 0 ? (Number(cols[iOB]) || 0) : 0,
    });
  }
  return out;
}

function uniq(arr){ return [...new Set(arr)]; }

function renderCityList(){
  const cities = uniq(rates.map(r=>r.city));
  const list = document.getElementById('cityList');
  list.innerHTML = cities.map(c=>`<div data-city="${c}">${c}</div>`).join('');
  list.querySelectorAll('div').forEach(d=>{
    d.onclick = ()=>{
      document.getElementById('cityInput').value = d.dataset.city;
      selectedCity = d.dataset.city;
      list.style.display = 'none';
      renderPubSelect();
      updateSelectionSummary();
      checkReady();
    };
  });
}

document.getElementById('cityInput').addEventListener('input', (e)=>{
  const v = e.target.value.toLowerCase();
  const list = document.getElementById('cityList');
  const cities = uniq(rates.map(r=>r.city)).filter(c=>c.toLowerCase().includes(v));
  list.innerHTML = cities.map(c=>`<div data-city="${c}">${c}</div>`).join('');
  list.querySelectorAll('div').forEach(d=>{
    d.onclick = ()=>{
      document.getElementById('cityInput').value = d.dataset.city;
      selectedCity = d.dataset.city;
      list.style.display = 'none';
      renderPubSelect();
      updateSelectionSummary();
      checkReady();
    };
  });
  list.style.display = cities.length ? 'block' : 'none';
  selectedCity = "";
  checkReady();
});
document.getElementById('cityInput').addEventListener('focus', ()=>{
  document.getElementById('cityList').style.display = 'block';
});
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.dropdown')) document.getElementById('cityList').style.display='none';
});

function renderPubSelect(){
  const sel = document.getElementById('pubSelect');
  const pubs = uniq(rates.filter(r=>r.city===selectedCity).map(r=>r.newspaper));
  sel.innerHTML = '<option value="">Select publication</option>' + pubs.map(p=>`<option value="${p}">${p}</option>`).join('');
  selectedPub = "";
  selectedSize = null;
  document.getElementById('calcSection').style.display='none';
}

document.getElementById('pubSelect').addEventListener('change', (e)=>{
  selectedPub = e.target.value;
  userEditedSize = false;
  updateSelectionSummary();
  if(selectedCat === 'Obituary'){
    renderObituarySizeOptions();
  } else {
    suggestSize();
    recalc();
  }
});
function applyCategorySetup(){
  selectedCat = document.getElementById('catSelect').value;
  const isObituary = (selectedCat === 'Obituary');
  document.getElementById('manualSizeRow').style.display = isObituary ? 'none' : '';
  document.getElementById('resetSizeLink').style.display = 'none';
  document.getElementById('obituarySizeSection').style.display = isObituary ? 'block' : 'none';
  document.getElementById('obituaryTypeRow').style.display = isObituary ? '' : 'none';
  document.getElementById('galleryDesignRow').style.display = isObituary ? '' : 'none';
  document.getElementById('ocrUploadCorner').style.display = isObituary ? 'none' : '';
  document.getElementById('obituaryUploadSection').style.display = isObituary ? '' : 'none';
  document.getElementById('translateRow').style.display = 'none'; // kept hidden for a fast, simple customer flow
  updateSelectionSummary();
  if(isObituary){
    obituaryDesignImageDataUrl = null;
    selectedRealTemplate = null;
    renderObituarySizeOptions();
  } else {
    selectedSize = null;
    checkReady();
  }
  recalc();
}
document.getElementById('catSelect').addEventListener('change', applyCategorySetup);

// This page is Obituary-only now — set it up immediately without waiting for a user click.
applyCategorySetup();

document.getElementById('obituaryTypeSelect').addEventListener('change', ()=>{
  if(selectedCat === 'Obituary') recalc();
});

// Builds up to 4 selectable size tiers for Obituary ads: the first is the normal
// content-based suggested size, and each next tier doubles both width and height.
function renderObituarySizeOptions(){
  const box = document.getElementById('obituarySizeOptions');
  const content = document.getElementById('content').value.trim();
  if(!selectedCity || !selectedPub || !content){
    box.innerHTML = '<div class="empty">Select City and Publication above, then type content, to see size options.</div>';
    selectedSize = null;
    checkReady();
    return;
  }
  const row = rates.find(r=>r.city===selectedCity && r.newspaper===selectedPub);
  const stdWidth = (row && row.standardWidth) ? row.standardWidth : 3;
  const baseHeight = calculateHeight(content, stdWidth);

  const tiers = [];
  let w = stdWidth, h = baseHeight;
  for(let i = 0; i < 4; i++){
    tiers.push({width: w, height: h});
    w = w * 2;
    h = h * 2;
  }

  const field = catField(selectedCat);
  const perSqCm = row ? (row[field] || 0) : 0;

  box.innerHTML = tiers.map((t, i) => {
    const rate = Math.round(t.width * t.height * perSqCm * 100) / 100;
    return `<div class="size-opt${i===0 ? ' selected' : ''}" data-idx="${i}">
      ${t.width} x ${t.height} cm
      <small>Rs ${rate.toFixed(2)}</small>
    </div>`;
  }).join('');

  box.querySelectorAll('.size-opt').forEach(el=>{
    el.onclick = ()=>{
      box.querySelectorAll('.size-opt').forEach(o=>o.classList.remove('selected'));
      el.classList.add('selected');
      const t = tiers[el.dataset.idx];
      const rate = Math.round(t.width * t.height * perSqCm * 100) / 100;
      selectedSize = {width: t.width, height: t.height, rate: rate};
      checkReady();
    };
  });

  // Auto-select the basic (content-based) size by default, so staff don't have to click —
  // they can still click a different tier above if they want a bigger ad.
  const basic = tiers[0];
  const basicRate = Math.round(basic.width * basic.height * perSqCm * 100) / 100;
  selectedSize = {width: basic.width, height: basic.height, rate: basicRate};
  checkReady();
}

// Auto-fills Width/Height with a suggested size (standard width + content-based height),
// but only while staff haven't manually typed their own numbers.
function suggestSize(){
  if(userEditedSize) return;
  if(!selectedCity || !selectedPub) return;
  const row = rates.find(r=>r.city===selectedCity && r.newspaper===selectedPub);
  const stdWidth = (row && row.standardWidth) ? row.standardWidth : 3;
  const content = document.getElementById('content').value.trim();
  const height = content ? calculateHeight(content, stdWidth) : stdWidth;
  document.getElementById('manualW').value = stdWidth;
  document.getElementById('manualH').value = height;
}

function catField(cat){
  if(cat==='Public Notice') return 'publicNoticeRate';
  if(cat==='Court Summon') return 'courtSummonRate';
  if(cat==='Lost Document') return 'lostDocumentRate';
  if(cat==='Obituary') return 'obituaryRate';
  return null;
}

function recalc(){
  const calcSection = document.getElementById('calcSection');
  const box = document.getElementById('calcBox');

  if(selectedCat === 'Obituary'){
    calcSection.style.display='none';
    return; // sizing/rate for Obituary is handled entirely by renderObituarySizeOptions()
  }

  selectedSize = null;

  if(!selectedCity || !selectedPub || !selectedCat){
    calcSection.style.display='none';
    checkReady();
    return;
  }
  const row = rates.find(r=>r.city===selectedCity && r.newspaper===selectedPub);
  if(!row){
    box.innerHTML = '<div class="empty">No rate found for this city/publication yet — add one under Admin below.</div>';
    calcSection.style.display='block';
    checkReady();
    return;
  }
  const field = catField(selectedCat);

  const w = parseFloat(document.getElementById('manualW').value);
  const h = parseFloat(document.getElementById('manualH').value);
  if(!w || !h){
    box.innerHTML = '<div class="empty">Enter width and height above to see the rate.</div>';
    calcSection.style.display='block';
    checkReady();
    return;
  }

  const perSqCm = row[field] || 0;
  const rate = Math.round(w * h * perSqCm * 100) / 100;
  const rateDisplay = rate.toFixed(2);
  selectedSize = {width: w, height: h, rate: rate};
  box.innerHTML = `
    Size: <b>${w} x ${h} cm</b><br>
    ${w} x ${h} x Rs${perSqCm} = <span class="amount">Rs ${rateDisplay}</span>`;
  calcSection.style.display='block';
  checkReady();
}

function checkReady(){
  const ready = selectedCity && selectedPub && selectedCat && selectedSize;
  document.getElementById('genBtn').disabled = !ready;
}

const OBITUARY_TYPE_HEADINGS = {
  'Obituary Ad': 'IN LOVING MEMORY',
  '1st Year Anniversary': '1ST ANNIVERSARY REMEMBRANCE',
  'Memorial Ad': 'FOREVER IN OUR HEARTS',
  'Death Announcement': 'WITH DEEP SORROW',
};

function getDefaultHeading(category){
  if(category === 'Lost Document') return 'LOST AND FOUND';
  if(category === 'Obituary'){
    const typeSel = document.getElementById('obituaryTypeSelect');
    const type = typeSel ? typeSel.value : 'Obituary Ad';
    return OBITUARY_TYPE_HEADINGS[type] || 'IN LOVING MEMORY';
  }
  return category.toUpperCase();
}

function computeBaseSizes(widthCm, heightCm){
  const head = Math.round(Math.max(7, Math.min(13, heightCm*1.6)));
  const body = Math.round(Math.max(5.5, Math.min(8, widthCm*1.1)));
  return {head, body};
}

// Renders a real uploaded template image as the full background, with the customer's
// photo and typed content overlaid exactly in the zones marked in the backend admin page.
function buildArtworkFromRealTemplate(template, content, widthCm, heightCm){
  const safeContent = content.replace(/</g,'&lt;');
  const base = computeBaseSizes(widthCm, heightCm);
  const pz = template.photoZone || {left:35, top:5, width:30, height:30};
  const tz = template.textZone || {left:10, top:60, width:80, height:35};

  // Match the text to the template's own look, as set by staff in the backend —
  // font, colour, alignment, and base size — instead of a generic default.
  const font = template.textFont || "Georgia, 'Times New Roman', serif";
  const color = template.textColor || '#333333';
  const align = template.textAlign || 'center';
  const sizePt = template.textSize ? Number(template.textSize) : base.body;
  loadTemplateFont(font);

  const photoInner = obituaryPhotoDataUrl
    ? `<img src="${obituaryPhotoDataUrl}" alt="Photo" style="width:100%; height:100%; object-fit:cover;">`
    : '';

  const canvasStyle = `width:${widthCm}cm; height:${heightCm}cm; position:relative; overflow:hidden;`;

  return `
    <div class="artwork-scale-wrap">
      <div class="artwork-canvas" id="artworkCanvas" style="${canvasStyle}">
        <img src="${template.imageUrl}" alt="${template.name}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:0;">
        <div style="position:absolute; left:${pz.left}%; top:${pz.top}%; width:${pz.width}%; height:${pz.height}%; overflow:hidden; z-index:1;">
          ${photoInner}
        </div>
        <div id="artworkBodyText" contenteditable="true" data-base-size="${sizePt}"
          style="position:absolute; left:${tz.left}%; top:${tz.top}%; width:${tz.width}%; height:${tz.height}%; overflow:hidden; z-index:1; text-align:${align}; font-size:${sizePt}pt; font-family:${font}; color:${color};">${safeContent}</div>
      </div>
    </div>
    <div class="dims" id="artworkDims">Actual print size: ${widthCm} cm (W) x ${heightCm} cm (H) — ${selectedPub}</div>
    <div class="overflow-warning" id="overflowWarning" style="display:none;">
      ⚠ Content doesn't fully fit the marked text area — shorten the content or ask for the zone to be resized in the backend.
    </div>`;
}

// Loads the Google Font used by a real template, if it isn't already loaded, so the
// customer's overlaid text actually renders in that font instead of falling back to a default.
const loadedTemplateFonts = new Set();
function loadTemplateFont(fontFamilyCss){
  const match = fontFamilyCss.match(/'([^']+)'/);
  const fontName = match ? match[1] : null;
  if(!fontName || loadedTemplateFonts.has(fontName)) return;
  const googleFontsList = ['Playfair Display','Cormorant Garamond','Merriweather','Great Vibes','Dancing Script','Montserrat'];
  if(!googleFontsList.includes(fontName)) return; // websafe font, nothing to load
  loadedTemplateFonts.add(fontName);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + fontName.replace(/ /g, '+') + '&display=swap';
  document.head.appendChild(link);
}

function buildArtwork(category, content, widthCm, heightCm, headingTextOverride){
  const safeContent = content.replace(/</g,'&lt;');
  const isBanner = (category === 'Public Notice' || category === 'Lost Document');
  const isObituary = (category === 'Obituary');
  const headingText = headingTextOverride || getDefaultHeading(category);
  const base = computeBaseSizes(widthCm, heightCm);
  const dateVal = selectedDateValue;
  const dateDisplay = dateVal ? new Date(dateVal + 'T00:00:00').toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '';

  const canvasStyle = `width:${widthCm}cm; height:${heightCm}cm;`;

  let inner;
  if(isObituary){
    const photoInner = obituaryPhotoDataUrl
      ? `<img src="${obituaryPhotoDataUrl}" alt="Photo" style="width:100%; height:100%; object-fit:cover;">`
      : 'Photo';
    inner = `
      <div class="tmpl-obituary ${selectedGalleryDesign}">
        <div class="heading" id="artworkHeading" contenteditable="true" data-base-size="${base.head}" style="font-size:${base.head}pt;">${headingText}</div>
        <div class="obituary-photo" contenteditable="false">${photoInner}</div>
        ${dateDisplay ? `<div class="obituary-date">${dateDisplay}</div>` : ''}
        <div class="obituary-divider"></div>
        <div class="body-text" id="artworkBodyText" contenteditable="true" data-base-size="${base.body}" style="font-size:${base.body}pt;">${safeContent}</div>
      </div>`;
  } else if(isBanner){
    inner = `
      <div class="tmpl-banner">
        <div class="heading" id="artworkHeading" contenteditable="true" data-base-size="${base.head}" style="font-size:${base.head}pt;">${headingText}</div>
        <div class="body-text" id="artworkBodyText" contenteditable="true" data-base-size="${base.body}" style="font-size:${base.body}pt;">${safeContent}</div>
      </div>`;
  } else {
    inner = `
      <div class="tmpl-plain">
        <div class="heading" id="artworkHeading" contenteditable="true" data-base-size="${base.head}" style="font-size:${base.head}pt;">${headingText}</div>
        <div class="body-text" id="artworkBodyText" contenteditable="true" data-base-size="${base.body}" style="font-size:${base.body}pt;">${safeContent}</div>
      </div>`;
  }

  return `
    <div class="artwork-scale-wrap">
      <div class="artwork-canvas" id="artworkCanvas" style="${canvasStyle}">${inner}</div>
    </div>
    <div class="resize-hint">↘ Drag the bottom-right corner of the artwork to resize it</div>
    <div class="dims" id="artworkDims">Actual print size: ${widthCm} cm (W) x ${heightCm} cm (H) — ${selectedPub}</div>
    <div class="overflow-warning" id="overflowWarning" style="display:none;">
      ⚠ Content doesn't fully fit this size — increase Height, or shorten the content.
    </div>`;
}

// Fills a size <select> with actual point-size options (not vague labels), scaled off
// the artwork's own calculated base size, e.g. base 7pt -> "5.6pt, 7pt, 8.1pt, 9.1pt"
function populateSizeSelect(selectEl, baseSize){
  const normalVal = Math.min(30, Math.max(4, Math.round(baseSize)));
  let options = '';
  for(let pt = 4; pt <= 30; pt++){
    options += `<option value="${pt}">${pt}pt</option>`;
  }
  selectEl.innerHTML = options;
  selectEl.dataset.normalValue = normalVal;
  selectEl.value = normalVal;
}

document.getElementById('genBtn').addEventListener('click', ()=>{
  const content = document.getElementById('content').value.trim();

  document.getElementById('rateBox').innerHTML = `
    ${selectedPub} — ${selectedCity} — ${selectedCat} — ${selectedSize.width}x${selectedSize.height} cm<br>
    <span class="amount">Rs ${selectedSize.rate.toFixed(2)}</span>`;

  // Ready-made design uploaded: skip templates/toolbar entirely, just show the design + rate.
  if(selectedCat === 'Obituary' && obituaryDesignImageDataUrl){
    document.getElementById('artworkBox').innerHTML = `
      <div class="artwork-scale-wrap">
        <div class="artwork-canvas" id="artworkCanvas" style="width:${selectedSize.width}cm; height:${selectedSize.height}cm; overflow:hidden;">
          <img src="${obituaryDesignImageDataUrl}" alt="Uploaded design" style="width:100%; height:100%; object-fit:cover;">
        </div>
      </div>
      <div class="dims" id="artworkDims">Actual print size: ${selectedSize.width} cm (W) x ${selectedSize.height} cm (H) — ${selectedPub}</div>`;
    document.getElementById('artworkToolbar').style.display = 'none';
    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('resultCard').scrollIntoView({behavior:'smooth'});
    attachResizeTracking();
    return;
  }

  // A real uploaded template was picked from "View More Designs": overlay the customer's
  // content and photo on top of the actual template image, in the marked zones.
  if(selectedCat === 'Obituary' && selectedRealTemplate){
    document.getElementById('artworkBox').innerHTML = buildArtworkFromRealTemplate(
      selectedRealTemplate, content, selectedSize.width, selectedSize.height
    );
    document.getElementById('artworkToolbar').style.display = '';
    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('resultCard').scrollIntoView({behavior:'smooth'});
    attachResizeTracking();
    setTimeout(()=>{
      const bodyEl = document.getElementById('artworkBodyText');
      if(bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight + 2){
        document.getElementById('overflowWarning').style.display = 'block';
      }
    }, 50);
    return;
  }

  document.getElementById('artworkToolbar').style.display = '';

  // Detect the language/script of the typed content, and pick a matching heading + font list.
  // Only Hindi gets an auto-translated heading; every other non-English script keeps the
  // English category heading but switches to fonts that can actually display that script.
  detectedScript = detectScript(content);
  const headingOverride = (detectedScript === 'hindi') ? HEADINGS_HINDI[selectedCat] : null;
  const defaultFont = applyFontOptionsForScript(detectedScript);

  const langNote = document.getElementById('langDetectNote');
  if(detectedScript === 'english'){
    langNote.innerText = '';
  } else {
    langNote.innerText = 'Detected ' + (SCRIPT_LABELS[detectedScript] || detectedScript) + ' content — fonts updated to match' + (headingOverride ? ' (heading auto-translated).' : '.');
  }

  document.getElementById('artworkBox').innerHTML = buildArtwork(selectedCat, content, selectedSize.width, selectedSize.height, headingOverride);

  // Fill the size dropdowns with real point-size numbers based on this artwork's own calculated sizes
  const baseSizes = computeBaseSizes(selectedSize.width, selectedSize.height);
  populateSizeSelect(document.getElementById('optHeadSize'), baseSizes.head);
  populateSizeSelect(document.getElementById('optSize'), baseSizes.body);

  // Reset design options back to defaults for the fresh artwork
  document.getElementById('optFont').value = defaultFont;
  const isBannerCat = (selectedCat === 'Public Notice' || selectedCat === 'Lost Document');
  const isObituaryCat = (selectedCat === 'Obituary');
  if(isObituaryCat){
    document.getElementById('optHeadColor').value = "#7a1f1f";
    document.getElementById('optHeadBg').value = "#fdf8ee";
    document.getElementById('optBodyColor').value = "#3a2c10";
    document.getElementById('optBodyBg').value = "#fdf8ee";
    document.getElementById('optBorderWidth').value = "0"; // the ornate double-border is built into the card itself
  } else {
    document.getElementById('optHeadColor').value = isBannerCat ? "#ffffff" : "#1c1c1c";
    document.getElementById('optHeadBg').value = isBannerCat ? "#000000" : "#ffffff";
    document.getElementById('optBodyColor').value = "#1c1c1c";
    document.getElementById('optBodyBg').value = "#ffffff";
    document.getElementById('optBorderWidth').value = "2";
  }
  document.getElementById('optBorderOpacity').value = "0";
  document.getElementById('optBorderColor').value = "#000000";
  isBold = false;
  document.getElementById('toolBold').style.background = 'var(--accent)';
  applyDesign();

  document.getElementById('resultCard').style.display = 'block';
  document.getElementById('resultCard').scrollIntoView({behavior:'smooth'});

  // Check whether the typed content overflows the fixed print size
  setTimeout(()=>{
    const bodyEl = document.getElementById('artworkBodyText');
    if(bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight + 2){
      document.getElementById('overflowWarning').style.display = 'block';
    }
  }, 50);

  attachResizeTracking();
});

// 1cm at standard 96dpi CSS resolution — the same conversion the browser itself uses
// when it renders a width/height given in "cm" units.
const PX_PER_CM = 96 / 2.54;
let resizeObserverInstance = null;

function attachResizeTracking(){
  const canvasEl = document.getElementById('artworkCanvas');
  if(!canvasEl) return;
  if(resizeObserverInstance) resizeObserverInstance.disconnect();

  resizeObserverInstance = new ResizeObserver(entries => {
    for(const entry of entries){
      const widthPx = entry.contentRect.width;
      const heightPx = entry.contentRect.height;
      const widthCm = Math.max(1, Math.round(widthPx / PX_PER_CM));
      const heightCm = Math.max(1, Math.round(heightPx / PX_PER_CM));
      updateSizeFromResize(widthCm, heightCm);
    }
  });
  resizeObserverInstance.observe(canvasEl);
}

function updateSizeFromResize(widthCm, heightCm){
  if(selectedSize && selectedSize.width === widthCm && selectedSize.height === heightCm) return;

  const row = rates.find(r=>r.city===selectedCity && r.newspaper===selectedPub);
  const field = catField(selectedCat);
  const perSqCm = row ? (row[field] || 0) : 0;
  const rate = Math.round(widthCm * heightCm * perSqCm * 100) / 100;

  selectedSize = {width: widthCm, height: heightCm, rate: rate};

  document.getElementById('manualW').value = widthCm;
  document.getElementById('manualH').value = heightCm;
  userEditedSize = true;
  document.getElementById('resetSizeLink').style.display = 'block';

  const dimsEl = document.getElementById('artworkDims');
  if(dimsEl) dimsEl.innerText = `Actual print size: ${widthCm} cm (W) x ${heightCm} cm (H) — ${selectedPub}`;

  document.getElementById('rateBox').innerHTML = `
    ${selectedPub} — ${selectedCity} — ${selectedCat} — ${widthCm}x${heightCm} cm<br>
    <span class="amount">Rs ${rate.toFixed(2)}</span>`;

  document.getElementById('overflowWarning').style.display = 'none';
  const bodyEl = document.getElementById('artworkBodyText');
  if(bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight + 2){
    document.getElementById('overflowWarning').style.display = 'block';
  }
}

// ===== Language detection, script-specific fonts, and Hindi heading translation =====
const FONT_SETS = {
  english: [
    {label:'Arial', value:"Arial, sans-serif"},
    {label:'Georgia / Times', value:"Georgia, 'Times New Roman', serif"},
    {label:'Verdana', value:"Verdana, sans-serif"},
    {label:'Courier New', value:"'Courier New', monospace"},
  ],
  hindi: [
    {label:'Noto Sans Devanagari', value:"'Noto Sans Devanagari', sans-serif", gf:'Noto+Sans+Devanagari'},
    {label:'Noto Serif Devanagari', value:"'Noto Serif Devanagari', serif", gf:'Noto+Serif+Devanagari'},
    {label:'Mangal', value:"Mangal, 'Noto Sans Devanagari', sans-serif"},
  ],
  punjabi: [
    {label:'Noto Sans Gurmukhi', value:"'Noto Sans Gurmukhi', sans-serif", gf:'Noto+Sans+Gurmukhi'},
    {label:'Noto Serif Gurmukhi', value:"'Noto Serif Gurmukhi', serif", gf:'Noto+Serif+Gurmukhi'},
  ],
  bengali: [
    {label:'Noto Sans Bengali', value:"'Noto Sans Bengali', sans-serif", gf:'Noto+Sans+Bengali'},
    {label:'Noto Serif Bengali', value:"'Noto Serif Bengali', serif", gf:'Noto+Serif+Bengali'},
  ],
  gujarati: [
    {label:'Noto Sans Gujarati', value:"'Noto Sans Gujarati', sans-serif", gf:'Noto+Sans+Gujarati'},
    {label:'Noto Serif Gujarati', value:"'Noto Serif Gujarati', serif", gf:'Noto+Serif+Gujarati'},
  ],
  tamil: [
    {label:'Noto Sans Tamil', value:"'Noto Sans Tamil', sans-serif", gf:'Noto+Sans+Tamil'},
    {label:'Noto Serif Tamil', value:"'Noto Serif Tamil', serif", gf:'Noto+Serif+Tamil'},
  ],
  telugu: [
    {label:'Noto Sans Telugu', value:"'Noto Sans Telugu', sans-serif", gf:'Noto+Sans+Telugu'},
    {label:'Noto Serif Telugu', value:"'Noto Serif Telugu', serif", gf:'Noto+Serif+Telugu'},
  ],
  kannada: [
    {label:'Noto Sans Kannada', value:"'Noto Sans Kannada', sans-serif", gf:'Noto+Sans+Kannada'},
  ],
  malayalam: [
    {label:'Noto Sans Malayalam', value:"'Noto Sans Malayalam', sans-serif", gf:'Noto+Sans+Malayalam'},
  ],
  odia: [
    {label:'Noto Sans Oriya', value:"'Noto Sans Oriya', sans-serif", gf:'Noto+Sans+Oriya'},
  ],
  arabic: [
    {label:'Noto Naskh Arabic', value:"'Noto Naskh Arabic', serif", gf:'Noto+Naskh+Arabic'},
    {label:'Noto Sans Arabic', value:"'Noto Sans Arabic', sans-serif", gf:'Noto+Sans+Arabic'},
  ],
  chinese: [
    {label:'Noto Sans SC', value:"'Noto Sans SC', sans-serif", gf:'Noto+Sans+SC'},
  ],
  japanese: [
    {label:'Noto Sans JP', value:"'Noto Sans JP', sans-serif", gf:'Noto+Sans+JP'},
  ],
  korean: [
    {label:'Noto Sans KR', value:"'Noto Sans KR', sans-serif", gf:'Noto+Sans+KR'},
  ],
};

const HEADINGS_HINDI = {
  'Public Notice': 'सार्वजनिक सूचना',
  'Court Summon': 'न्यायालय सम्मन',
  'Lost Document': 'लॉस्ट एंड फाउंड',
};

const SCRIPT_LABELS = {
  english:'English', hindi:'Hindi', punjabi:'Punjabi', bengali:'Bengali', gujarati:'Gujarati',
  tamil:'Tamil', telugu:'Telugu', kannada:'Kannada', malayalam:'Malayalam', odia:'Odia',
  arabic:'Arabic', chinese:'Chinese', japanese:'Japanese', korean:'Korean',
};

function detectScript(text){
  if(/[\u0900-\u097F]/.test(text)) return 'hindi';
  if(/[\u0A00-\u0A7F]/.test(text)) return 'punjabi';
  if(/[\u0980-\u09FF]/.test(text)) return 'bengali';
  if(/[\u0A80-\u0AFF]/.test(text)) return 'gujarati';
  if(/[\u0B80-\u0BFF]/.test(text)) return 'tamil';
  if(/[\u0C00-\u0C7F]/.test(text)) return 'telugu';
  if(/[\u0C80-\u0CFF]/.test(text)) return 'kannada';
  if(/[\u0D00-\u0D7F]/.test(text)) return 'malayalam';
  if(/[\u0B00-\u0B7F]/.test(text)) return 'odia';
  if(/[\u0600-\u06FF]/.test(text)) return 'arabic';
  if(/[\u4E00-\u9FFF]/.test(text)) return 'chinese';
  if(/[\u3040-\u30FF]/.test(text)) return 'japanese';
  if(/[\uAC00-\uD7AF]/.test(text)) return 'korean';
  return 'english';
}

const loadedGoogleFonts = new Set();
function loadGoogleFont(gfName){
  if(!gfName || loadedGoogleFonts.has(gfName)) return;
  loadedGoogleFonts.add(gfName);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + gfName + '&display=swap';
  document.head.appendChild(link);
}

function applyFontOptionsForScript(script){
  const fontSet = FONT_SETS[script] || FONT_SETS.english;
  fontSet.forEach(f => { if(f.gf) loadGoogleFont(f.gf); });
  const sel = document.getElementById('optFont');
  sel.innerHTML = fontSet.map(f => `<option value="${f.value}">${f.label}</option>`).join('');
  return fontSet[0].value;
}

let detectedScript = 'english';
let isBold = false;

function hexToRgb(hex){
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function applyDesign(){
  const heading = document.getElementById('artworkHeading');
  const body = document.getElementById('artworkBodyText');
  if(!body) return; // nothing rendered yet

  const font = document.getElementById('optFont').value;
  const headSizeSelect = document.getElementById('optHeadSize');
  const bodySizeSelect = document.getElementById('optSize');
  const headColor = document.getElementById('optHeadColor').value;
  const headBg = document.getElementById('optHeadBg').value;
  const bodyColor = document.getElementById('optBodyColor').value;
  const bodyBg = document.getElementById('optBodyBg').value;

  const bodyPt = parseInt(bodySizeSelect.value, 10) || parseInt(body.dataset.baseSize, 10) || 7;

  if(heading){
    const headPt = parseInt(headSizeSelect.value, 10) || parseInt(heading.dataset.baseSize, 10) || 10;
    heading.style.fontFamily = font;
    heading.style.color = headColor;
    heading.style.backgroundColor = headBg;
    heading.style.fontSize = headPt + 'pt';
  }

  body.style.fontFamily = font;
  body.style.color = bodyColor;
  // A real uploaded template already has its own background baked in — don't paint over it.
  if(!selectedRealTemplate) body.style.backgroundColor = bodyBg;
  body.style.fontWeight = isBold ? 'bold' : 'normal';
  body.style.fontSize = bodyPt + 'pt';

  // Border colour, width, and transparency: 0% transparency = fully visible, 100% = invisible
  // (skip for real templates — the border is part of the template image itself)
  const canvasEl = document.getElementById('artworkCanvas');
  const colorInput = document.getElementById('optBorderColor');
  const widthSlider = document.getElementById('optBorderWidth');
  const opacitySlider = document.getElementById('optBorderOpacity');
  if(canvasEl && colorInput && widthSlider && opacitySlider && !selectedRealTemplate){
    const widthPx = parseInt(widthSlider.value, 10) || 0;
    const transparencyPct = parseInt(opacitySlider.value, 10) || 0;
    const alpha = Math.round((1 - transparencyPct / 100) * 100) / 100;
    const rgb = hexToRgb(colorInput.value);
    canvasEl.style.border = `${widthPx}px solid rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
    document.getElementById('borderWidthLabel').innerText = 'Border Width: ' + widthPx + 'px';
    document.getElementById('borderOpacityLabel').innerText = 'Border Transparency: ' + transparencyPct + '%';
  }

  // Re-check overflow after restyling, since size/font changes affect how much fits
  document.getElementById('overflowWarning').style.display = 'none';
  setTimeout(()=>{
    if(body.scrollHeight > body.clientHeight + 2){
      document.getElementById('overflowWarning').style.display = 'block';
    }
  }, 50);
}

document.getElementById('optHeadSize').addEventListener('change', applyDesign);
document.getElementById('optHeadBg').addEventListener('input', applyDesign);
document.getElementById('optBodyBg').addEventListener('input', applyDesign);
document.getElementById('optBorderOpacity').addEventListener('input', applyDesign);
document.getElementById('optBorderWidth').addEventListener('input', applyDesign);
document.getElementById('optBorderColor').addEventListener('input', applyDesign);

document.getElementById('toolBold').addEventListener('click', ()=>{
  isBold = !isBold;
  document.getElementById('toolBold').style.background = isBold ? '#5a1309' : 'var(--accent)';
  applyDesign();
});
document.getElementById('optFont').addEventListener('change', applyDesign);
document.getElementById('optSize').addEventListener('change', applyDesign);
document.getElementById('optHeadColor').addEventListener('input', applyDesign);
document.getElementById('optBodyColor').addEventListener('input', applyDesign);
document.getElementById('viewDesignsBtn').addEventListener('click', openDesignGallery);

// Resizes just the currently highlighted/selected text inside the artwork, instead of
// the whole heading or content block — select text, then click A+ or A-.
function resizeSelectedText(deltaPt){
  const sel = window.getSelection();
  const artworkEl = document.getElementById('artworkCanvas');
  if(!sel || sel.rangeCount === 0 || sel.isCollapsed || !artworkEl){
    alert('First highlight/select some text inside the artwork below, then click A+ or A−.');
    return;
  }
  const range = sel.getRangeAt(0);
  if(!artworkEl.contains(range.commonAncestorContainer)){
    alert('First highlight/select some text inside the artwork below, then click A+ or A−.');
    return;
  }
  let el = range.commonAncestorContainer;
  if(el.nodeType === 3) el = el.parentElement;
  const currentPx = parseFloat(window.getComputedStyle(el).fontSize) || 12;
  const currentPt = currentPx * 72 / 96;
  const newPt = Math.max(4, Math.min(60, Math.round(currentPt + deltaPt)));

  const span = document.createElement('span');
  span.style.fontSize = newPt + 'pt';
  try{
    range.surroundContents(span);
  }catch(e){
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  sel.removeAllRanges();
}
document.getElementById('selectionIncreaseBtn').addEventListener('click', ()=>resizeSelectedText(1));
document.getElementById('selectionDecreaseBtn').addEventListener('click', ()=>resizeSelectedText(-1));

document.getElementById('toolReset').addEventListener('click', ()=>{
  const isBannerCat = (selectedCat === 'Public Notice' || selectedCat === 'Lost Document');
  const isObituaryCat = (selectedCat === 'Obituary');
  const fontSet = FONT_SETS[detectedScript] || FONT_SETS.english;
  document.getElementById('optFont').value = fontSet[0].value;
  const headSel = document.getElementById('optHeadSize');
  const bodySel = document.getElementById('optSize');
  if(headSel.dataset.normalValue) headSel.value = headSel.dataset.normalValue;
  if(bodySel.dataset.normalValue) bodySel.value = bodySel.dataset.normalValue;
  if(isObituaryCat){
    document.getElementById('optHeadColor').value = "#7a1f1f";
    document.getElementById('optHeadBg').value = "#fdf8ee";
    document.getElementById('optBodyColor').value = "#3a2c10";
    document.getElementById('optBodyBg').value = "#fdf8ee";
    document.getElementById('optBorderWidth').value = "0";
  } else {
    document.getElementById('optHeadColor').value = isBannerCat ? "#ffffff" : "#1c1c1c";
    document.getElementById('optHeadBg').value = isBannerCat ? "#000000" : "#ffffff";
    document.getElementById('optBodyColor').value = "#1c1c1c";
    document.getElementById('optBodyBg').value = "#ffffff";
    document.getElementById('optBorderWidth').value = "2";
  }
  document.getElementById('optBorderOpacity').value = "0";
  document.getElementById('optBorderColor').value = "#000000";
  isBold = false;
  document.getElementById('toolBold').style.background = 'var(--accent)';
  applyDesign();
});

let html2canvasLoaded = false;
function loadHtml2Canvas(){
  return new Promise((resolve, reject)=>{
    if(html2canvasLoaded && window.html2canvas){ resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = ()=>{ html2canvasLoaded = true; resolve(); };
    script.onerror = ()=>reject(new Error('Could not load download library'));
    document.head.appendChild(script);
  });
}

document.getElementById('downloadBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('saveStatus');
  const canvasEl = document.querySelector('.artwork-canvas');
  if(!canvasEl){
    statusEl.className = 'status err';
    statusEl.innerText = 'Nothing to download yet.';
    return;
  }
  statusEl.className = 'status';
  statusEl.innerText = 'Preparing download...';
  document.activeElement && document.activeElement.blur();
  try{
    await loadHtml2Canvas();
    const canvas = await html2canvas(canvasEl, {scale: 4, backgroundColor: '#ffffff'});
    const link = document.createElement('a');
    const safeName = (selectedCat + '_' + selectedPub + '_' + selectedCity).replace(/[^a-z0-9]+/gi, '_');
    link.download = safeName + '.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    statusEl.className = 'status ok';
    statusEl.innerText = 'Downloaded — check your Downloads folder (or Photos, on mobile).';
  }catch(e){
    statusEl.className = 'status err';
    statusEl.innerText = 'Could not prepare the download — try again.';
  }
});

function clearForm(){
  if(resizeObserverInstance) resizeObserverInstance.disconnect();
  lastTranslatedLang = null;
  document.getElementById('resultCard').style.display='none';
  document.getElementById('content').value='';
  document.getElementById('custName').value='';
  document.getElementById('custPhone').value='';
  document.getElementById('custEmail').value='';
  document.getElementById('cityInput').value='';
  selectedCity=selectedPub=selectedCat=""; selectedSize=null;
  document.getElementById('pubSelect').innerHTML='<option value="">Select city first</option>';
  document.getElementById('catSelect').value='';
  document.getElementById('calcSection').style.display='none';
  document.getElementById('genStatus').innerText='';
  document.getElementById('manualW').value='';
  document.getElementById('manualH').value='';
  selectedDateValue = '';
  initCalendar();
  document.getElementById('manualSizeRow').style.display='';
  document.getElementById('obituarySizeSection').style.display='none';
  document.getElementById('obituaryTypeRow').style.display='none';
  document.getElementById('galleryDesignRow').style.display='none';
  document.getElementById('ocrUploadCorner').style.display='';
  document.getElementById('obituaryUploadSection').style.display='none';
  document.getElementById('translateRow').style.display='none';
  document.getElementById('obituaryPhotoPreviewWrap').style.display='none';
  document.getElementById('obituaryDesignUploadStatus').innerText='';
  obituaryPhotoDataUrl = null;
  obituaryDesignImageDataUrl = null;
    selectedRealTemplate = null;
  selectedGalleryDesign = 'design-cream-memorial';
  document.getElementById('artworkToolbar').style.display='';
  userEditedSize = false;
  document.getElementById('resetSizeLink').style.display='none';
  document.getElementById('payStatus').innerText='';
  checkReady();
  goToMiniTab('category');
  updateSelectionSummary();
  goToStep(1);
}

document.getElementById('resetBtn').addEventListener('click', clearForm);
document.getElementById('clearBtn').addEventListener('click', clearForm);

// ===== 3-step wizard navigation (TARGET -> COMPOSE -> PAY) =====
function goToStep(n){
  [1,2,3].forEach(i=>{
    document.getElementById('stepPanel' + i).style.display = (i === n) ? '' : 'none';
    document.getElementById('stepCircle' + i).classList.toggle('active', i === n);
  });
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// ===== Mini sub-tabs inside Step 1: Category / Where to Publish / Select Date =====
function goToMiniTab(tab){
  // Step 1 now shows City/Publication/Category/Date all at once for speed —
  // this function is kept as a no-op so nothing else in the code breaks.
}
document.getElementById('miniTabBtnCategory').addEventListener('click', ()=>goToMiniTab('category'));
document.getElementById('miniTabBtnPublish').addEventListener('click', ()=>goToMiniTab('publish'));
document.getElementById('miniTabBtnDate').addEventListener('click', ()=>goToMiniTab('date'));

document.getElementById('miniTabToPublishBtn').addEventListener('click', ()=>{
  if(!selectedCat){
    alert('Please choose a category first.');
    return;
  }
  goToMiniTab('publish');
});
document.getElementById('miniTabToDateBtn').addEventListener('click', ()=>{
  if(!selectedCity || !selectedPub){
    alert('Please choose a City and Publication first.');
    return;
  }
  goToMiniTab('date');
});

function updateSelectionSummary(){
  const summaryEl = document.getElementById('selectionSummary');
  const textEl = document.getElementById('selectionSummaryText');
  const parts = [];
  if(selectedCat) parts.push(selectedCat);
  if(selectedPub) parts.push(selectedPub);
  if(selectedCity) parts.push(selectedCity);
  if(selectedDateValue) parts.push(selectedDateValue);
  if(parts.length){
    summaryEl.style.display = 'flex';
    textEl.innerText = parts.join(' — ');
  } else {
    summaryEl.style.display = 'none';
  }
}

document.getElementById('toStep2Btn').addEventListener('click', ()=>{
  const statusEl = document.getElementById('step1Status');
  const isObituary = (selectedCat === 'Obituary');
  if(!selectedCity || !selectedPub || !selectedCat || (isObituary && !document.getElementById('obituaryTypeSelect').value)){
    statusEl.className = 'status err';
    statusEl.innerText = 'Please select City, Publication, and Category before continuing.';
    return;
  }
  statusEl.innerText = '';
  goToStep(2);
});

document.getElementById('backToStep1Btn').addEventListener('click', ()=>goToStep(1));

document.getElementById('toStep3Btn').addEventListener('click', ()=>{
  if(!selectedSize){
    alert('Please click "Generate Rate & Artwork" first.');
    return;
  }
  document.getElementById('finalRateBox').innerHTML = document.getElementById('rateBox').innerHTML;
  goToStep(3);
});

document.getElementById('backToStep2Btn').addEventListener('click', ()=>goToStep(2));

document.getElementById('payBtn').addEventListener('click', ()=>{
  const statusEl = document.getElementById('payStatus');
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  if(!name || !phone){
    statusEl.className = 'status err';
    statusEl.innerText = 'Please enter your name and contact number.';
    return;
  }
  // Placeholder until a payment gateway is connected.
  statusEl.className = 'status ok';
  statusEl.innerText = 'Your order details have been noted. Online payment is coming soon — our team will contact you shortly to confirm and collect payment.';
});

document.getElementById('admSaveBtn').addEventListener('click', async ()=>{
  const row = {
    newspaper: document.getElementById('admPub').value.trim(),
    city: document.getElementById('admCity').value.trim(),
    publicNoticeRate: Number(document.getElementById('admPN').value) || 0,
    courtSummonRate: Number(document.getElementById('admCS').value) || 0,
    lostDocumentRate: Number(document.getElementById('admLD').value) || 0,
    obituaryRate: Number(document.getElementById('admOB').value) || 0,
  };
  if(!row.newspaper || !row.city){
    document.getElementById('admStatus').className='status err';
    document.getElementById('admStatus').innerText='Please fill Newspaper and City.';
    return;
  }
  rates.push(row);
  try{
    await window.storage.set('rates', JSON.stringify(rates), true);
    document.getElementById('admStatus').className='status ok';
    document.getElementById('admStatus').innerText='Rate added.';
    ['admPub','admCity','admPN','admCS','admLD','admOB'].forEach(id=>document.getElementById(id).value='');
    renderCityList();
  }catch(e){
    document.getElementById('admStatus').className='status err';
    document.getElementById('admStatus').innerText='Could not save rate.';
  }
});

document.getElementById('refreshBtn').addEventListener('click', async ()=>{
  document.getElementById('sheetStatus').innerText = 'Refreshing...';
  await loadRates();
  recalc();
});

loadRates();
