// ============================================================
// STAFF LOGIN — basic access gate (not real server-side security, but keeps casual
// visitors out and this page out of accidental use). Change these anytime.
// ============================================================
const ADMIN_USERNAME = "a2p_obi";
const ADMIN_PASSWORD = "**a2p**#";

function checkLogin(){
  if(sessionStorage.getItem('adminLoggedIn') === 'true'){
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
  }
}
checkLogin();

document.getElementById('loginBtn').addEventListener('click', ()=>{
  const user = document.getElementById('loginUsername').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const statusEl = document.getElementById('loginStatus');
  if(user === ADMIN_USERNAME && pass === ADMIN_PASSWORD){
    sessionStorage.setItem('adminLoggedIn', 'true');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
  } else {
    statusEl.style.display = 'block';
    statusEl.innerText = 'Incorrect username or password.';
  }
});
document.getElementById('loginPassword').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') document.getElementById('loginBtn').click();
});

// ============================================================
// PASTE YOUR FIREBASE CONFIG HERE (from Firebase Console > Project Settings > Your apps)
// Only used for Firestore (the free metadata database) — images now go to GitHub instead.
// ============================================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
// ============================================================
// YOUR GITHUB REPO DETAILS — adjust if your username/repo name differ
// ============================================================
const GITHUB_OWNER = "anandkchandak-hue";
const GITHUB_REPO = "Public-Notice-Form";
const GITHUB_BRANCH = "main";
// ============================================================

let db;
try{
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  document.getElementById('fbStatus').className = 'status ok';
  document.getElementById('fbStatus').innerText = 'Connected to Firebase (Firestore only — images now go to GitHub).';
}catch(e){
  document.getElementById('fbStatus').className = 'status err';
  document.getElementById('fbStatus').innerText = 'Could not connect to Firebase — check your firebaseConfig in admin-script.js.';
  console.error(e);
}

// Load a remembered token, if the box was checked previously on this device
const savedToken = localStorage.getItem('githubToken');
if(savedToken){
  document.getElementById('githubToken').value = savedToken;
  document.getElementById('rememberTokenCheck').checked = true;
}
document.getElementById('githubToken').addEventListener('input', updateSaveButtonState);
document.getElementById('rememberTokenCheck').addEventListener('change', (e)=>{
  if(e.target.checked){
    localStorage.setItem('githubToken', document.getElementById('githubToken').value);
  } else {
    localStorage.removeItem('githubToken');
  }
});

// Converts a File to a base64 string (without the data: prefix), as required by GitHub's API
function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const result = reader.result;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Uploads a file into the GitHub repo under templates/ using the Contents API,
// and returns a public raw.githubusercontent.com URL for the uploaded image.
async function uploadImageToGitHub(file, token){
  const base64Content = await fileToBase64(file);
  const safeName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = 'templates/' + safeName;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Add obituary template: ' + file.name,
      content: base64Content,
      branch: GITHUB_BRANCH,
    }),
  });

  if(!res.ok){
    const errBody = await res.text();
    throw new Error('GitHub upload failed (' + res.status + '): ' + errBody);
  }

  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;
}

let selectedFile = null;
let photoZone = null; // {top, left, width, height} in % of image
let textZone = null;
let drawMode = null; // 'photo' | 'text' | null
let dragStart = null;

document.getElementById('tplFile').addEventListener('change', (e)=>{
  selectedFile = e.target.files[0];
  if(!selectedFile) return;
  const url = URL.createObjectURL(selectedFile);
  document.getElementById('zonePreviewImg').src = url;
  document.getElementById('zoneSection').style.display = 'block';
  photoZone = null;
  textZone = null;
  document.getElementById('photoZoneBox').style.display = 'none';
  document.getElementById('textZoneBox').style.display = 'none';
  updateZoneStatus();
  updateSaveButtonState();
});

document.getElementById('drawPhotoZoneBtn').addEventListener('click', ()=>{
  drawMode = 'photo';
  document.getElementById('zoneStatus').innerText = 'Click and drag on the image to draw the Photo Zone.';
});
document.getElementById('drawTextZoneBtn').addEventListener('click', ()=>{
  drawMode = 'text';
  document.getElementById('zoneStatus').innerText = 'Click and drag on the image to draw the Text Zone.';
});
document.getElementById('clearZonesBtn').addEventListener('click', ()=>{
  photoZone = null;
  textZone = null;
  document.getElementById('photoZoneBox').style.display = 'none';
  document.getElementById('textZoneBox').style.display = 'none';
  updateZoneStatus();
  updateSaveButtonState();
});

const container = document.getElementById('zonePreviewContainer');
container.addEventListener('pointerdown', (e)=>{
  if(!drawMode) return;
  const rect = container.getBoundingClientRect();
  dragStart = {x: e.clientX - rect.left, y: e.clientY - rect.top};
  const boxEl = document.getElementById(drawMode === 'photo' ? 'photoZoneBox' : 'textZoneBox');
  boxEl.style.display = 'block';
  boxEl.style.left = dragStart.x + 'px';
  boxEl.style.top = dragStart.y + 'px';
  boxEl.style.width = '0px';
  boxEl.style.height = '0px';
});
container.addEventListener('pointermove', (e)=>{
  if(!drawMode || !dragStart) return;
  const rect = container.getBoundingClientRect();
  const curX = e.clientX - rect.left;
  const curY = e.clientY - rect.top;
  const left = Math.min(dragStart.x, curX);
  const top = Math.min(dragStart.y, curY);
  const width = Math.abs(curX - dragStart.x);
  const height = Math.abs(curY - dragStart.y);
  const boxEl = document.getElementById(drawMode === 'photo' ? 'photoZoneBox' : 'textZoneBox');
  boxEl.style.left = left + 'px';
  boxEl.style.top = top + 'px';
  boxEl.style.width = width + 'px';
  boxEl.style.height = height + 'px';
});
container.addEventListener('pointerup', (e)=>{
  if(!drawMode || !dragStart) return;
  const rect = container.getBoundingClientRect();
  const boxEl = document.getElementById(drawMode === 'photo' ? 'photoZoneBox' : 'textZoneBox');
  const zone = {
    left: (parseFloat(boxEl.style.left) / rect.width) * 100,
    top: (parseFloat(boxEl.style.top) / rect.height) * 100,
    width: (parseFloat(boxEl.style.width) / rect.width) * 100,
    height: (parseFloat(boxEl.style.height) / rect.height) * 100,
  };
  if(drawMode === 'photo') photoZone = zone; else textZone = zone;
  dragStart = null;
  drawMode = null;
  updateZoneStatus();
  updateSaveButtonState();
});

function updateZoneStatus(){
  const parts = [];
  parts.push(photoZone ? 'Photo Zone ✓' : 'Photo Zone not set');
  parts.push(textZone ? 'Text Zone ✓' : 'Text Zone not set');
  document.getElementById('zoneStatus').innerText = parts.join(' — ');
}

function updateSaveButtonState(){
  const ready = selectedFile && photoZone && textZone &&
    document.getElementById('tplName').value.trim() &&
    document.getElementById('tplCity').value.trim() &&
    document.getElementById('tplPublication').value.trim() &&
    document.getElementById('githubToken').value.trim();
  document.getElementById('saveTemplateBtn').disabled = !ready;
}
document.getElementById('tplName').addEventListener('input', updateSaveButtonState);
document.getElementById('tplCity').addEventListener('input', updateSaveButtonState);
document.getElementById('tplPublication').addEventListener('input', updateSaveButtonState);

document.getElementById('saveTemplateBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('saveStatus');
  statusEl.className = 'status';
  statusEl.innerText = 'Uploading image to GitHub (this may take a moment for high-resolution files)...';
  try{
    const name = document.getElementById('tplName').value.trim();
    const city = document.getElementById('tplCity').value.trim();
    const publication = document.getElementById('tplPublication').value.trim();
    const language = document.getElementById('tplLanguage').value;
    const category = document.getElementById('tplCategory').value;
    const token = document.getElementById('githubToken').value.trim();

    const imageUrl = await uploadImageToGitHub(selectedFile, token);

    statusEl.innerText = 'Saving details...';
    await db.collection('obituaryTemplates').add({
      name, city, publication, language, category,
      imageUrl,
      photoZone, textZone,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    statusEl.className = 'status ok';
    statusEl.innerText = 'Template saved successfully. Note: the image may take a minute to appear live via GitHub Pages.';

    // Reset the form (token is intentionally kept, so staff don't need to re-paste it each time)
    document.getElementById('tplName').value = '';
    document.getElementById('tplCity').value = '';
    document.getElementById('tplPublication').value = '';
    document.getElementById('tplFile').value = '';
    document.getElementById('zoneSection').style.display = 'none';
    selectedFile = null;
    photoZone = null;
    textZone = null;
    updateSaveButtonState();
    loadTemplates();
  }catch(e){
    console.error(e);
    statusEl.className = 'status err';
    statusEl.innerText = 'Could not save the template — check your GitHub token (needs Contents: Read and write on this repo) and Firebase setup, then try again.';
  }
});

async function loadTemplates(){
  const grid = document.getElementById('templateGrid');
  const statusEl = document.getElementById('loadStatus');
  if(!db) return;
  statusEl.innerText = 'Loading...';
  try{
    const snapshot = await db.collection('obituaryTemplates').orderBy('createdAt', 'desc').get();
    if(snapshot.empty){
      grid.innerHTML = '<div class="empty-state">No templates uploaded yet — add your first one above 👆</div>';
      statusEl.innerText = '';
      return;
    }
    statusEl.innerText = '';
    grid.innerHTML = '';
    snapshot.forEach(doc=>{
      const d = doc.data();
      const item = document.createElement('div');
      item.className = 'template-item';
      item.innerHTML = `
        <img src="${d.imageUrl}" alt="${d.name}">
        <div class="tpl-name">${d.name}</div>
        <div class="tpl-meta">${d.city ? d.city + ' · ' : ''}${d.publication} · ${d.language} · ${d.category}</div>
        <button class="del-btn" data-id="${doc.id}" data-path="${d.imageUrl}">Delete</button>
      `;
      grid.appendChild(item);
    });
    grid.querySelectorAll('.del-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('Remove this template from the gallery? (The image file itself will stay in your GitHub repo, but it will no longer be shown as a design option.)')) return;
        try{
          await db.collection('obituaryTemplates').doc(btn.dataset.id).delete();
          loadTemplates();
        }catch(e){
          alert('Could not delete — try again.');
        }
      });
    });
  }catch(e){
    console.error(e);
    statusEl.innerText = 'Could not load templates — check your Firebase setup.';
  }
}
loadTemplates();
