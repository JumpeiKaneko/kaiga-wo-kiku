// ==============================================
// 「絵画を聴く」 音声ガイド＋ミキキ完全統合版 app.js (エラー防止安全設計)
// ==============================================

const firebaseConfig = {
  apiKey: "AIzaSyCwbqi08ShVjJ90Mku2NsXJK0E03p4CsT4",
  authDomain: "kaiga-wo-kiku.firebaseapp.com",
  projectId: "kaiga-wo-kiku",
  storageBucket: "kaiga-wo-kiku.firebasestorage.app"
};

try {
  firebase.initializeApp(firebaseConfig);
} catch (e) {
  console.error("Firebaseの初期化に失敗しました。ローカルモードで動作します。", e);
}
const db = firebase.apps.length ? firebase.firestore() : null;
const storage = firebase.apps.length ? firebase.storage() : null;

let appMode = ""; 
let exhibitMode = ""; 
let currentUser = "";
let audioCtx;

let masterGain, convolver, dryGain, wetGain;
let mediaRecorder, recordedChunks = [];
let isRecording = false;

let tracks = [];
let isMasterPlaying = false;
let isMasterLooping = true;
let startTime = 0;
let animationFrameId;
let isTransportBusy = false;
let unsubscribeTracks = null;

const PIXELS_PER_SEC = 30;

const MAKE_MODE_ASSETS = [
  { id: "ambient_base", name: "空間のベース音", fileName: "ambient_base.mp3", volume: 0.4 },
  ...Array.from({length: 10}, (_, i) => ({ id: `field_${(i+1).toString().padStart(2, '0')}`, name: `環境音 ${i+1}`, fileName: `field_${(i+1).toString().padStart(2, '0')}.mp3`, volume: 0.8 })),
  { id: "make_yuragi", name: "ゆらぎ", fileName: "yuragi.mp3", volume: 1.0 },
  { id: "make_seseragi", name: "せせらぎ", fileName: "seseragi.mp3", volume: 1.0 },
  { id: "make_zawameki", name: "ざわめき", fileName: "zawameki.mp3", volume: 1.0 },
  { id: "make_saezuri", name: "さえずり", fileName: "saezuri.mp3", volume: 1.0 },
  { id: "make_nakigoe", name: "なきごえ", fileName: "nakigoe.mp3", volume: 1.0 },
  { id: "make_haoto", name: "はおと", fileName: "haoto.mp3", volume: 1.0 }
];

let isListenModePlaying = false;
let guideAiSource = null;
let exhibitGuideTracks = [];

let everyoneTracks = [];
let isListeningEveryone = false;
let currentEveryoneSource = null;
let everyonePlayTimeout = null;

// ======= 画面切り替え要素の取得 =======
const appExhibit = document.getElementById('app-exhibit');
const userModal = document.getElementById('user-modal');
const modalStepLogin = document.getElementById('modal-step-login');
const modalStepSelect = document.getElementById('modal-step-select');
const listenApp = document.getElementById('listen-app');
const mainApp = document.getElementById('main-app');

function resetAudioAndUI() {
  isMasterPlaying = false;
  const btnMasterPlayStop = document.getElementById('btn-master-play-stop');
  if (btnMasterPlayStop) {
    btnMasterPlayStop.innerText = "自分の音を再生";
    btnMasterPlayStop.classList.remove('recording');
  }
  tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(ex){} t.source = null; } });
  cancelAnimationFrame(animationFrameId);
  if (document.getElementById('playhead')) document.getElementById('playhead').style.left = '0px';

  if (isListenModePlaying) {
    stopGuideExhibitMode();
    isListenModePlaying = false;
    const btnPlayUnityAudio = document.getElementById('btn-play-unity-audio');
    if (btnPlayUnityAudio) btnPlayUnityAudio.classList.remove('recording');
  }
  
  if (guideAiSource) { try{guideAiSource.stop()}catch(e){} guideAiSource = null; }
  const btnGuideBasePlay = document.getElementById('btn-guide-base-play');
  if (btnGuideBasePlay) {
    btnGuideBasePlay.innerText = "AI解説をONにする";
    btnGuideBasePlay.classList.remove('recording');
  }

  if (isListeningEveryone) {
    const btnListenEveryone = document.getElementById('btn-listen-everyone');
    if (btnListenEveryone) btnListenEveryone.click();
  }
}

// ======= 安全にイベントリスナーを登録する仕組み =======
function safeAddListener(id, eventType, callback) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(eventType, callback);
}

// 展示モードへの遷移（ビーコンやARのボタンがあれば動く。無くてもエラーにならない）
safeAddListener('btn-choice-exhibit-beacon', 'click', (e) => {
  e.preventDefault(); exhibitMode = "beacon"; appMode = "mikiki";
  if(appExhibit) appExhibit.style.display = 'none'; 
  if(listenApp) listenApp.style.display = 'block';
});
safeAddListener('btn-choice-exhibit-camera', 'click', (e) => {
  e.preventDefault(); exhibitMode = "camera"; appMode = "mikiki";
  if(appExhibit) appExhibit.style.display = 'none'; 
  if(listenApp) listenApp.style.display = 'block';
});
safeAddListener('btn-choice-exhibit-guide', 'click', (e) => {
  e.preventDefault(); exhibitMode = "guide"; appMode = "guide";
  if(appExhibit) appExhibit.style.display = 'none'; 
  if(listenApp) listenApp.style.display = 'block';
  const infoArea = document.getElementById('guide-info-area');
  if(infoArea) infoArea.style.display = 'block';
});

// ワークショップへの遷移
safeAddListener('btn-to-workshop', 'click', () => {
  if(appExhibit) appExhibit.style.display = 'none'; 
  if(userModal) userModal.style.display = 'flex'; 
  if(modalStepLogin) modalStepLogin.style.display = 'block';
});
safeAddListener('btn-ws-login-back', 'click', () => {
  if(userModal) userModal.style.display = 'none'; 
  if(modalStepLogin) modalStepLogin.style.display = 'none'; 
  if(appExhibit) appExhibit.style.display = 'block';
});
safeAddListener('btn-ws-login', 'click', async (e) => {
  e.preventDefault();
  const inputEl = document.getElementById('input-username');
  if(!inputEl) return;
  const username = inputEl.value.trim();
  if (!username) { alert("名前を入力してください。"); return; }
  currentUser = username;
  if(modalStepLogin) modalStepLogin.style.display = 'none'; 
  if(modalStepSelect) modalStepSelect.style.display = 'block';
  await initAudio();
});
safeAddListener('btn-ws-select-back', 'click', () => {
  if(modalStepSelect) modalStepSelect.style.display = 'none'; 
  if(modalStepLogin) modalStepLogin.style.display = 'block';
});

// モード選択
safeAddListener('btn-choice-mikiki-ws', 'click', (e) => {
  e.preventDefault(); appMode = "mikiki";
  if(userModal) userModal.style.display = 'none'; 
  if(mainApp) mainApp.style.display = 'block';
  const userDisp = document.getElementById('current-user-display');
  if(userDisp) userDisp.innerText = currentUser;
  const badge = document.getElementById('ws-badge');
  if(badge) badge.innerText = "ミキキの交差点";
  const guideSec = document.getElementById('guide-base-sound-section');
  if(guideSec) guideSec.style.display = 'none';
  startSyncTracks();
});
safeAddListener('btn-choice-guide-ws', 'click', (e) => {
  e.preventDefault(); appMode = "guide";
  if(userModal) userModal.style.display = 'none'; 
  if(mainApp) mainApp.style.display = 'block';
  const userDisp = document.getElementById('current-user-display');
  if(userDisp) userDisp.innerText = currentUser;
  const badge = document.getElementById('ws-badge');
  if(badge) badge.innerText = "非言語音声ガイド";
  const guideSec = document.getElementById('guide-base-sound-section');
  if(guideSec) guideSec.style.display = 'block';
  startSyncTracks();
});

// 戻るボタン一括処理
document.querySelectorAll('.btn-global-back').forEach(btn => {
  btn.addEventListener('click', () => {
    resetAudioAndUI(); 
    if(mainApp) mainApp.style.display = 'none'; 
    if(listenApp) listenApp.style.display = 'none'; 
    if(userModal) userModal.style.display = 'none';
    if(modalStepSelect) modalStepSelect.style.display = 'none'; 
    if(appExhibit) appExhibit.style.display = 'block';
  });
});
document.querySelectorAll('.logo-home-trigger').forEach(logo => {
  logo.addEventListener('click', () => {
    resetAudioAndUI(); 
    if(mainApp) mainApp.style.display = 'none'; 
    if(listenApp) listenApp.style.display = 'none'; 
    if(userModal) userModal.style.display = 'none';
    if(modalStepSelect) modalStepSelect.style.display = 'none'; 
    if(modalStepLogin) modalStepLogin.style.display = 'none'; 
    if(appExhibit) appExhibit.style.display = 'block';
  });
});

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);

// ======= AI解説ON/OFF =======
safeAddListener('btn-guide-base-play', 'click', async (e) => {
  await initAudio();
  if (guideAiSource) {
    guideAiSource.stop(); guideAiSource = null;
    e.target.innerText = "AI解説をONにする"; e.target.classList.remove('recording');
  } else {
    try {
      const res = await fetch("assets/sounds/ai_guide.mp3");
      const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
      guideAiSource = audioCtx.createBufferSource();
      guideAiSource.buffer = buf; guideAiSource.loop = true;
      guideAiSource.connect(masterGain); guideAiSource.start(0);
      e.target.innerText = "AI解説をOFFにする"; e.target.classList.add('recording');
    } catch(err) { alert("AI解説用ファイルが見つかりません。"); }
  }
});

// ======= 展示モード：非言語音声ガイド（バックミュージック化） =======
async function startGuideExhibitMode() {
  await initAudio();
  try {
    const res = await fetch("assets/sounds/ai_guide.mp3");
    if(res.ok) {
      const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
      guideAiSource = audioCtx.createBufferSource();
      guideAiSource.buffer = buf; guideAiSource.loop = true;
      guideAiSource.connect(masterGain); guideAiSource.start(0);
    }
  } catch(err) {}

  if (db) {
    const snap = await db.collection("guide_tracks").get();
    exhibitGuideTracks = [];
    snap.forEach(doc => { const data = doc.data(); if(data.url) exhibitGuideTracks.push(data.url); });

    exhibitGuideTracks.forEach(async (url, idx) => {
      try {
        const r = await fetch(formalizeUrl(url));
        if (r.ok) {
          const b = await audioCtx.decodeAudioData(await r.arrayBuffer());
          const src = audioCtx.createBufferSource();
          src.buffer = b; src.loop = true;
          const g = audioCtx.createGain();
          g.gain.value = 0.3; 
          src.connect(g); g.connect(masterGain);
          src.start(audioCtx.currentTime + Math.random() * 5); 
          exhibitGuideTracks[idx] = src;
        }
      } catch(e){}
    });
  }
}

function stopGuideExhibitMode() {
  if (guideAiSource) { try{guideAiSource.stop()}catch(e){} guideAiSource = null; }
  for(let i=0; i<exhibitGuideTracks.length; i++){
    let src = exhibitGuideTracks[i];
    if(src && typeof src.stop === 'function') { try{src.stop()}catch(e){} }
  }
  exhibitGuideTracks = [];
}

safeAddListener('btn-play-unity-audio', 'click', async (e) => {
  if (!isListenModePlaying) {
    if (exhibitMode === "guide") await startGuideExhibitMode();
    isListenModePlaying = true;
    e.target.innerText = "体験を停止する"; e.target.classList.add('recording');
  } else {
    if (exhibitMode === "guide") stopGuideExhibitMode();
    isListenModePlaying = false;
    e.target.innerText = "音声ガイドを聴く";
    e.target.classList.remove('recording');
  }
});

// ======= 汎用オーディオ・ワークショップ機能 =======
async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(audioCtx.destination);
    convolver = audioCtx.createConvolver(); convolver.buffer = createReverbBuffer(audioCtx, 4.5, 2.5);
    dryGain = audioCtx.createGain(); wetGain = audioCtx.createGain();
    dryGain.connect(masterGain); wetGain.connect(convolver); convolver.connect(masterGain);
    updateReverb();
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

function createReverbBuffer(ctx, duration, decay) {
  const length = ctx.sampleRate * duration; const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return impulse;
}

function updateReverb() {
  const reverbSlider = document.getElementById('master-reverb');
  if (!dryGain || !wetGain || !reverbSlider) return;
  const wetVal = parseFloat(reverbSlider.value);
  wetGain.gain.value = wetVal * 2.5; dryGain.gain.value = 1.0;
}
safeAddListener('master-reverb', 'input', updateReverb);

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

safeAddListener('btn-record', 'click', async (e) => {
  await initAudio();
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream); recordedChunks = [];
      mediaRecorder.ondataavailable = ev => { if (ev.data.size > 0) recordedChunks.push(ev.data); };
      
      mediaRecorder.onstop = async () => {
        e.target.innerText = "Processing...";
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const timestamp = Date.now(); const storagePath = `audios/track_${timestamp}.webm`;
        if (storage && db) {
          try {
            const snapshot = await storage.ref().child(storagePath).put(blob);
            const downloadUrl = await snapshot.ref.getDownloadURL();
            const targetCollection = (appMode === "mikiki") ? "make_tracks" : "guide_tracks";
            await db.collection(targetCollection).add({
              user: currentUser, name: `投稿音 ${String(timestamp).substring(9, 13)}`, url: downloadUrl,
              storagePath: storagePath, isLooping: true, volume: 1.0, delayTime: 0, isActive: true,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (err) { alert("録音の保存に失敗しました。"); }
        } else {
          simulateLocalTrack(`投稿音 ${String(timestamp).substring(9, 13)}`, URL.createObjectURL(blob), `local_${timestamp}`);
        }
        e.target.innerText = "録音を開始";
      };
      mediaRecorder.start(); isRecording = true;
      e.target.innerText = "録音を停止"; e.target.classList.add('recording');
    } catch (err) { alert("マイクへのアクセスが拒否されました。"); }
  } else {
    mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop());
    isRecording = false; e.target.classList.remove('recording');
  }
});

async function simulateLocalTrack(name, url, localId, assetId) {
  const emptyMsg = document.getElementById('empty-msg');
  if (emptyMsg) emptyMsg.style.display = 'none';
  let audioBuffer = null;
  try { const response = await fetch(url); if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer()); } catch (e) {}
  const trackGain = audioCtx.createGain(); const trackRevGain = audioCtx.createGain();
  trackGain.connect(dryGain); trackRevGain.connect(wetGain);
  trackGain.gain.value = 1.0; trackRevGain.gain.value = 0.0;
  const localTrack = {
    id: assetId || localId, dbDocId: localId, name: name, url: url, buffer: audioBuffer, source: null,
    gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: true, volume: 1.0, isActive: true,
    trackReverb: 0.0, delayTime: 0, duration: audioBuffer ? audioBuffer.duration : 5, isPreset: false
  };
  tracks.unshift(localTrack);
  renderUI();
  if (isMasterPlaying) startTrackSource(localTrack, audioCtx.currentTime - startTime);
}

function startSyncTracks() {
  if (unsubscribeTracks) { unsubscribeTracks(); unsubscribeTracks = null; }
  tracks = [];
  const emptyMsg = document.getElementById('empty-msg');
  if (emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = "環境を読み込み中..."; }
  
  if (appMode === "mikiki") {
    const loadInitialAssets = MAKE_MODE_ASSETS.map(async (asset) => {
      const path = `assets/sounds/${asset.fileName}`; let audioBuffer = null;
      try { const response = await fetch(path); if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer()); } catch (e) {}
      const trackGain = audioCtx.createGain(); const trackRevGain = audioCtx.createGain();
      trackGain.connect(dryGain); trackRevGain.connect(wetGain); trackGain.gain.value = 0.0; trackRevGain.gain.value = 0.0;
      return {
        id: asset.id, dbDocId: `local_${asset.id}`, name: asset.name, url: path, buffer: audioBuffer, source: null,
        gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: true, volume: asset.volume !== undefined ? asset.volume : 1.0, isActive: false,
        trackReverb: 0.0, delayTime: 0, duration: audioBuffer ? audioBuffer.duration : 5, isPreset: true
      };
    });
    Promise.all(loadInitialAssets).then(loadedTracks => {
      if (emptyMsg) emptyMsg.style.display = 'none';
      tracks = loadedTracks; renderUI(); syncDBTracks("make_tracks");
    });
  } else {
    if (emptyMsg) emptyMsg.style.display = 'none';
    syncDBTracks("guide_tracks");
  }
}

// 自分の音だけ同期
function syncDBTracks(collectionName) {
  if (!db) return;
  unsubscribeTracks = db.collection(collectionName).where("user", "==", currentUser).onSnapshot(async (snapshot) => {
    const loadPromises = snapshot.docs.map(async (docSnapshot) => {
      const id = docSnapshot.id; const data = docSnapshot.data(); const safeUrl = formalizeUrl(data.url);
      const existingTrack = tracks.find(t => t.dbDocId === id);
      if (existingTrack) {
        existingTrack.name = data.name; existingTrack.isLooping = data.isLooping !== undefined ? data.isLooping : true;
        existingTrack.isActive = data.isActive !== undefined ? data.isActive : true; existingTrack.volume = data.volume !== undefined ? data.volume : 1.0;
        if (existingTrack.delayTime !== data.delayTime) {
          existingTrack.delayTime = data.delayTime !== undefined ? data.delayTime : 0;
          if (isMasterPlaying && audioCtx && !isTransportBusy) {
            if (existingTrack.source) { try{existingTrack.source.stop()}catch(e){} }
            startTrackSource(existingTrack, audioCtx.currentTime - startTime);
          }
        }
        if (existingTrack.gainNode) existingTrack.gainNode.gain.value = existingTrack.isActive ? existingTrack.volume : 0.0;
        if (existingTrack.source) existingTrack.source.loop = existingTrack.isLooping;
        return existingTrack;
      }
      let audioBuffer = null;
      try { const response = await fetch(safeUrl); if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer()); } catch (e) {}
      const trackGain = audioCtx.createGain(); const trackRevGain = audioCtx.createGain();
      const isActiveState = data.isActive !== undefined ? data.isActive : true;
      if (trackGain) { trackGain.connect(dryGain); trackRevGain.connect(wetGain); trackGain.gain.value = isActiveState ? (data.volume !== undefined ? data.volume : 1.0) : 0.0; }
      return {
        id: id, dbDocId: id, name: data.name, url: safeUrl, buffer: audioBuffer, source: null,
        gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: data.isLooping !== undefined ? data.isLooping : true, isActive: isActiveState,
        volume: data.volume !== undefined ? data.volume : 1.0, trackReverb: 0.0, delayTime: data.delayTime !== undefined ? data.delayTime : 0, duration: audioBuffer ? audioBuffer.duration : 5, isPreset: false, createdAt: data.createdAt
      };
    });
    const newTracks = await Promise.all(loadPromises);
    const filtered = newTracks.filter(Boolean);
    const presets = tracks.filter(t => t.isPreset);
    filtered.sort((a, b) => { const timeA = a.createdAt?.toMillis() || 0; const timeB = b.createdAt?.toMillis() || 0; return timeB - timeA; });
    tracks = [...filtered, ...presets];
    renderUI();
  });
}

function renderUI() {
  const trackListEl = document.getElementById('track-list'); const timelineTracksEl = document.getElementById('timeline-tracks');
  if (trackListEl) trackListEl.innerHTML = ''; if (timelineTracksEl) timelineTracksEl.innerHTML = '';
  tracks.forEach((track) => {
    const mixerEl = document.createElement('div'); mixerEl.className = 'track-item';
    const activeBtnStyle = track.isActive ? "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:var(--text-main); color:var(--bg-color); border:1px solid var(--text-main);" : "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:transparent; color:var(--text-muted); border:1px solid var(--text-muted);";
    const onOffBtnHTML = `<button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} cursor:pointer; flex-shrink:0;">${track.isActive ? 'ON' : 'OFF'}</button>`;
    const nameTrackHTML = track.isPreset ? `<span class="track-name-label" style="font-weight:bold; color:var(--text-main);">${track.name}</span>` : `<input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}" style="color:var(--text-main);">`;
    const deleteBtnHTML = !track.isPreset ? `<button class="action-btn delete-btn" data-id="${track.dbDocId}">削除</button>` : '';
    const delaySliderHTML = `<div class="vol-slider-wrapper" style="width:100px; display:flex; flex-direction:column; align-items:flex-start; gap:2px;"><span style="font-size:0.55rem; color:var(--text-muted);">Start</span><input type="range" class="track-delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}"></div>`;

    mixerEl.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;"><div style="display:flex; align-items:center; gap:8px;">${onOffBtnHTML}${nameTrackHTML}</div><div style="display:flex; align-items:center; gap:12px;"><button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button><div style="display:flex; align-items:center; gap:8px;">${deleteBtnHTML}</div></div></div><div style="display:flex; justify-content:flex-end; align-items:center; gap:16px; width:100%;">${delaySliderHTML}</div>`;
    if (trackListEl) trackListEl.appendChild(mixerEl);

    if (track.isActive) {
      const rowEl = document.createElement('div'); rowEl.className = 'timeline-row';
      const clipEl = document.createElement('div'); clipEl.className = 'timeline-clip'; clipEl.setAttribute('data-id', track.dbDocId); clipEl.innerText = track.name + (track.isLooping ? " ↻" : "");
      clipEl.style.left = `${track.delayTime * PIXELS_PER_SEC}px`;
      if (track.isLooping) { clipEl.style.width = `600px`; clipEl.style.background = "repeating-linear-gradient(90deg, #f0f0f0, #f0f0f0 100px, #e8e8e8 101px)"; } else { clipEl.style.width = `${Math.max(track.duration * PIXELS_PER_SEC, 20)}px`; }
      rowEl.appendChild(clipEl); if (timelineTracksEl) timelineTracksEl.appendChild(rowEl);
    }
  });
  bindMixerEvents();
}

function bindMixerEvents() {
  const col = (appMode === "mikiki") ? "make_tracks" : "guide_tracks";
  document.querySelectorAll('.track-name-input').forEach(input => { input.addEventListener('change', async e => { const id = e.target.getAttribute('data-id'); if (db && !id.startsWith("local_")) await db.collection(col).doc(id).update({ name: e.target.value.trim() }); }); });
  document.querySelectorAll('.toggle-active-btn').forEach(btn => { btn.addEventListener('click', async e => { const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id); if (t) { t.isActive = !t.isActive; if (t.gainNode) t.gainNode.gain.value = t.isActive ? t.volume : 0.0; if (db && !id.startsWith("local_")) await db.collection(col).doc(id).update({ isActive: t.isActive }); else renderUI(); } }); });
  document.querySelectorAll('.loop-btn').forEach(btn => { btn.addEventListener('click', async e => { const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id); if(!t) return; t.isLooping = !t.isLooping; if (t.source) t.source.loop = t.isLooping; if (db && !id.startsWith("local_")) await db.collection(col).doc(id).update({ isLooping: t.isLooping }); else renderUI(); }); });
  document.querySelectorAll('.track-delay-slider').forEach(slider => { slider.addEventListener('input', e => { const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id); if (t) { t.delayTime = parseFloat(e.target.value); const clip = document.querySelector(`.timeline-clip[data-id="${id}"]`); if (clip) clip.style.left = `${t.delayTime * PIXELS_PER_SEC}px`; } }); slider.addEventListener('change', async e => { const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id); if(!t) return; t.delayTime = parseFloat(e.target.value); if (db && !id.startsWith("local_")) await db.collection(col).doc(id).update({ delayTime: t.delayTime }); else renderUI(); }); });
  document.querySelectorAll('.delete-btn').forEach(btn => { btn.addEventListener('click', async e => { if(confirm("削除しますか？")) { const id = e.target.getAttribute('data-id'); tracks = tracks.filter(x => x.dbDocId !== id); if (db && !id.startsWith("local_")) await db.collection(col).doc(id).delete(); else renderUI(); } }); });
}

function startTrackSource(track, elapsed = 0) {
  if (!track.buffer || !track.gainNode) return; if (!track.isActive) return;
  if (track.source) { try { track.source.stop(); } catch(e){} }
  track.source = audioCtx.createBufferSource(); track.source.buffer = track.buffer; track.source.loop = track.isLooping; track.source.connect(track.gainNode);
  const targetStartTime = startTime + track.delayTime; const now = audioCtx.currentTime;
  if (isMasterPlaying) { if (now < targetStartTime) { track.source.start(targetStartTime); } else { const offset = now - targetStartTime; if (track.isLooping) { track.source.start(0, offset % track.buffer.duration); } else if (offset < track.buffer.duration) { track.source.start(0, offset); } } }
}

safeAddListener('btn-master-play-stop', 'click', async (e) => {
  if (isTransportBusy || tracks.length === 0) return; isTransportBusy = true;
  try {
    if (!isMasterPlaying) {
      await initAudio(); isMasterPlaying = true;
      e.target.innerText = "自分の音を停止"; e.target.classList.add('recording');
      startTime = audioCtx.currentTime; tracks.forEach(t => startTrackSource(t, 0)); updateProgress();
    } else {
      isMasterPlaying = false;
      e.target.innerText = "自分の音を再生"; e.target.classList.remove('recording');
      tracks.forEach(t => { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } });
      cancelAnimationFrame(animationFrameId); 
      const playhead = document.getElementById('playhead');
      if (playhead) playhead.style.left = '0px';
    }
  } finally { isTransportBusy = false; }
});

function updateProgress() {
  animationFrameId = requestAnimationFrame(updateProgress); if (!isMasterPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  const playhead = document.getElementById('playhead');
  if (playhead) playhead.style.left = `${elapsed * PIXELS_PER_SEC}px`;
  if (elapsed >= 20) { if (isMasterLooping) { startTime += 20; tracks.forEach(t => { if (t.isActive && !t.isLooping) { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } startTrackSource(t, 0); } }); } else { document.getElementById('btn-master-play-stop').click(); } }
}

// ======= ★みんなの音をランダム順次再生するシステム =======
safeAddListener('btn-listen-everyone', 'click', async (e) => {
  await initAudio();
  if (!isListeningEveryone) {
    isListeningEveryone = true;
    e.target.innerText = "鑑賞を停止する";
    e.target.classList.add('recording');
    document.getElementById('current-playing-info').innerText = "みんなの音を読み込み中...";
    startListenEveryone();
  } else {
    isListeningEveryone = false;
    e.target.innerText = "みんなの音を聴きながら鑑賞する";
    e.target.classList.remove('recording');
    document.getElementById('current-playing-info').innerText = "";
    stopListenEveryone();
  }
});

async function startListenEveryone() {
  const collectionName = (appMode === "mikiki") ? "make_tracks" : "guide_tracks";
  if (db) {
    try {
      const snap = await db.collection(collectionName).get();
      everyoneTracks = [];
      snap.forEach(doc => {
        const data = doc.data();
        if(data.url) everyoneTracks.push(data);
      });
      
      if (everyoneTracks.length === 0) {
        document.getElementById('current-playing-info').innerText = "まだ投稿された音がありません。";
        isListeningEveryone = false;
        const btn = document.getElementById('btn-listen-everyone');
        if (btn) {
          btn.innerText = "みんなの音を聴きながら鑑賞する";
          btn.classList.remove('recording');
        }
        return;
      }
      
      shuffleArray(everyoneTracks);
      playNextEveryoneTrack(0);
    } catch(err) {
      document.getElementById('current-playing-info').innerText = "読み込みに失敗しました。";
    }
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function playNextEveryoneTrack(index) {
  if (!isListeningEveryone) return;
  
  if (index >= everyoneTracks.length) {
    shuffleArray(everyoneTracks);
    index = 0;
  }
  
  const trackData = everyoneTracks[index];
  const infoEl = document.getElementById('current-playing-info');
  if (infoEl) infoEl.innerText = `♪ 再生中: ${trackData.name || "名無しの音"} (by ${trackData.user || "誰か"})`;
  
  try {
    const res = await fetch(formalizeUrl(trackData.url));
    if (res.ok) {
      const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
      currentEveryoneSource = audioCtx.createBufferSource();
      currentEveryoneSource.buffer = buf;
      
      const gain = audioCtx.createGain();
      gain.gain.value = 1.0;
      const revGain = audioCtx.createGain();
      revGain.gain.value = 0.5;
      
      currentEveryoneSource.connect(gain);
      currentEveryoneSource.connect(revGain);
      gain.connect(dryGain);
      revGain.connect(wetGain);
      
      currentEveryoneSource.onended = () => {
        if (!isListeningEveryone) return;
        if (infoEl) infoEl.innerText = "（余韻...）";
        const waitTime = Math.random() * 2000 + 1000; 
        everyonePlayTimeout = setTimeout(() => {
          playNextEveryoneTrack(index + 1);
        }, waitTime);
      };
      
      currentEveryoneSource.start(0);
    } else {
      playNextEveryoneTrack(index + 1);
    }
  } catch(e) {
    playNextEveryoneTrack(index + 1);
  }
}

function stopListenEveryone() {
  if (currentEveryoneSource) {
    try { currentEveryoneSource.stop(); } catch(e){}
    currentEveryoneSource = null;
  }
  if (everyonePlayTimeout) {
    clearTimeout(everyonePlayTimeout);
    everyonePlayTimeout = null;
  }
}
