// ==============================================
// 「絵画を聴く」 音声ガイド＋ミキキ完全統合版 app.js
// ==============================================

// Firebase初期化
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

let appMode = ""; // "mikiki" or "guide"
let exhibitMode = ""; // "beacon", "camera", "guide"
let currentUser = "";
let audioCtx;

let masterGain, convolver, dryGain, wetGain;
let mediaRecorder, recordedChunks = [];
let isRecording = false;

// ======= ワークショップ（自分の編集）用変数 =======
let tracks = [];
let isMasterPlaying = false;
let isMasterLooping = true;
let startTime = 0;
let animationFrameId;
let isTransportBusy = false;
let unsubscribeTracks = null;

const PIXELS_PER_SEC = 30;

// ★17個のプリセット音源
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

// ======= 展示モード用変数 =======
const MIKIKI_WORKS = [
  { id: "mikiki_workA", beaconName: "KBPro_185046", fileName: "exhibit_a.mp3", buffer: null, gainNode: null, source: null, lastSeen: 0, currentVolume: 0, targetVolume: 0 },
  { id: "mikiki_workB", beaconName: "KBPro_183636", fileName: "exhibit_b.mp3", buffer: null, gainNode: null, source: null, lastSeen: 0, currentVolume: 0, targetVolume: 0 },
  { id: "mikiki_workC", beaconName: "KBPro_511316", fileName: "exhibit_c.mp3", buffer: null, gainNode: null, source: null, lastSeen: 0, currentVolume: 0, targetVolume: 0 },
  { id: "mikiki_workD", beaconName: "KBPro_D",      fileName: "exhibit_d.mp3", buffer: null, gainNode: null, source: null, lastSeen: 0, currentVolume: 0, targetVolume: 0 },
  { id: "mikiki_workE", beaconName: "KBPro_E",      fileName: "exhibit_e.mp3", buffer: null, gainNode: null, source: null, lastSeen: 0, currentVolume: 0, targetVolume: 0 },
  { id: "mikiki_workF", beaconName: "KBPro_F",      fileName: "exhibit_f.mp3", buffer: null, gainNode: null, source: null, lastSeen: 0, currentVolume: 0, targetVolume: 0 }
];

const AR_TARGET_COLORS = {
  mikiki_workA: { r: 140, g: 50,  b: 50  },
  mikiki_workB: { r: 40,  g: 60,  b: 110 },
  mikiki_workC: { r: 70,  g: 100, b: 60  },
  mikiki_workD: { r: 180, g: 140, b: 50  },
  mikiki_workE: { r: 110, g: 60,  b: 90  },
  mikiki_workF: { r: 70,  g: 110, b: 120 }
};

let isListenModePlaying = false;
let isCameraMode = false;
let isMikikiScanning = false;
let mikikiScanInterval = null;
let mikikiFadeInterval = null;
let mikikiBluetoothScan = null;
let cameraStream = null;
let arScanAnimationFrame = null;

let guideAiSource = null;
let exhibitGuideTracks = [];

// ======= 新設：「絵画を聴く」みんなの音をランダムに順次再生する変数 =======
let everyoneTracks = [];
let isListeningEveryone = false;
let currentEveryoneSource = null;
let everyonePlayTimeout = null;

// ======= 画面切り替え =======
const appExhibit = document.getElementById('app-exhibit');
const userModal = document.getElementById('user-modal');
const modalStepLogin = document.getElementById('modal-step-login');
const modalStepSelect = document.getElementById('modal-step-select');
const listenApp = document.getElementById('listen-app');
const mainApp = document.getElementById('main-app');

function resetAudioAndUI() {
  isMasterPlaying = false;
  if (document.getElementById('btn-master-play-stop')) {
    document.getElementById('btn-master-play-stop').innerText = "自分の音を再生";
    document.getElementById('btn-master-play-stop').classList.remove('recording');
  }
  tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(ex){} t.source = null; } });
  cancelAnimationFrame(animationFrameId);
  if (document.getElementById('playhead')) document.getElementById('playhead').style.left = '0px';

  if (isListenModePlaying) {
    if (exhibitMode === "beacon" || exhibitMode === "camera") stopMikikiMode();
    if (exhibitMode === "guide") stopGuideExhibitMode();
    isListenModePlaying = false;
    const btn = document.getElementById('btn-play-unity-audio');
    if (btn) btn.classList.remove('recording');
  }

  if (guideAiSource) { try{guideAiSource.stop()}catch(e){} guideAiSource = null; }
  document.getElementById('btn-guide-base-play').innerText = "AI解説をONにする";
  document.getElementById('btn-guide-base-play').classList.remove('recording');

  // みんなの音再生もリセット
  if (isListeningEveryone) {
    document.getElementById('btn-listen-everyone').click();
  }
}

// --- 最初の画面からの遷移（展示） ---
document.getElementById('btn-choice-exhibit-beacon').addEventListener('click', (e) => {
  e.preventDefault();
  exhibitMode = "beacon"; appMode = "mikiki"; isCameraMode = false;
  appExhibit.style.display = 'none'; listenApp.style.display = 'block';
  document.getElementById('listen-section-title').innerText = "ミキキの交差点 (ビーコン)";
  document.getElementById('btn-play-unity-audio').innerText = "空間を歩いて体験を開始";
  document.getElementById('guide-info-area').style.display = 'none';
});

document.getElementById('btn-choice-exhibit-camera').addEventListener('click', (e) => {
  e.preventDefault();
  exhibitMode = "camera"; appMode = "mikiki"; isCameraMode = true;
  appExhibit.style.display = 'none'; listenApp.style.display = 'block';
  document.getElementById('listen-section-title').innerText = "ミキキの交差点 (ARカメラ)";
  document.getElementById('btn-play-unity-audio').innerText = "色を探して体験を開始";
  document.getElementById('guide-info-area').style.display = 'none';
});

document.getElementById('btn-choice-exhibit-guide').addEventListener('click', (e) => {
  e.preventDefault();
  exhibitMode = "guide"; appMode = "guide";
  appExhibit.style.display = 'none'; listenApp.style.display = 'block';
  document.getElementById('listen-section-title').innerText = "非言語音声ガイド";
  document.getElementById('btn-play-unity-audio').innerText = "音声ガイドを聴く";
  document.getElementById('guide-info-area').style.display = 'block';
});

// --- ワークショップへの遷移 ---
document.getElementById('btn-to-workshop').addEventListener('click', () => {
  appExhibit.style.display = 'none'; userModal.style.display = 'flex'; modalStepLogin.style.display = 'block';
});
document.getElementById('btn-ws-login-back').addEventListener('click', () => {
  userModal.style.display = 'none'; modalStepLogin.style.display = 'none'; appExhibit.style.display = 'block';
});
document.getElementById('btn-ws-login').addEventListener('click', async (e) => {
  e.preventDefault();
  const username = document.getElementById('input-username').value.trim();
  if (!username) { alert("名前を入力してください。"); return; }
  currentUser = username;
  modalStepLogin.style.display = 'none'; modalStepSelect.style.display = 'block';
  await initAudio();
});
document.getElementById('btn-ws-select-back').addEventListener('click', () => {
  modalStepSelect.style.display = 'none'; modalStepLogin.style.display = 'block';
});

document.getElementById('btn-choice-mikiki-ws').addEventListener('click', (e) => {
  e.preventDefault(); appMode = "mikiki";
  userModal.style.display = 'none'; mainApp.style.display = 'block';
  document.getElementById('current-user-display').innerText = currentUser;
  document.getElementById('ws-badge').innerText = "ミキキの交差点";
  document.getElementById('guide-base-sound-section').style.display = 'none';
  startSyncTracks();
});

document.getElementById('btn-choice-guide-ws').addEventListener('click', (e) => {
  e.preventDefault(); appMode = "guide";
  userModal.style.display = 'none'; mainApp.style.display = 'block';
  document.getElementById('current-user-display').innerText = currentUser;
  document.getElementById('ws-badge').innerText = "非言語音声ガイド";
  document.getElementById('guide-base-sound-section').style.display = 'block';
  startSyncTracks();
});

document.querySelectorAll('.btn-global-back').forEach(btn => {
  btn.addEventListener('click', () => {
    resetAudioAndUI(); mainApp.style.display = 'none'; listenApp.style.display = 'none'; userModal.style.display = 'none';
    modalStepSelect.style.display = 'none'; appExhibit.style.display = 'block';
  });
});
document.querySelectorAll('.logo-home-trigger').forEach(logo => {
  logo.addEventListener('click', () => {
    resetAudioAndUI(); mainApp.style.display = 'none'; listenApp.style.display = 'none'; userModal.style.display = 'none';
    modalStepSelect.style.display = 'none'; modalStepLogin.style.display = 'none'; appExhibit.style.display = 'block';
  });
});

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);


// ======= ワークショップ：AI解説ON/OFF =======
document.getElementById('btn-guide-base-play').addEventListener('click', async (e) => {
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

// ======= 展示モード：ミキキの交差点 =======
async function initMikikiWorks() {
  await initAudio();
  const loadPromises = MIKIKI_WORKS.map(async (work) => {
    if (!work.buffer) {
      try {
        const response = await fetch(`assets/sounds/${work.fileName}`);
        if (response.ok) work.buffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
      } catch(e) {}
    }
    if (!work.gainNode && audioCtx) {
      work.gainNode = audioCtx.createGain(); work.gainNode.gain.value = 0.0; work.gainNode.connect(masterGain);
    }
  });
  await Promise.all(loadPromises);
}

async function startMikikiMode() {
  await initMikikiWorks();
  MIKIKI_WORKS.forEach(work => {
    if (work.source) { try{work.source.stop();}catch(e){} }
    if (work.buffer && work.gainNode) {
      work.source = audioCtx.createBufferSource(); work.source.buffer = work.buffer;
      work.source.loop = true; work.source.connect(work.gainNode); work.source.start(0);
    }
    work.targetVolume = 0; work.currentVolume = 0;
  });

  isMikikiScanning = true;
  if (isCameraMode) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const videoEl = document.getElementById('camera-video'); videoEl.srcObject = cameraStream; videoEl.style.display = 'block';
      const canvasEl = document.getElementById('camera-canvas'); canvasEl.width = 64; canvasEl.height = 64;
      scanColorsLoop();
    } catch (err) { alert("カメラへのアクセスが拒否されました。"); }
  } else {
    try {
      if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) throw new Error("Web Bluetooth非対応です。");
      mikikiBluetoothScan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
      navigator.bluetooth.addEventListener('advertisementreceived', handleBeaconAdvertisement);
      if (mikikiScanInterval) clearInterval(mikikiScanInterval);
      mikikiScanInterval = setInterval(() => {
        const now = Date.now();
        MIKIKI_WORKS.forEach(work => { if (now - work.lastSeen > 3000) work.targetVolume = 0.0; });
      }, 1000);
    } catch (error) { alert("Bluetoothスキャンを開始できませんでした。"); }
  }

  if (mikikiFadeInterval) clearInterval(mikikiFadeInterval);
  mikikiFadeInterval = setInterval(() => {
    MIKIKI_WORKS.forEach(work => {
      if (Math.abs(work.currentVolume - work.targetVolume) > 0.01) {
        work.currentVolume += (work.targetVolume - work.currentVolume) * 0.05;
        if(work.gainNode) work.gainNode.gain.value = work.currentVolume;
      } else if (work.currentVolume !== work.targetVolume) {
        work.currentVolume = work.targetVolume;
        if(work.gainNode) work.gainNode.gain.value = work.currentVolume;
      }
    });
  }, 33);
}

function handleBeaconAdvertisement(event) {
  const deviceName = event.device.name; if (!deviceName) return;
  const work = MIKIKI_WORKS.find(w => deviceName.includes(w.beaconName));
  if (work) {
    work.lastSeen = Date.now();
    const rssi = event.rssi; let targetVol = 0;
    if (rssi >= -50) targetVol = 1.0; else if (rssi <= -90) targetVol = 0.0; else targetVol = (rssi + 90) / 40;
    work.targetVolume = targetVol;
  }
}

function scanColorsLoop() {
  if (!isMikikiScanning || !isCameraMode) return;
  const videoEl = document.getElementById('camera-video'); const canvasEl = document.getElementById('camera-canvas');
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    const data = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    let counts = { mikiki_workA: 0, mikiki_workB: 0, mikiki_workC: 0, mikiki_workD: 0, mikiki_workE: 0, mikiki_workF: 0 };
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      if ((r > 240 && g > 240 && b > 240) || (r < 20 && g < 20 && b < 20)) continue;
      for (let key in AR_TARGET_COLORS) {
        const tc = AR_TARGET_COLORS[key];
        if (Math.sqrt(Math.pow(r - tc.r, 2) + Math.pow(g - tc.g, 2) + Math.pow(b - tc.b, 2)) < 45) counts[key]++;
      }
    }
    MIKIKI_WORKS.forEach(work => {
      const count = counts[work.id]; work.targetVolume = count > 30 ? Math.min((count - 30) / 100, 1.0) : 0.0; work.lastSeen = Date.now();
    });
  }
  arScanAnimationFrame = requestAnimationFrame(scanColorsLoop);
}

function stopMikikiMode() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; document.getElementById('camera-video').style.display = 'none'; }
  if (arScanAnimationFrame) cancelAnimationFrame(arScanAnimationFrame);
  if (!isCameraMode && isMikikiScanning && navigator.bluetooth) {
    try { navigator.bluetooth.removeEventListener('advertisementreceived', handleBeaconAdvertisement); } catch(e){}
    if (mikikiBluetoothScan && mikikiBluetoothScan.stop) mikikiBluetoothScan.stop();
  }
  isMikikiScanning = false;
  if (mikikiScanInterval) clearInterval(mikikiScanInterval); if (mikikiFadeInterval) clearInterval(mikikiFadeInterval);
  MIKIKI_WORKS.forEach(work => {
    work.targetVolume = 0; work.currentVolume = 0;
    if (work.source) { try{work.source.stop();}catch(e){} work.source = null; }
    if (work.gainNode) { work.gainNode.gain.value = 0; }
  });
}

// 展示モードの再生ボタン制御
document.getElementById('btn-play-unity-audio').addEventListener('click', async (e) => {
  if (!isListenModePlaying) {
    if (exhibitMode === "beacon" || exhibitMode === "camera") { await startMikikiMode(); }
    else if (exhibitMode === "guide") { await startGuideExhibitMode(); }
    isListenModePlaying = true;
    e.target.innerText = "体験を停止する"; e.target.classList.add('recording');
  } else {
    if (exhibitMode === "beacon" || exhibitMode === "camera") { stopMikikiMode(); }
    else if (exhibitMode === "guide") { stopGuideExhibitMode(); }
    isListenModePlaying = false;
    if (exhibitMode === "beacon") e.target.innerText = "空間を歩いて体験を開始 (ビーコン)";
    if (exhibitMode === "camera") e.target.innerText = "色を探して体験を開始 (ARカメラ)";
    if (exhibitMode === "guide") e.target.innerText = "音声ガイドを聴く";
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
document.getElementById('master-reverb').addEventListener('input', updateReverb);

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

document.getElementById('btn-record').addEventListener('click', async (e) => {
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
  if (document.getElementById('empty-msg')) document.getElementById('empty-msg').style.display = 'none';
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
  if (document.getElementById('empty-msg')) { document.getElementById('empty-msg').style.display = 'block'; document.getElementById('empty-msg').innerText = "環境を読み込み中..."; }

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
      if (document.getElementById('empty-msg')) document.getElementById('empty-msg').style.display = 'none';
      tracks = loadedTracks; renderUI(); syncDBTracks("make_tracks");
    });
  } else {
    if (document.getElementById('empty-msg')) document.getElementById('empty-msg').style.display = 'none';
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
    // ミキサーの描画：全員表示
    const mixerEl = document.createElement('div'); mixerEl.className = 'track-item';
    const activeBtnStyle = track.isActive ? "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:var(--text-main); color:var(--bg-color); border:1px solid var(--text-main);" : "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:transparent; color:var(--text-muted); border:1px solid var(--text-muted);";
    const onOffBtnHTML = `<button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} cursor:pointer; flex-shrink:0;">${track.isActive ? 'ON' : 'OFF'}</button>`;
    const nameTrackHTML = track.isPreset ? `<span class="track-name-label" style="font-weight:bold; color:var(--text-main);">${track.name}</span>` : `<input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}" style="color:var(--text-main);">`;
    const deleteBtnHTML = !track.isPreset ? `<button class="action-btn delete-btn" data-id="${track.dbDocId}">削除</button>` : '';
    const delaySliderHTML = `<div class="vol-slider-wrapper" style="width:100px; display:flex; flex-direction:column; align-items:flex-start; gap:2px;"><span style="font-size:0.55rem; color:var(--text-muted);">Start</span><input type="range" class="track-delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}"></div>`;

    mixerEl.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;"><div style="display:flex; align-items:center; gap:8px;">${onOffBtnHTML}${nameTrackHTML}</div><div style="display:flex; align-items:center; gap:12px;"><button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button><div style="display:flex; align-items:center; gap:8px;">${deleteBtnHTML}</div></div></div><div style="display:flex; justify-content:flex-end; align-items:center; gap:16px; width:100%;">${delaySliderHTML}</div>`;
    if (trackListEl) trackListEl.appendChild(mixerEl);

    // タイムラインの描画：ON(isActive=true)のものだけを生成して追加
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

document.getElementById('btn-master-play-stop').addEventListener('click', async (e) => {
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
      cancelAnimationFrame(animationFrameId); if (document.getElementById('playhead')) document.getElementById('playhead').style.left = '0px';
    }
  } finally { isTransportBusy = false; }
});

function updateProgress() {
  animationFrameId = requestAnimationFrame(updateProgress); if (!isMasterPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  if (document.getElementById('playhead')) document.getElementById('playhead').style.left = `${elapsed * PIXELS_PER_SEC}px`;
  if (elapsed >= 20) { if (isMasterLooping) { startTime += 20; tracks.forEach(t => { if (t.isActive && !t.isLooping) { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } startTrackSource(t, 0); } }); } else { document.getElementById('btn-master-play-stop').click(); } }
}

// ======= ★新設：「みんなの音を聴く」ランダム順次再生システム =======
document.getElementById('btn-listen-everyone').addEventListener('click', async (e) => {
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
        document.getElementById('btn-listen-everyone').innerText = "みんなの音を聴きながら鑑賞する";
        document.getElementById('btn-listen-everyone').classList.remove('recording');
        return;
      }

      // 最初からシャッフルして再生開始
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
    // ひと巡りしたら再度シャッフルして最初からループ
    shuffleArray(everyoneTracks);
    index = 0;
  }

  const trackData = everyoneTracks[index];
  document.getElementById('current-playing-info').innerText = `♪ 再生中: ${trackData.name || "名無しの音"} (by ${trackData.user || "誰か"})`;

  try {
    const res = await fetch(formalizeUrl(trackData.url));
    if (res.ok) {
      const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
      currentEveryoneSource = audioCtx.createBufferSource();
      currentEveryoneSource.buffer = buf;

      // みんなの音は少し残響をかけて空間に馴染ませる
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
        document.getElementById('current-playing-info').innerText = "（余韻...）";
        // 1秒〜3秒のランダムな「間」を空けて次の音へ
        const waitTime = Math.random() * 2000 + 1000;
        everyonePlayTimeout = setTimeout(() => {
          playNextEveryoneTrack(index + 1);
        }, waitTime);
      };

      currentEveryoneSource.start(0);
    } else {
      // 取得失敗時はすぐ次へ
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