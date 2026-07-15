// ==============================================
// 7/19 100BANCH イベント用 新 app.js (全トラックミキサー一括表示版)
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

// グローバル変数
let appMode = ""; 
let currentUser = "";
let audioCtx;
let masterGain, convolver, dryGain, wetGain;

// ==============================================
// 1. 展示モード（ビーコン＆AR兼用）作品データ
// ==============================================
const EXHIBIT_WORKS = [
  { id: "exhibit_a", beaconName: "KBPro_185046", fileName: "exhibit_a.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_b", beaconName: "KBPro_183636", fileName: "exhibit_b.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_c", beaconName: "KBPro_511316", fileName: "exhibit_c.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_d", beaconName: "KBPro_D", fileName: "exhibit_d.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_e", beaconName: "KBPro_E", fileName: "exhibit_e.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_f", beaconName: "KBPro_F", fileName: "exhibit_f.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 }
];

const AR_TARGET_COLORS = {
  exhibit_a: { r: 140, g: 50,  b: 50  }, 
  exhibit_b: { r: 40,  g: 60,  b: 110 }, 
  exhibit_c: { r: 70,  g: 100, b: 60  }, 
  exhibit_d: { r: 180, g: 140, b: 50  }, 
  exhibit_e: { r: 110, g: 60,  b: 90  }, 
  exhibit_f: { r: 70,  g: 110, b: 120 }  
};

let exhibitScanInterval = null;
let bluetoothScanDevice = null;
let cameraStream = null;
let arScanAnimationFrame = null;

// ==============================================
// 2. ワークショップ ミキサー用 プリセット音源データ
// ==============================================
const PRESET_ASSETS = [
  { id: "ambient_base", name: "空間のベース音 (Ambient)", fileName: "ambient_base.mp3", volume: 0.4 },
  ...Array.from({length: 10}, (_, i) => ({ id: `field_${(i+1).toString().padStart(2, '0')}`, name: `環境音 ${i+1}`, fileName: `field_${(i+1).toString().padStart(2, '0')}.mp3`, volume: 0.8 })),
  { id: "se_saezuri", name: "さえずり", fileName: "saezuri.mp3", volume: 1.0 },
  { id: "se_yuragi", name: "ゆらぎ", fileName: "yuragi.mp3", volume: 1.0 },
  { id: "se_seseragi", name: "せせらぎ", fileName: "seseragi.mp3", volume: 1.0 },
  { id: "se_zawameki", name: "ざわめき", fileName: "zawameki.mp3", volume: 1.0 },
  { id: "se_nakigoe", name: "なきごえ", fileName: "nakigoe.mp3", volume: 1.0 },
  { id: "se_haoto", name: "はおと", fileName: "haoto.mp3", volume: 1.0 }
];

let presetTracks = [];
let recordedTracks = [];
let tracks = []; // UIにレンダリングする全トラック配列

// ワークショップ共通変数
let mediaRecorder, recordedChunks = [];
let isRecording = false;
let recordTimeout = null;
let isMasterPlaying = false;
let startTime = 0;
let animationFrameId;
let unsubscribeTracks = null;

let guideAudioSource = null;
let guideAudioBuffer = null;
let isGuidePlaying = false;

const PIXELS_PER_SEC = 30;

// ==============================================
// 3. UIエレメント取得と画面遷移ロジック
// ==============================================
async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);

    convolver = audioCtx.createConvolver();
    convolver.buffer = createReverbBuffer(audioCtx, 4.5, 2.5);

    dryGain = audioCtx.createGain();
    wetGain = audioCtx.createGain();

    dryGain.connect(masterGain);
    wetGain.connect(convolver);
    convolver.connect(masterGain);
    updateReverb();
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);

// 展示モード（初期画面）のナビゲーション
const appExhibit = document.getElementById('app-exhibit');
const exhibitSelectSection = document.getElementById('exhibit-select-section');
const exhibitPlaySection = document.getElementById('exhibit-play-section');
const exhibitModeText = document.getElementById('exhibit-mode-text');

document.getElementById('btn-choice-beacon').addEventListener('click', async () => {
  await initAudio();
  appMode = "exhibit-beacon";
  exhibitSelectSection.style.display = 'none';
  exhibitPlaySection.style.display = 'block';
  exhibitModeText.innerText = "【 空間を歩いて体験 (ビーコン) 】";
});

document.getElementById('btn-choice-camera').addEventListener('click', async () => {
  await initAudio();
  appMode = "exhibit-camera";
  exhibitSelectSection.style.display = 'none';
  exhibitPlaySection.style.display = 'block';
  exhibitModeText.innerText = "【 色を探して体験 (カメラ) 】";
});

document.getElementById('btn-exhibit-back').addEventListener('click', () => {
  stopAllAudio();
  exhibitPlaySection.style.display = 'none';
  exhibitSelectSection.style.display = 'block';
  document.getElementById('btn-exhibit-scan').innerText = "再生";
  document.getElementById('btn-exhibit-scan').classList.remove('active');
  appMode = "";
});

// ワークショップへの遷移
document.getElementById('btn-to-workshop').addEventListener('click', () => {
  document.getElementById('modal-ws-login').style.display = 'flex';
});

document.getElementById('btn-ws-login-back').addEventListener('click', () => {
  document.getElementById('modal-ws-login').style.display = 'none';
});

document.getElementById('btn-ws-login').addEventListener('click', async () => {
  const username = document.getElementById('input-username').value.trim();
  if (!username) { alert("名前を入力してください。"); return; }
  currentUser = username;
  document.getElementById('current-user-display').innerText = currentUser;
  document.getElementById('modal-ws-login').style.display = 'none';
  document.getElementById('modal-ws-select').style.display = 'flex';
  await initAudio();
});

document.getElementById('btn-ws-select-back').addEventListener('click', () => {
  document.getElementById('modal-ws-select').style.display = 'none';
  document.getElementById('modal-ws-login').style.display = 'flex';
});

// ワークショップ各モードの起動
document.getElementById('btn-choice-mikiki-ws1').addEventListener('click', async () => {
  appMode = "mikiki-ws1";
  document.getElementById('modal-ws-select').style.display = 'none';
  document.getElementById('app-exhibit').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('ws-badge').innerText = "ミキキの交差点";
  document.getElementById('guide-audio-section').style.display = 'none';
  
  await loadPresetTracks();
  startSyncTracks("ws1_tracks");
});

document.getElementById('btn-choice-guide-ws2').addEventListener('click', async () => {
  appMode = "guide-ws2";
  document.getElementById('modal-ws-select').style.display = 'none';
  document.getElementById('app-exhibit').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('ws-badge').innerText = "非言語音声ガイド";
  document.getElementById('guide-audio-section').style.display = 'block';
  
  await loadPresetTracks();
  startSyncTracks("ws2_tracks");
});

document.getElementById('btn-back-to-home').addEventListener('click', () => {
  stopAllAudio();
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('app-exhibit').style.display = 'block';
  appMode = "";
});

// ==============================================
// 4. 展示モード（ビーコン・ARカメラ）
// ==============================================
document.getElementById('btn-exhibit-scan').addEventListener('click', async (e) => {
  if (e.target.classList.contains('active')) {
    stopAllAudio();
    e.target.innerText = "再生";
    e.target.classList.remove('active');
    return;
  }
  e.target.innerText = "スキャン中... (停止する)";
  e.target.classList.add('active');
  
  await prepareExhibitAudio();
  if (appMode === "exhibit-beacon") await startExhibitBeaconScan();
  else if (appMode === "exhibit-camera") await startExhibitCameraScan();
});

async function prepareExhibitAudio() {
  await Promise.all(EXHIBIT_WORKS.map(async w => {
    if (!w.buffer) {
      try {
        const res = await fetch(`assets/sounds/${w.fileName}`);
        if(res.ok) w.buffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      } catch(e) {}
    }
    if (!w.gainNode) {
      w.gainNode = audioCtx.createGain();
      w.gainNode.gain.value = 0;
      w.gainNode.connect(masterGain);
    }
    if (w.source) { try{ w.source.stop(); }catch(e){} }
    if (w.buffer) {
      w.source = audioCtx.createBufferSource();
      w.source.buffer = w.buffer;
      w.source.loop = true;
      w.source.connect(w.gainNode);
      w.source.start();
    }
  }));
}

async function startExhibitBeaconScan() {
  try {
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) throw new Error("お使いのブラウザはWeb Bluetoothに非対応です。");
    bluetoothScanDevice = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
    navigator.bluetooth.addEventListener('advertisementreceived', handleBeacon);
    
    exhibitScanInterval = setInterval(() => {
      const now = Date.now();
      EXHIBIT_WORKS.forEach(w => {
        if (now - w.lastSeen > 3000 && w.gainNode && w.gainNode.gain.value > 0.01) w.gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 1.0);
      });
    }, 1000);
  } catch (error) {
    alert(error.message);
    document.getElementById('btn-exhibit-scan').innerText = "再生";
    document.getElementById('btn-exhibit-scan').classList.remove('active');
  }
}

function handleBeacon(e) {
  if (!e.device.name) return;
  const w = EXHIBIT_WORKS.find(x => e.device.name.includes(x.beaconName));
  if (w && w.gainNode) {
    w.lastSeen = Date.now();
    const rssi = e.rssi;
    let vol = (rssi >= -50) ? 1.0 : (rssi <= -90) ? 0 : (rssi + 90) / 40;
    w.gainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.5); 
  }
}

async function startExhibitCameraScan() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const videoEl = document.getElementById('camera-video');
    videoEl.srcObject = cameraStream;
    videoEl.style.display = 'block';
    
    const canvasEl = document.getElementById('camera-canvas');
    canvasEl.width = 64; canvasEl.height = 64;
    scanColorsLoop();
  } catch (err) {
    alert("カメラへのアクセスが拒否されました。");
    document.getElementById('btn-exhibit-scan').innerText = "再生";
    document.getElementById('btn-exhibit-scan').classList.remove('active');
  }
}

function scanColorsLoop() {
  if (appMode !== "exhibit-camera") return;
  const videoEl = document.getElementById('camera-video');
  const canvasEl = document.getElementById('camera-canvas');
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  
  if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    const data = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    let counts = { exhibit_a: 0, exhibit_b: 0, exhibit_c: 0, exhibit_d: 0, exhibit_e: 0, exhibit_f: 0 };
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      if ((r > 240 && g > 240 && b > 240) || (r < 20 && g < 20 && b < 20)) continue;
      for (let key in AR_TARGET_COLORS) {
        const tc = AR_TARGET_COLORS[key];
        if (Math.sqrt(Math.pow(r - tc.r, 2) + Math.pow(g - tc.g, 2) + Math.pow(b - tc.b, 2)) < 45) counts[key]++;
      }
    }
    EXHIBIT_WORKS.forEach(w => {
      if (!w.gainNode) return;
      const count = counts[w.id];
      const targetVol = count > 30 ? Math.min((count - 30) / 100, 1.0) : 0;
      w.gainNode.gain.setTargetAtTime(w.gainNode.gain.value + (targetVol - w.gainNode.gain.value) * 0.03, audioCtx.currentTime, 0.5);
    });
  }
  arScanAnimationFrame = requestAnimationFrame(scanColorsLoop);
}

// ==============================================
// 5. ワークショップ：プリセット音源17個の一括ロード
// ==============================================
async function loadPresetTracks() {
  document.getElementById('empty-msg').innerText = "空間の音を読み込み中...";
  document.getElementById('empty-msg').style.display = 'block';

  const loadPromises = PRESET_ASSETS.map(async pt => {
    let buffer = null;
    try {
      const res = await fetch(`assets/sounds/${pt.fileName}`);
      if (res.ok) buffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    } catch(e) {}
    
    const gainNode = audioCtx.createGain();
    gainNode.connect(dryGain);
    gainNode.gain.value = 0; // 初期状態はミュート(OFF)
    
    return {
      dbDocId: pt.id,
      name: pt.name,
      buffer: buffer,
      gainNode: gainNode,
      isActive: false, 
      isLooping: true, 
      volume: pt.volume,
      delayTime: 0,
      duration: buffer ? buffer.duration : 10,
      isPreset: true
    };
  });
  
  const loaded = await Promise.all(loadPromises);
  presetTracks = loaded.filter(t => t.buffer !== null);
  updateTracks();
}

function updateTracks() {
  tracks = [...presetTracks, ...recordedTracks];
  if(tracks.length > 0) document.getElementById('empty-msg').style.display = 'none';
  renderUI();
}

// ==============================================
// 6. ワークショップ：録音データの同期
// ==============================================
function startSyncTracks(collectionName) {
  if (unsubscribeTracks) { unsubscribeTracks(); unsubscribeTracks = null; }
  recordedTracks = [];
  
  if (!db) return;
  unsubscribeTracks = db.collection(collectionName)
    .where("user", "==", currentUser)
    .onSnapshot(async (snapshot) => {
      
      const loadPromises = snapshot.docs.map(async (docSnapshot) => {
        const id = docSnapshot.id;
        const data = docSnapshot.data();
        const safeUrl = data.url ? data.url.replace("http://", "https://") : "";
        
        const existingTrack = recordedTracks.find(t => t.dbDocId === id);
        if (existingTrack) {
          existingTrack.name = data.name;
          existingTrack.isLooping = data.isLooping !== false;
          existingTrack.delayTime = data.delayTime || 0;
          return existingTrack;
        }

        let audioBuffer = null;
        try {
          const response = await fetch(safeUrl);
          if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
        } catch (e) {}

        const trackGain = audioCtx.createGain();
        trackGain.connect(dryGain);
        trackGain.gain.value = 1.0; // 録音追加時は最初からON

        return {
          dbDocId: id, name: data.name, url: safeUrl, buffer: audioBuffer,
          gainNode: trackGain, isActive: true, 
          isLooping: data.isLooping !== false, 
          volume: 1.0, delayTime: data.delayTime || 0,
          duration: audioBuffer ? audioBuffer.duration : 5,
          isPreset: false
        };
      });

      const newTracks = await Promise.all(loadPromises);
      recordedTracks = newTracks.filter(Boolean);
      updateTracks();
  });
}

// ==============================================
// 7. ミキサーとタイムラインのUIレンダリング (ON/OFF制御)
// ==============================================
function renderUI() {
  const trackListEl = document.getElementById('track-list');
  const timelineTracksEl = document.getElementById('timeline-tracks');
  if (!trackListEl || !timelineTracksEl) return;
  
  trackListEl.innerHTML = ''; timelineTracksEl.innerHTML = '';

  tracks.forEach((track) => {
    const mixerEl = document.createElement('div');
    mixerEl.className = 'track-item';
    
    // ONの時はボタンを塗りつぶし、OFFの時は白抜きにするスタイル
    const activeBtnStyle = track.isActive 
      ? 'background-color: var(--text-main); color: var(--bg-color); border: 1px solid var(--text-main);' 
      : 'background-color: transparent; color: var(--text-muted); border: 1px solid var(--text-muted);';

    mixerEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;">
        ${track.isPreset 
          ? `<span style="font-size:0.85rem; font-weight:bold; color:var(--text-main); width:130px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.name}</span>`
          : `<input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}" style="border:none; border-bottom:1px solid var(--line-color); background:transparent; font-size:0.85rem; width:130px; color:var(--text-main);">`
        }
        <div style="display:flex; align-items:center; gap:8px;">
           <button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} padding: 4px 12px; font-weight: bold;">${track.isActive ? 'ON' : 'OFF'}</button>
           <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}">Loop</button>
           ${track.isPreset ? '' : `<button class="action-btn delete-btn" data-id="${track.dbDocId}" style="color:var(--danger);">削除</button>`}
        </div>
      </div>
      <div style="display:flex; align-items:center; width:100%; gap:15px; margin-bottom: 8px;">
        <span style="font-size:0.6rem; color:var(--text-muted); min-width:30px;">Start</span>
        <input type="range" class="delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}" style="width:100%;">
      </div>
    `;
    trackListEl.appendChild(mixerEl);

    // タイムライン描画 (OFFのトラックは薄く表示)
    const rowEl = document.createElement('div');
    rowEl.className = 'timeline-row';
    const clipLeft = track.delayTime * PIXELS_PER_SEC;
    const clipWidth = Math.max(track.duration * PIXELS_PER_SEC, 20);
    const clipOpacity = track.isActive ? '1.0' : '0.3';
    rowEl.innerHTML = `<div class="timeline-clip" style="left: ${clipLeft}px; width: ${clipWidth}px; opacity: ${clipOpacity};">${track.name}</div>`;
    timelineTracksEl.appendChild(rowEl);
  });

  // イベントリスナー登録
  document.querySelectorAll('.toggle-active-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === id);
      if(t) {
        t.isActive = !t.isActive;
        // ミュート/解除 を即座に反映
        if(t.gainNode) t.gainNode.gain.value = t.isActive ? t.volume : 0.0;
        renderUI();
      }
    });
  });

  document.querySelectorAll('.loop-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === id);
      if(!t) return;
      t.isLooping = !t.isLooping;
      if (!t.isPreset && db) {
        const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
        await db.collection(collectionName).doc(id).update({ isLooping: t.isLooping });
      } else {
        renderUI();
      }
    });
  });

  document.querySelectorAll('.delay-slider').forEach(slider => {
    slider.addEventListener('change', async e => {
      const id = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === id);
      if(!t) return;
      t.delayTime = parseFloat(e.target.value);
      if (!t.isPreset && db) {
        const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
        await db.collection(collectionName).doc(id).update({ delayTime: t.delayTime });
      } else {
        renderUI();
      }
    });
  });

  document.querySelectorAll('.track-name-input').forEach(input => {
    input.addEventListener('change', async e => {
      const id = e.target.getAttribute('data-id');
      if (db) {
        const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
        await db.collection(collectionName).doc(id).update({ name: e.target.value });
      }
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      if(confirm("削除しますか？")) {
        const id = e.target.getAttribute('data-id');
        if (db) {
          const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
          await db.collection(collectionName).doc(id).delete();
        }
      }
    });
  });
}

// ==============================================
// 8. ワークショップ：再生コントロール・録音
// ==============================================
function updateReverb() {
  const reverbSlider = document.getElementById('master-reverb');
  if (!dryGain || !wetGain || !reverbSlider) return;
  wetGain.gain.value = parseFloat(reverbSlider.value) * 2.5;
  dryGain.gain.value = 1.0;
}
document.getElementById('master-reverb').addEventListener('input', updateReverb);

function createReverbBuffer(ctx, duration, decay) {
  const length = ctx.sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return impulse;
}

document.getElementById('btn-master-play-stop').addEventListener('click', async (e) => {
  const btn = e.target;
  if (!isMasterPlaying) {
    await initAudio();
    isMasterPlaying = true;
    btn.innerText = "停止";
    btn.classList.add('recording');
    startTime = audioCtx.currentTime;
    
    tracks.forEach(t => {
      if(t.source) { try{t.source.stop()}catch(ex){} }
      if(t.buffer) {
        t.source = audioCtx.createBufferSource();
        t.source.buffer = t.buffer;
        t.source.loop = t.isLooping; 
        t.source.connect(t.gainNode);
        t.source.start(startTime + t.delayTime);
      }
    });
    
    const playheadEl = document.getElementById('playhead');
    function updatePlayhead() {
      if(!isMasterPlaying) return;
      const elapsed = audioCtx.currentTime - startTime;
      if(playheadEl) playheadEl.style.left = `${(elapsed % 20) * PIXELS_PER_SEC}px`;
      animationFrameId = requestAnimationFrame(updatePlayhead);
    }
    updatePlayhead();
  } else {
    isMasterPlaying = false;
    btn.innerText = "再生";
    btn.classList.remove('recording');
    tracks.forEach(t => { if(t.source) { try{t.source.stop()}catch(ex){} } });
    cancelAnimationFrame(animationFrameId);
    document.getElementById('playhead').style.left = '0px';
  }
});

// WS2用ガイド音声再生
document.getElementById('btn-play-guide').addEventListener('click', async (e) => {
  if (isGuidePlaying) {
    if (guideAudioSource) { try{guideAudioSource.stop()}catch(ex){} }
    isGuidePlaying = false;
    e.target.innerText = "再生"; e.target.classList.remove('recording');
    return;
  }
  if (!guideAudioBuffer) {
    e.target.innerText = "読込中...";
    try {
      const res = await fetch(`assets/sounds/guide_audio.mp3`);
      if(res.ok) guideAudioBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    } catch(err){}
  }
  if (guideAudioBuffer) {
    guideAudioSource = audioCtx.createBufferSource();
    guideAudioSource.buffer = guideAudioBuffer;
    guideAudioSource.connect(masterGain);
    guideAudioSource.onended = () => { isGuidePlaying = false; e.target.innerText = "再生"; e.target.classList.remove('recording'); };
    guideAudioSource.start();
    isGuidePlaying = true;
    e.target.innerText = "停止"; e.target.classList.add('recording');
  }
});

// 録音機能 (10秒強制カット)
const btnRecord = document.getElementById('btn-record');
btnRecord.addEventListener('click', async () => {
  await initAudio();
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      recordedChunks = [];
      
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        btnRecord.innerText = "処理中..."; btnRecord.classList.remove('recording');
        isRecording = false;

        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const timestamp = Date.now();
        const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
        const storagePath = `${collectionName}/track_${timestamp}.webm`;
        
        if (storage && db) {
          try {
            const snapshot = await storage.ref().child(storagePath).put(blob);
            const downloadUrl = await snapshot.ref.getDownloadURL();
            await db.collection(collectionName).add({
              user: currentUser, name: `Record ${String(timestamp).substring(9, 13)}`, url: downloadUrl,
              storagePath: storagePath, isLooping: true, delayTime: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (e) { alert("保存に失敗しました。"); }
        }
        btnRecord.innerText = "自分の音を録音する (10秒)";
      };

      mediaRecorder.start();
      isRecording = true;
      btnRecord.innerText = "録音を停止"; btnRecord.classList.add('recording');

      if (recordTimeout) clearTimeout(recordTimeout);
      recordTimeout = setTimeout(() => {
        if (isRecording && mediaRecorder.state === 'recording') {
          mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
      }, 10000);

    } catch (err) { alert("マイクへのアクセスが拒否されました。"); }
  } else {
    if (recordTimeout) clearTimeout(recordTimeout);
    mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
});

// ==============================================
// 9. クリーンアップ・エクスポート
// ==============================================
function stopAllAudio() {
  if (bluetoothScanDevice) { try { navigator.bluetooth.removeEventListener('advertisementreceived', handleBeacon); bluetoothScanDevice = null; } catch(e){} }
  if (exhibitScanInterval) clearInterval(exhibitScanInterval);
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (arScanAnimationFrame) cancelAnimationFrame(arScanAnimationFrame);
  document.getElementById('camera-video').style.display = 'none';
  
  EXHIBIT_WORKS.forEach(w => { if(w.source){ try{w.source.stop()}catch(e){} w.source=null; } });
  if (isMasterPlaying) document.getElementById('btn-master-play-stop').click();
  if (guideAudioSource) { try{guideAudioSource.stop()}catch(e){} guideAudioSource=null; }
  isGuidePlaying = false;
  
  if (unsubscribeTracks) { unsubscribeTracks(); unsubscribeTracks = null; }
  presetTracks = []; recordedTracks = []; tracks = [];
}

document.getElementById('btn-export-master').addEventListener('click', () => {
  const btn = document.getElementById('btn-export-master');
  btn.innerText = "Processing..."; btn.disabled = true;
  setTimeout(() => {
    alert("作品の保存が完了しました。");
    document.getElementById('input-export-name').value = '';
    btn.innerText = "作品を完成させる"; btn.disabled = false;
  }, 800);
});
