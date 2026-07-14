// ==============================================
// 7/19 100BANCH イベント用 新 app.js
// ==============================================

// Firebase初期化 (既存のキーをそのまま使用)
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
let appMode = ""; // "exhibit", "mikiki-ws1", "guide-ws2"
let currentUser = "";
let audioCtx;
let masterGain, convolver, dryGain, wetGain;

// ==============================================
// 1. 各モード用のデータ定義
// ==============================================

// ① 展示モード（気配に触れる）用ビーコン＆作品データ
const EXHIBIT_WORKS = [
  { id: "exhibit_a", beaconName: "KBPro_185046", fileName: "exhibit_a.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_b", beaconName: "KBPro_183636", fileName: "exhibit_b.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_c", beaconName: "KBPro_511316", fileName: "exhibit_c.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_d", beaconName: "KBPro_D", fileName: "exhibit_d.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_e", beaconName: "KBPro_E", fileName: "exhibit_e.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "exhibit_f", beaconName: "KBPro_F", fileName: "exhibit_f.mp3", buffer: null, source: null, gainNode: null, lastSeen: 0 }
];
let exhibitScanInterval = null;
let bluetoothScanDevice = null;

// ② ミキキの交差点（WS1）用 フィールドレコーディング素材
const WS1_ASSETS = Array.from({length: 10}, (_, i) => ({
  id: `field_${(i+1).toString().padStart(2, '0')}`,
  name: `Field Record ${i+1}`,
  fileName: `field_${(i+1).toString().padStart(2, '0')}.mp3`
}));
let ambientBaseSource = null;
let ambientBaseBuffer = null;
let ws1SchedulerInterval = null;
let activeRandomTracks = []; // ランダム再生中のトラック管理用

// ③ ワークショップ共通の録音・ミキサー用変数
let mediaRecorder, recordedChunks = [];
let isRecording = false;
let recordTimeout = null;
let tracks = [];
let isMasterPlaying = false;
let startTime = 0;
let animationFrameId;
let unsubscribeTracks = null;

// WS2用ガイド音声
let guideAudioSource = null;
let guideAudioBuffer = null;
let isGuidePlaying = false;

const PIXELS_PER_SEC = 30;

// ==============================================
// 2. UIエレメントの取得と画面遷移ロジック
// ==============================================

const userModal = document.getElementById('user-modal');
const modalStep1 = document.getElementById('modal-step-1');
const modalStep2 = document.getElementById('modal-step-2');
const modalStep3 = document.getElementById('modal-step-3'); // 新メニュー

const btnChoiceFirst = document.getElementById('btn-choice-first');
const btnChoiceReturn = document.getElementById('btn-choice-return');
const btnBackToStep1 = document.getElementById('btn-back-to-step1');
const btnLogin = document.getElementById('btn-login');
const inputUsername = document.getElementById('input-username');
const btnBackToStep2 = document.getElementById('btn-back-to-step2');

const appExhibit = document.getElementById('app-exhibit');
const mainApp = document.getElementById('main-app');
const wsBadge = document.getElementById('ws-badge');

// オーディオコンテキスト初期化
async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);

    convolver = audioCtx.createConvolver();
    convolver.buffer = createReverbBuffer(audioCtx, 4.5, 2.5); // 深い森の残響

    dryGain = audioCtx.createGain();
    wetGain = audioCtx.createGain();

    dryGain.connect(masterGain);
    wetGain.connect(convolver);
    convolver.connect(masterGain);
    updateReverb();
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

// ユーザー登録・ログイン遷移
btnChoiceFirst.addEventListener('click', () => {
  modalStep1.style.display = 'none';
  modalStep2.style.display = 'block';
});
btnChoiceReturn.addEventListener('click', () => {
  modalStep1.style.display = 'none';
  modalStep2.style.display = 'block';
});
btnBackToStep1.addEventListener('click', () => {
  modalStep2.style.display = 'none';
  modalStep1.style.display = 'block';
});

btnLogin.addEventListener('click', async (e) => {
  e.preventDefault();
  const username = inputUsername.value.trim();
  if (!username) { alert("ユーザー名を入力してください。"); return; }
  
  if (db) {
    try {
      await db.collection("users").doc(username).set({
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (err) { console.error("Firestore error:", err); }
  }
  currentUser = username;
  document.querySelectorAll('#exhibit-user-display, #current-user-display').forEach(el => el.innerText = currentUser);
  
  modalStep2.style.display = 'none';
  modalStep3.style.display = 'block';
  await initAudio();
});

btnBackToStep2.addEventListener('click', () => {
  modalStep3.style.display = 'none';
  modalStep2.style.display = 'block';
});

// 戻るボタン（全画面共通）
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

// 画面タッチでAudioContext再開
document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);
document.body.addEventListener('touchstart', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, {passive: true, once: true});

// ==============================================
// 3. 各モードの起動ロジック
// ==============================================

// ① 展示モード（気配に触れる）
document.getElementById('btn-choice-exhibit').addEventListener('click', async () => {
  await initAudio();
  appMode = "exhibit";
  userModal.style.display = 'none';
  appExhibit.style.display = 'block';
});

document.getElementById('btn-exhibit-scan').addEventListener('click', async (e) => {
  if (bluetoothScanDevice) {
    stopAllAudio();
    e.target.innerText = "展示の音を聴く";
    e.target.classList.remove('active');
    return;
  }
  e.target.innerText = "スキャン中... (停止する)";
  e.target.classList.add('active');
  await startExhibitScan();
});

// ② ミキキの交差点（WS1）
document.getElementById('btn-choice-mikiki-ws1').addEventListener('click', async () => {
  await initAudio();
  appMode = "mikiki-ws1";
  wsBadge.innerText = "ミキキの交差点";
  document.getElementById('guide-audio-section').style.display = 'none';
  document.getElementById('asset-pool-section').style.display = 'block';
  
  userModal.style.display = 'none';
  mainApp.style.display = 'block';
  
  await startWS1Ambient();
  loadAssetsToUI(WS1_ASSETS);
  startSyncTracks("ws1_tracks");
});

// ③ 非言語音声ガイド（WS2）
document.getElementById('btn-choice-guide-ws2').addEventListener('click', async () => {
  await initAudio();
  appMode = "guide-ws2";
  wsBadge.innerText = "非言語音声ガイド";
  document.getElementById('guide-audio-section').style.display = 'block';
  document.getElementById('asset-pool-section').style.display = 'none'; // WS2はプリセットなし
  
  userModal.style.display = 'none';
  mainApp.style.display = 'block';
  
  startSyncTracks("ws2_tracks");
});

// ==============================================
// 4. 展示モード（Bluetooth連動クロスフェード）
// ==============================================

async function startExhibitScan() {
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

  try {
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) {
      throw new Error("お使いのブラウザはWeb Bluetoothスキャンに非対応です。");
    }
    bluetoothScanDevice = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
    navigator.bluetooth.addEventListener('advertisementreceived', handleBeacon);
    
    // 3秒間見えなければフェードアウト
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
    document.getElementById('btn-exhibit-scan').innerText = "展示の音を聴く";
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
    const minR = -90; // 遠い (0%) - 反応距離 2〜3m向けにチューニング
    const maxR = -50; // 近い (100%)
    
    let vol = 0;
    if (rssi >= maxR) vol = 1.0;
    else if (rssi <= minR) vol = 0;
    else vol = (rssi - minR) / (maxR - minR);
    
    w.gainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.5); // 滑らかにクロスフェード
  }
}

// ==============================================
// 5. WS1 ミキキの交差点（アンビエント＆ランダム3音再生）
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
    bgGain.gain.value = 0.4; // アンビエントは少し控えめ
    bgGain.connect(masterGain);
    ambientBaseSource.connect(bgGain);
    ambientBaseSource.start();
  }
  
  // 最大3音までのランダム再生スケジューラー
  if (ws1SchedulerInterval) clearInterval(ws1SchedulerInterval);
  ws1SchedulerInterval = setInterval(scheduleWS1RandomTracks, 4000);
}

function scheduleWS1RandomTracks() {
  if (appMode !== "mikiki-ws1" || tracks.length === 0) return;

  // 終了したトラックをリストから除外
  activeRandomTracks = activeRandomTracks.filter(t => t.isActive);

  // 空間に鳴っている音が3つ未満なら、新しい音を足す
  if (activeRandomTracks.length < 3) {
    // 録音済みの全トラックから、現在鳴っていないものを抽出
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
  rndGain.gain.value = 0; // フェードイン開始
  rndGain.connect(wetGain); // 深いリバーブへ送る
  rndGain.connect(dryGain);

  const source = audioCtx.createBufferSource();
  source.buffer = track.buffer;
  source.connect(rndGain);
  source.start();

  // 2秒かけてゆっくりフェードイン
  const targetVol = track.volume !== undefined ? track.volume : 0.8;
  rndGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 2.0);

  const trackObj = { dbDocId: track.dbDocId, source, gainNode: rndGain, isActive: true };
  activeRandomTracks.push(trackObj);

  // トラックの長さに合わせてフェードアウト（最大15秒で消えるようにする）
  const playDuration = Math.min(track.buffer.duration, 15);
  setTimeout(() => {
    if (trackObj.isActive) {
      rndGain.gain.setTargetAtTime(0, audioCtx.currentTime, 2.0); // 2秒かけてフェードアウト
      setTimeout(() => {
        try { source.stop(); } catch(e){}
        trackObj.isActive = false;
      }, 3000);
    }
  }, (playDuration - 2) * 1000);
}

// ==============================================
// 6. WS2 非言語音声ガイド
// ==============================================

document.getElementById('btn-play-guide').addEventListener('click', async (e) => {
  if (isGuidePlaying) {
    if (guideAudioSource) { try{guideAudioSource.stop()}catch(ex){} }
    isGuidePlaying = false;
    e.target.innerText = "非言語音声ガイドを再生する";
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
      e.target.innerText = "非言語音声ガイドを再生する";
      e.target.classList.remove('recording');
    };
    guideAudioSource.start();
    isGuidePlaying = true;
    e.target.innerText = "ガイドを停止する";
    e.target.classList.add('recording');
  }
});


// ==============================================
// 7. 録音機能 (最大10秒制限)
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
              storagePath: storagePath, isLooping: false, volume: 1.0, delayTime: 0,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (e) { alert("保存に失敗しました。"); }
        }
        btnRecord.innerText = "録音を開始 (最大10秒)";
      };

      mediaRecorder.start();
      isRecording = true;
      btnRecord.innerText = "録音を停止";
      btnRecord.classList.add('recording');

      // ★ 10秒経過で強制ストップ
      if (recordTimeout) clearTimeout(recordTimeout);
      recordTimeout = setTimeout(() => {
        if (isRecording && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          mediaRecorder.stream.getTracks().forEach(t => t.stop());
          isRecording = false;
          btnRecord.classList.remove('recording');
        }
      }, 10000);

    } catch (err) { alert("マイクへのアクセスが拒否されました。"); }
  } else {
    // 手動停止
    if (recordTimeout) clearTimeout(recordTimeout);
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    isRecording = false;
    btnRecord.classList.remove('recording');
  }
});


// ==============================================
// 8. データベース同期とミキサーUI
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
          gainNode: trackGain, isLooping: data.isLooping || false, isActive: true, 
          volume: data.volume !== undefined ? data.volume : 1.0, delayTime: data.delayTime || 0,
          duration: audioBuffer ? audioBuffer.duration : 5
        };
      });

      const newTracks = await Promise.all(loadPromises);
      tracks = newTracks.filter(Boolean);
      renderUI();
  });
}

function loadAssetsToUI(assetsArray) {
  const assetGrid = document.getElementById('asset-grid-container');
  if (!assetGrid) return;
  assetGrid.innerHTML = '';
  assetsArray.forEach(asset => {
    const item = document.createElement('div');
    item.className = 'asset-item';
    item.innerHTML = `
      <div class="asset-name">${asset.name}</div>
      <div style="display:flex; justify-content:center; gap:8px;">
        <button class="action-btn asset-preview-btn" data-url="assets/sounds/${asset.fileName}">試聴</button>
        <button class="action-btn asset-add-btn" data-url="assets/sounds/${asset.fileName}" data-name="${asset.name}">追加</button>
      </div>`;
    assetGrid.appendChild(item);
  });

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
  
  // プレビューボタン処理
  let previewAudio = null;
  document.querySelectorAll('.asset-preview-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      if (previewAudio) { previewAudio.pause(); previewAudio = null; }
      if (e.target.innerText === "停止") {
        e.target.innerText = "試聴"; return;
      }
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

  tracks.forEach((track, index) => {
    const mixerEl = document.createElement('div');
    mixerEl.className = 'track-item';
    
    // UI構築（既存のデザインを流用）
    mixerEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;">
        <input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}" style="border:none; border-bottom:1px solid var(--line-color); background:transparent; font-size:0.85rem; width:120px;">
        <div style="display:flex; align-items:center; gap:12px;">
           <button class="action-btn delete-btn" data-id="${track.dbDocId}" style="color:var(--danger);">削除</button>
        </div>
      </div>
      <div style="display:flex; align-items:center; width:100%; gap:15px; margin-bottom: 8px;">
        <span style="font-size:0.6rem; color:var(--text-muted); min-width:30px;">Start</span>
        <input type="range" class="delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}" style="width:100%;">
      </div>
    `;
    trackListEl.appendChild(mixerEl);

    // タイムライン描画
    const rowEl = document.createElement('div');
    rowEl.className = 'timeline-row';
    const clipLeft = track.delayTime * PIXELS_PER_SEC;
    const clipWidth = Math.max(track.duration * PIXELS_PER_SEC, 20);
    
    rowEl.innerHTML = `<div class="timeline-clip" style="left: ${clipLeft}px; width: ${clipWidth}px;">${track.name}</div>`;
    timelineTracksEl.appendChild(rowEl);
  });

  // イベントバインド
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
}

// ==============================================
// 9. 再生コントロールとリバーブ制御
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
      t.source = audioCtx.createBufferSource();
      t.source.buffer = t.buffer;
      t.source.connect(t.gainNode);
      t.source.start(startTime + t.delayTime);
    });
    
    // タイムライン追従
    const playheadEl = document.getElementById('playhead');
    function updatePlayhead() {
      if(!isMasterPlaying) return;
      const elapsed = audioCtx.currentTime - startTime;
      if(playheadEl) playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;
      if(elapsed < 20) {
        animationFrameId = requestAnimationFrame(updatePlayhead);
      } else {
        btn.click(); // 20秒で自動停止
      }
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
// 10. 全オーディオ停止ユーティリティ
// ==============================================
function stopAllAudio() {
  if (bluetoothScanDevice) {
    try {
      navigator.bluetooth.removeEventListener('advertisementreceived', handleBeacon);
      bluetoothScanDevice = null;
    } catch(e){}
  }
  if (exhibitScanInterval) clearInterval(exhibitScanInterval);
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

// 投稿（Share）ボタンの動作
document.getElementById('btn-export-master').addEventListener('click', () => {
  alert("空間に音が投稿され、森の一部になりました！");
  document.getElementById('input-export-name').value = '';
});
