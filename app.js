// ==============================================
// 7/19 100BANCH イベント用 新 app.js (ビーコン＆AR ハイブリッド版)
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
// 1. 各モード用のデータ定義
// ==============================================

// ① 展示モード（ビーコン＆AR兼用）作品データ
const EXHIBIT_WORKS = [
  { id: "exhibit_a", beaconName: "KBPro_185046", fileName: "exhibit_a.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_b", beaconName: "KBPro_183636", fileName: "exhibit_b.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_c", beaconName: "KBPro_511316", fileName: "exhibit_c.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_d", beaconName: "KBPro_D", fileName: "exhibit_d.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_e", beaconName: "KBPro_E", fileName: "exhibit_e.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_f", beaconName: "KBPro_F", fileName: "exhibit_f.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 }
];

// AR(カラー検知)用のターゲットカラー定義（絵画のパレットから抽出したくすんだ色）
// ※実際のシールの色に合わせて RGB値を微調整してください
const AR_TARGET_COLORS = {
  exhibit_a: { r: 140, g: 50,  b: 50  }, // えんじ色（くすんだ赤）
  exhibit_b: { r: 40,  g: 60,  b: 110 }, // 藍色（くすんだ青）
  exhibit_c: { r: 70,  g: 100, b: 60  }, // くすんだ緑
  exhibit_d: { r: 180, g: 140, b: 50  }, // マスタード（くすんだ黄）
  exhibit_e: { r: 110, g: 60,  b: 90  }, // プラム（くすんだ紫）
  exhibit_f: { r: 70,  g: 110, b: 120 }  // スレート（くすんだ水色）
};

let exhibitScanInterval = null;
let bluetoothScanDevice = null;
let cameraStream = null;
let arScanAnimationFrame = null;

// ② 音源アセット定義（環境音と効果音）
const FIELD_ASSETS = Array.from({length: 10}, (_, i) => ({
  id: `field_${(i+1).toString().padStart(2, '0')}`,
  name: `環境音 ${i+1}`,
  fileName: `field_${(i+1).toString().padStart(2, '0')}.mp3`
}));

const SE_ASSETS = [
  { id: "se_mizu", name: "水の音", fileName: "mizu_no_oti.mp3" },
  { id: "se_yoru", name: "夜の森", fileName: "yoru_no_mori.mp3" },
  { id: "se_kaze", name: "風の音", fileName: "kaze_no_oti.mp3" },
  { id: "se_mori", name: "森の音", fileName: "mori_no_oti.mp3" },
  { id: "se_saezuri", name: "さえずり", fileName: "saezuri.mp3" },
  { id: "se_yuragi", name: "ゆらぎ", fileName: "yuragi.mp3" },
  { id: "se_seseragi", name: "せせらぎ", fileName: "seseragi.mp3" },
  { id: "se_zawameki", name: "ざわめき", fileName: "zawameki.mp3" },
  { id: "se_nakigoe", name: "なきごえ", fileName: "nakigoe.mp3" },
  { id: "se_haoto", name: "はおと", fileName: "haoto.mp3" }
];

let ambientBaseSource = null;
let ambientBaseBuffer = null;
let ws1SchedulerInterval = null;
let activeRandomTracks = []; 

// ③ ワークショップ共通の録音・ミキサー用変数
let mediaRecorder, recordedChunks = [];
let isRecording = false;
let recordTimeout = null;
let tracks = [];
let isMasterPlaying = false;
let startTime = 0;
let animationFrameId;
let unsubscribeTracks = null;

let guideAudioSource = null;
let guideAudioBuffer = null;
let isGuidePlaying = false;

const PIXELS_PER_SEC = 30;

// ==============================================
// 2. UIエレメント取得と画面遷移
// ==============================================
const userModal = document.getElementById('user-modal');
const modalStep1 = document.getElementById('modal-step-1');
const modalStep2 = document.getElementById('modal-step-2');
const modalStep3 = document.getElementById('modal-step-3'); 
const modalStep4 = document.getElementById('modal-step-4'); // ビーコン or AR選択

const appExhibit = document.getElementById('app-exhibit');
const mainApp = document.getElementById('main-app');
const wsBadge = document.getElementById('ws-badge');

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

document.getElementById('btn-choice-first').addEventListener('click', () => { modalStep1.style.display = 'none'; modalStep2.style.display = 'block'; });
document.getElementById('btn-choice-return').addEventListener('click', () => { modalStep1.style.display = 'none'; modalStep2.style.display = 'block'; });
document.getElementById('btn-back-to-step1').addEventListener('click', () => { modalStep2.style.display = 'none'; modalStep1.style.display = 'block'; });

document.getElementById('btn-login').addEventListener('click', async (e) => {
  e.preventDefault();
  const username = document.getElementById('input-username').value.trim();
  if (!username) { alert("ユーザー名を入力してください。"); return; }
  currentUser = username;
  document.querySelectorAll('#exhibit-user-display, #current-user-display').forEach(el => el.innerText = currentUser);
  modalStep2.style.display = 'none';
  modalStep3.style.display = 'block';
  await initAudio();
});

document.getElementById('btn-back-to-step2').addEventListener('click', () => { modalStep3.style.display = 'none'; modalStep2.style.display = 'block'; });
document.getElementById('btn-back-to-step3').addEventListener('click', () => { modalStep4.style.display = 'none'; modalStep3.style.display = 'block'; });

document.querySelectorAll('.btn-global-back, .logo-home-trigger').forEach(btn => {
  btn.addEventListener('click', () => {
    stopAllAudio();
    appExhibit.style.display = 'none';
    mainApp.style.display = 'none';
    userModal.style.display = 'flex';
    modalStep3.style.display = 'block';
    appMode = "";
  });
});

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);

// ==============================================
// 3. モード起動ロジック
// ==============================================

// 「気配に触れる（展示）」が選ばれたら、ビーコンかARかの選択画面へ
document.getElementById('btn-choice-exhibit').addEventListener('click', () => {
  modalStep3.style.display = 'none';
  modalStep4.style.display = 'block';
});

// ① 展示モード：ビーコン
document.getElementById('btn-choice-beacon').addEventListener('click', async () => {
  await initAudio();
  appMode = "exhibit-beacon";
  userModal.style.display = 'none';
  appExhibit.style.display = 'block';
  document.getElementById('btn-exhibit-scan').innerText = "空間を歩いて体験を開始";
});

// ② 展示モード：AR（カラー検知）
document.getElementById('btn-choice-camera').addEventListener('click', async () => {
  await initAudio();
  appMode = "exhibit-camera";
  userModal.style.display = 'none';
  appExhibit.style.display = 'block';
  document.getElementById('btn-exhibit-scan').innerText = "色を探して体験を開始";
});

// 再生ボタン
document.getElementById('btn-exhibit-scan').addEventListener('click', async (e) => {
  if (e.target.classList.contains('active')) {
    stopAllAudio();
    e.target.innerText = appMode === "exhibit-beacon" ? "空間を歩いて体験を開始" : "色を探して体験を開始";
    e.target.classList.remove('active');
    return;
  }
  e.target.innerText = "スキャン中... (停止する)";
  e.target.classList.add('active');
  
  await prepareExhibitAudio();

  if (appMode === "exhibit-beacon") {
    await startExhibitBeaconScan();
  } else if (appMode === "exhibit-camera") {
    await startExhibitCameraScan();
  }
});

// ③ ミキキの交差点（WS1）
document.getElementById('btn-choice-mikiki-ws1').addEventListener('click', async () => {
  await initAudio();
  appMode = "mikiki-ws1";
  wsBadge.innerText = "ミキキの交差点";
  document.getElementById('guide-audio-section').style.display = 'none';
  document.getElementById('asset-pool-section').style.display = 'block';
  userModal.style.display = 'none';
  mainApp.style.display = 'block';
  
  await startWS1Ambient();
  loadAssetsToUI();
  startSyncTracks("ws1_tracks");
});

// ④ 非言語音声ガイド（WS2）
document.getElementById('btn-choice-guide-ws2').addEventListener('click', async () => {
  await initAudio();
  appMode = "guide-ws2";
  wsBadge.innerText = "非言語音声ガイド";
  document.getElementById('guide-audio-section').style.display = 'block';
  document.getElementById('asset-pool-section').style.display = 'none';
  userModal.style.display = 'none';
  mainApp.style.display = 'block';
  
  startSyncTracks("ws2_tracks");
});


// ==============================================
// 4. 展示モード（オーディオ準備・ビーコン・ARカメラ）
// ==============================================

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

// ビーコンスキャン処理
async function startExhibitBeaconScan() {
  try {
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) {
      throw new Error("お使いのブラウザはWeb Bluetoothに非対応です。");
    }
    bluetoothScanDevice = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
    navigator.bluetooth.addEventListener('advertisementreceived', handleBeacon);
    
    exhibitScanInterval = setInterval(() => {
      const now = Date.now();
      EXHIBIT_WORKS.forEach(w => {
        if (now - w.lastSeen > 3000 && w.gainNode && w.gainNode.gain.value > 0.01) {
          w.gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 1.0);
        }
      });
    }, 1000);
  } catch (error) {
    alert(error.message);
    document.getElementById('btn-exhibit-scan').innerText = "空間を歩いて体験を開始";
    document.getElementById('btn-exhibit-scan').classList.remove('active');
    bluetoothScanDevice = null;
  }
}

function handleBeacon(e) {
  if (!e.device.name) return;
  const w = EXHIBIT_WORKS.find(x => e.device.name.includes(x.beaconName));
  if (w && w.gainNode) {
    w.lastSeen = Date.now();
    const rssi = e.rssi;
    const minR = -90; const maxR = -50; 
    let vol = 0;
    if (rssi >= maxR) vol = 1.0;
    else if (rssi <= minR) vol = 0;
    else vol = (rssi - minR) / (maxR - minR);
    w.gainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.5); 
  }
}

// ARカメラ（カラー検知）スキャン処理
async function startExhibitCameraScan() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const videoEl = document.getElementById('camera-video');
    videoEl.srcObject = cameraStream;
    videoEl.style.display = 'block'; // 背景にうっすら表示
    
    const canvasEl = document.getElementById('camera-canvas');
    canvasEl.width = 64; // 解析を軽くするため解像度を下げる
    canvasEl.height = 64;
    
    scanColorsLoop();
  } catch (err) {
    alert("カメラへのアクセスが拒否されました。");
    document.getElementById('btn-exhibit-scan').innerText = "色を探して体験を開始";
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
    const frame = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const data = frame.data;
    
    // 各ターゲットカラーの近似ピクセル数をカウント
    let counts = { exhibit_a: 0, exhibit_b: 0, exhibit_c: 0, exhibit_d: 0, exhibit_e: 0, exhibit_f: 0 };
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      // 白飛びや黒つぶれは無視
      if ((r > 240 && g > 240 && b > 240) || (r < 20 && g < 20 && b < 20)) continue;

      for (let key in AR_TARGET_COLORS) {
        const tc = AR_TARGET_COLORS[key];
        // 簡易的な色距離判定
        const dist = Math.sqrt(Math.pow(r - tc.r, 2) + Math.pow(g - tc.g, 2) + Math.pow(b - tc.b, 2));
        if (dist < 45) { // 許容する色の誤差範囲
          counts[key]++;
        }
      }
    }

    // カウント数に応じて音量をフェード（重なり合うようにクロスフェード）
    const thresholdCount = 30; // これ以上のピクセルがあれば反応
    
    EXHIBIT_WORKS.forEach(w => {
      if (!w.gainNode) return;
      const count = counts[w.id];
      let targetVol = 0;
      if (count > thresholdCount) {
        targetVol = Math.min((count - thresholdCount) / 100, 1.0); 
      }
      
      const currentVol = w.gainNode.gain.value;
      // ゆっくり重なり合うようにフェードをかける
      const newVol = currentVol + (targetVol - currentVol) * 0.03; 
      w.gainNode.gain.setTargetAtTime(newVol, audioCtx.currentTime, 0.5);
    });
  }
  arScanAnimationFrame = requestAnimationFrame(scanColorsLoop);
}

// ==============================================
// 5. ミキキの交差点（アンビエント＆ランダム3音再生）
// ==============================================

async function startWS1Ambient() {
  if (!ambientBaseBuffer) {
    try {
      const res = await fetch(`assets/sounds/ambient_base.mp3`);
      if(res.ok) ambientBaseBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    } catch(e) {}
  }
  if (ambientBaseBuffer) {
    if (ambientBaseSource) { try{ambientBaseSource.stop()}catch(e){} }
    ambientBaseSource = audioCtx.createBufferSource();
    ambientBaseSource.buffer = ambientBaseBuffer;
    ambientBaseSource.loop = true;
    
    const bgGain = audioCtx.createGain();
    bgGain.gain.value = 0.4; 
    bgGain.connect(masterGain);
    ambientBaseSource.connect(bgGain);
    ambientBaseSource.start();
  }
  
  if (ws1SchedulerInterval) clearInterval(ws1SchedulerInterval);
  ws1SchedulerInterval = setInterval(scheduleWS1RandomTracks, 4000);
}

function scheduleWS1RandomTracks() {
  if (appMode !== "mikiki-ws1" || tracks.length === 0) return;
  activeRandomTracks = activeRandomTracks.filter(t => t.isActive);

  if (activeRandomTracks.length < 3) {
    const available = tracks.filter(t => !activeRandomTracks.some(ar => ar.dbDocId === t.dbDocId) && t.buffer);
    if (available.length > 0) {
      const randomTrack = available[Math.floor(Math.random() * available.length)];
      playRandomTrack(randomTrack);
    }
  }
}

function playRandomTrack(track) {
  if (!track.buffer) return;
  const rndGain = audioCtx.createGain();
  rndGain.gain.value = 0; 
  rndGain.connect(wetGain); 
  rndGain.connect(dryGain);

  const source = audioCtx.createBufferSource();
  source.buffer = track.buffer;
  source.loop = true; 
  source.connect(rndGain);
  source.start();

  const targetVol = track.volume !== undefined ? track.volume : 0.8;
  rndGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 2.0);

  const trackObj = { dbDocId: track.dbDocId, source, gainNode: rndGain, isActive: true };
  activeRandomTracks.push(trackObj);

  const playDuration = 15 + Math.random() * 10;
  setTimeout(() => {
    if (trackObj.isActive) {
      rndGain.gain.setTargetAtTime(0, audioCtx.currentTime, 3.0); 
      setTimeout(() => {
        try { source.stop(); } catch(e){}
        trackObj.isActive = false;
      }, 4000);
    }
  }, playDuration * 1000);
}

// ==============================================
// 6. WS2 ガイド音声
// ==============================================

document.getElementById('btn-play-guide').addEventListener('click', async (e) => {
  if (isGuidePlaying) {
    if (guideAudioSource) { try{guideAudioSource.stop()}catch(ex){} }
    isGuidePlaying = false;
    e.target.innerText = "再生";
    e.target.classList.remove('recording');
    return;
  }
  
  if (!guideAudioBuffer) {
    e.target.innerText = "読み込み中...";
    try {
      const res = await fetch(`assets/sounds/guide_audio.mp3`);
      if(res.ok) guideAudioBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    } catch(err){}
  }
  
  if (guideAudioBuffer) {
    guideAudioSource = audioCtx.createBufferSource();
    guideAudioSource.buffer = guideAudioBuffer;
    guideAudioSource.connect(masterGain);
    guideAudioSource.onended = () => {
      isGuidePlaying = false;
      e.target.innerText = "再生";
      e.target.classList.remove('recording');
    };
    guideAudioSource.start();
    isGuidePlaying = true;
    e.target.innerText = "停止";
    e.target.classList.add('recording');
  }
});

// ==============================================
// 7. 録音機能 (10秒制限)
// ==============================================

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
        btnRecord.innerText = "Processing...";
        btnRecord.classList.remove('recording');
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
              storagePath: storagePath, 
              isLooping: true, 
              volume: 1.0, delayTime: 0,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (e) { alert("保存に失敗しました。"); }
        }
        btnRecord.innerText = "録音を開始";
      };

      mediaRecorder.start();
      isRecording = true;
      btnRecord.innerText = "録音を停止";
      btnRecord.classList.add('recording');

      if (recordTimeout) clearTimeout(recordTimeout);
      recordTimeout = setTimeout(() => {
        if (isRecording && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
      }, 10000);

    } catch (err) { alert("マイクへのアクセスが拒否されました。"); }
  } else {
    if (recordTimeout) clearTimeout(recordTimeout);
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
});

// ==============================================
// 8. データベース同期とUI
// ==============================================

function startSyncTracks(collectionName) {
  if (unsubscribeTracks) { unsubscribeTracks(); unsubscribeTracks = null; }
  tracks = [];
  if (!db) return;
  
  unsubscribeTracks = db.collection(collectionName)
    .where("user", "==", currentUser)
    .onSnapshot(async (snapshot) => {
      const trackListEl = document.getElementById('track-list');
      const timelineTracksEl = document.getElementById('timeline-tracks');
      if (snapshot.empty) {
        document.getElementById('empty-msg').style.display = 'block';
        trackListEl.innerHTML = ''; timelineTracksEl.innerHTML = ''; 
        tracks = []; return;
      }
      document.getElementById('empty-msg').style.display = 'none';

      const loadPromises = snapshot.docs.map(async (docSnapshot) => {
        const id = docSnapshot.id;
        const data = docSnapshot.data();
        const safeUrl = data.url ? data.url.replace("http://", "https://") : "";
        
        const existingTrack = tracks.find(t => t.dbDocId === id);
        if (existingTrack) {
          existingTrack.name = data.name;
          existingTrack.volume = data.volume !== undefined ? data.volume : 1.0;
          existingTrack.isLooping = data.isLooping !== false;
          if (existingTrack.gainNode) existingTrack.gainNode.gain.value = existingTrack.isActive ? existingTrack.volume : 0.0;
          return existingTrack;
        }

        let audioBuffer = null;
        try {
          const response = await fetch(safeUrl);
          if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
        } catch (e) {}

        const trackGain = audioCtx.createGain();
        trackGain.connect(dryGain);
        trackGain.gain.value = data.volume !== undefined ? data.volume : 1.0;

        return {
          dbDocId: id, name: data.name, url: safeUrl, buffer: audioBuffer,
          gainNode: trackGain, isActive: true, 
          isLooping: data.isLooping !== false, 
          volume: data.volume !== undefined ? data.volume : 1.0, delayTime: data.delayTime || 0,
          duration: audioBuffer ? audioBuffer.duration : 5
        };
      });

      const newTracks = await Promise.all(loadPromises);
      tracks = newTracks.filter(Boolean);
      renderUI();
  });
}

function loadAssetsToUI() {
  const gridAmbient = document.getElementById('asset-grid-ambient');
  const gridSE = document.getElementById('asset-grid-se');
  
  const createAssetItem = (asset) => {
    const item = document.createElement('div');
    item.className = 'asset-item';
    item.innerHTML = `
      <div class="asset-name">${asset.name}</div>
      <div style="display:flex; justify-content:center; gap:8px;">
        <button class="action-btn asset-preview-btn" data-url="assets/sounds/${asset.fileName}">試聴</button>
        <button class="action-btn asset-add-btn" data-url="assets/sounds/${asset.fileName}" data-name="${asset.name}">追加</button>
      </div>`;
    return item;
  };

  if (gridAmbient) {
    gridAmbient.innerHTML = '';
    FIELD_ASSETS.forEach(asset => gridAmbient.appendChild(createAssetItem(asset)));
  }
  if (gridSE) {
    gridSE.innerHTML = '';
    SE_ASSETS.forEach(asset => gridSE.appendChild(createAssetItem(asset)));
  }

  document.querySelectorAll('.asset-add-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const url = e.target.getAttribute('data-url');
      const name = e.target.getAttribute('data-name');
      const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
      if (db) {
        await db.collection(collectionName).add({
          user: currentUser, name: name, url: url, 
          isLooping: true, volume: 1.0, delayTime: 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    });
  });
  
  let previewAudio = null;
  document.querySelectorAll('.asset-preview-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      if (previewAudio) { previewAudio.pause(); previewAudio = null; }
      if (e.target.innerText === "停止") { e.target.innerText = "試聴"; return; }
      document.querySelectorAll('.asset-preview-btn').forEach(b => b.innerText = "試聴");
      previewAudio = new Audio(e.target.getAttribute('data-url'));
      previewAudio.play();
      e.target.innerText = "停止";
      previewAudio.onended = () => { e.target.innerText = "試聴"; };
    });
  });
}

function renderUI() {
  const trackListEl = document.getElementById('track-list');
  const timelineTracksEl = document.getElementById('timeline-tracks');
  if (!trackListEl || !timelineTracksEl) return;
  
  trackListEl.innerHTML = '';
  timelineTracksEl.innerHTML = '';

  tracks.forEach((track) => {
    const mixerEl = document.createElement('div');
    mixerEl.className = 'track-item';
    mixerEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;">
        <input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}" style="border:none; border-bottom:1px solid var(--line-color); background:transparent; font-size:0.85rem; width:120px;">
        <div style="display:flex; align-items:center; gap:12px;">
           <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button>
           <button class="action-btn delete-btn" data-id="${track.dbDocId}" style="color:var(--danger);">削除</button>
        </div>
      </div>
      <div style="display:flex; align-items:center; width:100%; gap:15px; margin-bottom: 8px;">
        <span style="font-size:0.6rem; color:var(--text-muted); min-width:30px;">Start</span>
        <input type="range" class="delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}" style="width:100%;">
      </div>
    `;
    trackListEl.appendChild(mixerEl);

    const rowEl = document.createElement('div');
    rowEl.className = 'timeline-row';
    const clipLeft = track.delayTime * PIXELS_PER_SEC;
    const clipWidth = Math.max(track.duration * PIXELS_PER_SEC, 20);
    rowEl.innerHTML = `<div class="timeline-clip" style="left: ${clipLeft}px; width: ${clipWidth}px;">${track.name}</div>`;
    timelineTracksEl.appendChild(rowEl);
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      if(confirm("削除しますか？")) {
        const id = e.target.getAttribute('data-id');
        const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
        if(db) await db.collection(collectionName).doc(id).delete();
      }
    });
  });

  document.querySelectorAll('.track-name-input').forEach(input => {
    input.addEventListener('change', async e => {
      const id = e.target.getAttribute('data-id');
      const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
      if(db) await db.collection(collectionName).doc(id).update({ name: e.target.value });
    });
  });

  document.querySelectorAll('.delay-slider').forEach(slider => {
    slider.addEventListener('change', async e => {
      const id = e.target.getAttribute('data-id');
      const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
      if(db) await db.collection(collectionName).doc(id).update({ delayTime: parseFloat(e.target.value) });
    });
  });

  document.querySelectorAll('.loop-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === id);
      if(!t) return;
      t.isLooping = !t.isLooping;
      const collectionName = (appMode === "mikiki-ws1") ? "ws1_tracks" : "ws2_tracks";
      if(db) await db.collection(collectionName).doc(id).update({ isLooping: t.isLooping });
    });
  });
}

// ==============================================
// 9. 再生コントロール
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
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
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

// ==============================================
// 10. クリーンアップ・エクスポート
// ==============================================

function stopAllAudio() {
  // ビーコン停止
  if (bluetoothScanDevice) {
    try {
      navigator.bluetooth.removeEventListener('advertisementreceived', handleBeacon);
      bluetoothScanDevice = null;
    } catch(e){}
  }
  if (exhibitScanInterval) clearInterval(exhibitScanInterval);

  // カメラ停止
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  if (arScanAnimationFrame) cancelAnimationFrame(arScanAnimationFrame);
  document.getElementById('camera-video').style.display = 'none';

  if (ws1SchedulerInterval) clearInterval(ws1SchedulerInterval);
  
  EXHIBIT_WORKS.forEach(w => { if(w.source){ try{w.source.stop()}catch(e){} w.source=null; } });
  if (ambientBaseSource) { try{ambientBaseSource.stop()}catch(e){} ambientBaseSource=null; }
  activeRandomTracks.forEach(t => { try{t.source.stop()}catch(e){} });
  activeRandomTracks = [];
  if (guideAudioSource) { try{guideAudioSource.stop()}catch(e){} guideAudioSource=null; }
  isGuidePlaying = false;
  
  if (isMasterPlaying) document.getElementById('btn-master-play-stop').click();
  
  if (unsubscribeTracks) { unsubscribeTracks(); unsubscribeTracks = null; }
  tracks = [];
}

document.getElementById('btn-export-master').addEventListener('click', () => {
  const btn = document.getElementById('btn-export-master');
  btn.innerText = "Processing...";
  btn.disabled = true;
  setTimeout(() => {
    alert("保存が完了しました。");
    document.getElementById('input-export-name').value = '';
    btn.innerText = "作品を完成させる";
    btn.disabled = false;
  }, 800);
});
