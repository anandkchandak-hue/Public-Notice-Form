// Each row: fixed standard column width per Newspaper+City, and BASE + ADD-ON rate per cm height, per category.
// Base = rate for the 1st column. Add-on = rate for each extra column beyond the 1st.
const DEFAULT_RATES = [
  {newspaper:"Times of India", city:"Hyderabad", standardWidth:3,
    publicNoticeRate:200, courtSummonRate:200, lostDocumentRate:200},
  {newspaper:"Times of India", city:"Bangalore", standardWidth:3,
    publicNoticeRate:675, courtSummonRate:675, lostDocumentRate:675},
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
let selectedCity = "", selectedPub = "", selectedCat = "", selectedSize = null;
let userEditedSize = false; // becomes true once staff manually change Width/Height

document.getElementById('manualW').addEventListener('input', ()=>{ userEditedSize = true; document.getElementById('resetSizeLink').style.display='block'; recalc(); });

document.getElementById('uploadImgBtn').addEventListener('click', ()=>{
  document.getElementById('imgFileInput').click();
});

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
  statusEl.className = 'status';
  statusEl.innerText = 'Translating...';
  try{
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
      + targetLang + '&dt=t&q=' + encodeURIComponent(text);
    const res = await fetch(url);
    if(!res.ok) throw new Error('translate request failed');
    const data = await res.json();
    const translated = (data && data[0]) ? data[0].map(seg => seg[0]).join('') : '';
    if(translated){
      contentEl.value = translated;
      statusEl.className = 'status ok';
      statusEl.innerText = 'Translated — please check the wording before generating the ad.';
      suggestSize();
      recalc();
    } else {
      throw new Error('empty translation');
    }
  }catch(err){
    statusEl.className = 'status err';
    statusEl.innerText = 'Could not translate right now — please check the content manually or try again.';
  }
});
document.getElementById('manualH').addEventListener('input', ()=>{ userEditedSize = true; document.getElementById('resetSizeLink').style.display='block'; recalc(); });
document.getElementById('content').addEventListener('input', ()=>{ suggestSize(); recalc(); });
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
  suggestSize();
  recalc();
});
document.getElementById('catSelect').addEventListener('change', (e)=>{
  selectedCat = e.target.value;
  recalc();
});

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
  return null;
}

function recalc(){
  const calcSection = document.getElementById('calcSection');
  const box = document.getElementById('calcBox');
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

function getDefaultHeading(category){
  return category === 'Lost Document' ? 'LOST AND FOUND' : category.toUpperCase();
}

function computeBaseSizes(widthCm, heightCm){
  const head = Math.round(Math.max(7, Math.min(13, heightCm*1.6)));
  const body = Math.round(Math.max(5.5, Math.min(8, widthCm*1.1)));
  return {head, body};
}

function buildArtwork(category, content, widthCm, heightCm, headingTextOverride){
  const safeContent = content.replace(/</g,'&lt;');
  const isBanner = (category === 'Public Notice' || category === 'Lost Document');
  const headingText = headingTextOverride || getDefaultHeading(category);
  const base = computeBaseSizes(widthCm, heightCm);

  const canvasStyle = `width:${widthCm}cm; height:${heightCm}cm;`;

  let inner;
  if(isBanner){
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
  document.getElementById('optHeadColor').value = isBannerCat ? "#ffffff" : "#1c1c1c";
  document.getElementById('optHeadBg').value = isBannerCat ? "#000000" : "#ffffff";
  document.getElementById('optBodyColor').value = "#1c1c1c";
  document.getElementById('optBodyBg').value = "#ffffff";
  document.getElementById('optBorderOpacity').value = "0";
  document.getElementById('optBorderWidth').value = "2";
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
  if(!heading || !body) return;

  const font = document.getElementById('optFont').value;
  const headSizeSelect = document.getElementById('optHeadSize');
  const bodySizeSelect = document.getElementById('optSize');
  const headColor = document.getElementById('optHeadColor').value;
  const headBg = document.getElementById('optHeadBg').value;
  const bodyColor = document.getElementById('optBodyColor').value;
  const bodyBg = document.getElementById('optBodyBg').value;

  const headPt = parseInt(headSizeSelect.value, 10) || parseInt(heading.dataset.baseSize, 10) || 10;
  const bodyPt = parseInt(bodySizeSelect.value, 10) || parseInt(body.dataset.baseSize, 10) || 7;

  heading.style.fontFamily = font;
  heading.style.color = headColor;
  heading.style.backgroundColor = headBg;
  heading.style.fontSize = headPt + 'pt';

  body.style.fontFamily = font;
  body.style.color = bodyColor;
  body.style.backgroundColor = bodyBg;
  body.style.fontWeight = isBold ? 'bold' : 'normal';
  body.style.fontSize = bodyPt + 'pt';

  // Border colour, width, and transparency: 0% transparency = fully visible, 100% = invisible
  const canvasEl = document.getElementById('artworkCanvas');
  const colorInput = document.getElementById('optBorderColor');
  const widthSlider = document.getElementById('optBorderWidth');
  const opacitySlider = document.getElementById('optBorderOpacity');
  if(canvasEl && colorInput && widthSlider && opacitySlider){
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
document.getElementById('toolReset').addEventListener('click', ()=>{
  const isBannerCat = (selectedCat === 'Public Notice' || selectedCat === 'Lost Document');
  const fontSet = FONT_SETS[detectedScript] || FONT_SETS.english;
  document.getElementById('optFont').value = fontSet[0].value;
  const headSel = document.getElementById('optHeadSize');
  const bodySel = document.getElementById('optSize');
  if(headSel.dataset.normalValue) headSel.value = headSel.dataset.normalValue;
  if(bodySel.dataset.normalValue) bodySel.value = bodySel.dataset.normalValue;
  document.getElementById('optHeadColor').value = isBannerCat ? "#ffffff" : "#1c1c1c";
  document.getElementById('optHeadBg').value = isBannerCat ? "#000000" : "#ffffff";
  document.getElementById('optBodyColor').value = "#1c1c1c";
  document.getElementById('optBodyBg').value = "#ffffff";
  document.getElementById('optBorderOpacity').value = "0";
  document.getElementById('optBorderWidth').value = "2";
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
  userEditedSize = false;
  document.getElementById('resetSizeLink').style.display='none';
  checkReady();
}

document.getElementById('resetBtn').addEventListener('click', clearForm);
document.getElementById('clearBtn').addEventListener('click', clearForm);

document.getElementById('admSaveBtn').addEventListener('click', async ()=>{
  const row = {
    newspaper: document.getElementById('admPub').value.trim(),
    city: document.getElementById('admCity').value.trim(),
    publicNoticeRate: Number(document.getElementById('admPN').value) || 0,
    courtSummonRate: Number(document.getElementById('admCS').value) || 0,
    lostDocumentRate: Number(document.getElementById('admLD').value) || 0,
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
    ['admPub','admCity','admPN','admCS','admLD'].forEach(id=>document.getElementById(id).value='');
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
