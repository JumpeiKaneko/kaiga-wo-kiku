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

let appMode = "";
let loginStatus = "";
let currentUser = "";
let audioCtx;

let masterGain, convolver, dryGain, wetGain;
let mediaRecorder, recordedChunks = [];
let isRecording = false;

// ======= 共通＆「聴く絵画をつくる」用変数 =======
let tracks = [];
let isMasterPlaying = false;
let isMasterLooping = true;
let startTime = 0;
let animationFrameId;
let isTransportBusy = false;

let outputAudioBuffer = null;
let outputAudioSource = null;
let isOutputLooping = true;

// ミキキモード用 1回目・2回目の分離変数
let isMikikiExportUISetup = false;
let outputAudioBuffer1 = null;
let outputAudioSource1 = null;
let isOutputLooping1 = true;
let outputAudioBuffer2 = null;
let outputAudioSource2 = null;
let isOutputLooping2 = true;

let unsubscribeTracks = null;
let unsubscribeExport = null;
let unsubscribeExport1 = null;
let unsubscribeExport2 = null;

const PIXELS_PER_SEC = 30;

const MAKE_MODE_ASSETS = [
  { id: "make_mizu_no_oti", name: "水の音", fileName: "mizu_no_oti.mp3" },
  { id: "make_yoru_no_mori", name: "夜の森", fileName: "yoru_no_mori.mp3" },
  { id: "make_kaze_no_oti", name: "風の音", fileName: "kaze_no_oti.mp3" },
  { id: "make_mori_no_oti", name: "森の音", fileName: "mori_no_oti.mp3" },
  { id: "make_saezuri", name: "さえずり", fileName: "saezuri.mp3" },
  { id: "make_yuragi", name: "ゆらぎ", fileName: "yuragi.mp3" },
  { id: "make_seseragi", name: "せせらぎ", fileName: "seseragi.mp3" },
  { id: "make_zawameki", name: "ざわめき", fileName: "zawameki.mp3" },
  { id: "make_nakigoe", name: "なきごえ", fileName: "nakigoe.mp3" },
  { id: "make_haoto", name: "はおと", fileName: "haoto.mp3" }
];

let assetPreviewAudio = null;
let assetPreviewBtn = null;

// ======= ミキキの交差点（ビーコン連動）用変数 =======
const MIKIKI_WORKS = [
  { id: "mikiki_workA", name: "作品Aの音", fileName: "workA.mp3", beaconName: "KBPro_185046", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "mikiki_workB", name: "作品Bの音", fileName: "workB.mp3", beaconName: "KBPro_183636", buffer: null, source: null, gainNode: null, lastSeen: 0 },
  { id: "mikiki_workC", name: "作品Cの音", fileName: "workC.mp3", beaconName: "KBPro_511316", buffer: null, source: null, gainNode: null, lastSeen: 0 }
];
let isListenModePlaying = false;
let isMikikiScanning = false;
let mikikiScanInterval = null;
let mikikiBluetoothScan = null;

// ======= Unity WebGL 連携 =======
function getUnityInstance() {
  if (typeof window.unityInstance !== "undefined" && window.unityInstance && typeof window.unityInstance.SendMessage === "function") return window.unityInstance;
  if (typeof unityInstance !== "undefined" && unityInstance && typeof unityInstance.SendMessage === "function") return unityInstance;
  if (typeof gameInstance !== "undefined" && gameInstance && typeof gameInstance.SendMessage === "function") return gameInstance;
  return null;
}
function playUnityAudio() {
  const instance = getUnityInstance();
  if (instance) instance.SendMessage('AudioController', 'PlayBackgroundSound');
}
function stopUnityAudio() {
  const instance = getUnityInstance();
  if (instance) instance.SendMessage('AudioController', 'StopBackgroundSound');
}
function loadUnityInstance() {
  if (document.getElementById('unity-canvas')) return;
  document.getElementById('unity-container').innerHTML = `<canvas id="unity-canvas" style="display: none; width: 0px; height: 0px;"></canvas>`;
  var loaderUrl = "./Unity/Build/build_bird.loader.js";
  var config = {
    dataUrl: "./Unity/Build/build_bird.data",
    frameworkUrl: "./Unity/Build/build_bird.framework.js",
    codeUrl: "./Unity/Build/build_bird.wasm",
    streamingAssetsUrl: "StreamingAssets",
    companyName: "DefaultCompany",
    productName: "kaiga-wo-kiku",
    productVersion: "0.1",
  };
  var script = document.createElement("script");
  script.src = loaderUrl;
  script.onload = () => {
    createUnityInstance(document.querySelector("#unity-canvas"), config, (p) => {}).then((i) => {
      window.unityInstance = i;
    });
  };
  document.body.appendChild(script);
}

// ======= UI エレメント取得 =======
const userModal = document.getElementById('user-modal');
const modalStep1 = document.getElementById('modal-step-1');
const modalStep2 = document.getElementById('modal-step-2');
const modalStep3 = document.getElementById('modal-step-3');
const modalStep4 = document.getElementById('modal-step-4');
const inputUsername = document.getElementById('input-username');
const btnChoiceFirst = document.getElementById('btn-choice-first');
const btnChoiceReturn = document.getElementById('btn-choice-return');
const btnBackToStep1 = document.getElementById('btn-back-to-step1');
const btnLogin = document.getElementById('btn-login');
const btnBackToStep2 = document.getElementById('btn-back-to-step2');
const btnBackToStep3 = document.getElementById('btn-back-to-step3');
const btnChoiceMake = document.getElementById('btn-choice-make');
const btnChoiceMikiki = document.getElementById('btn-choice-mikiki');

const btnModeListen = document.getElementById('btn-mode-listen');
const btnModeRecord = document.getElementById('btn-mode-record');

const mainApp = document.getElementById('main-app');
const listenApp = document.getElementById('listen-app');
const inputRecordSection = document.getElementById('input-record-section');
const currentUserDisplay = document.getElementById('current-user-display');
const listenUserDisplay = document.getElementById('listen-user-display');
const outputPlayerContainer = document.getElementById('output-player-container');
const btnPlayUnityAudio = document.getElementById('btn-play-unity-audio');
const btnMasterPlayStop = document.getElementById('btn-master-play-stop');
const btnRecord = document.getElementById('btn-record');
const reverbSlider = document.getElementById('master-reverb');
const trackListEl = document.getElementById('track-list');
const emptyMsg = document.getElementById('empty-msg');
const timelineTracksEl = document.getElementById('timeline-tracks');
const playheadEl = document.getElementById('playhead');
const btnExportMaster = document.getElementById('btn-export-master');
const btnOutputLoop = document.getElementById('btn-output-loop');
const btnOutputPlay = document.getElementById('btn-output-play');
const btnOutputStop = document.getElementById('btn-output-stop');
const btnOutputDownload = document.getElementById('btn-output-download');
const inputExportName = document.getElementById('input-export-name');
const outputFileDisplay = document.getElementById('output-file-name');
const btnShowWorksRecord = document.getElementById('btn-show-works-record');
const btnShowWorksListen = document.getElementById('btn-show-works-listen');
const worksModal = document.getElementById('works-modal');
const btnCloseWorks = document.getElementById('btn-close-works');
const worksListContainer = document.getElementById('works-list-container');
let currentGalleryAudio = null;
let currentGalleryPlayBtn = null;

// 再生ボタンとタイムラインをスクロール追従（固定表示）にする処理
window.addEventListener('DOMContentLoaded', () => {
  if (btnMasterPlayStop) {
    const playBtnContainer = btnMasterPlayStop.parentElement;
    playBtnContainer.style.position = 'sticky';
    playBtnContainer.style.top = '0px';
    playBtnContainer.style.zIndex = '1000';
    playBtnContainer.style.backgroundColor = 'var(--bg-color, #ffffff)';
    playBtnContainer.style.padding = '10px 0';
    playBtnContainer.style.marginBottom = '0px'; 
  }
  
  const timelineWrapper = document.getElementById('timeline-wrapper');
  if (timelineWrapper) {
    const timelineSection = timelineWrapper.parentElement;
    timelineSection.style.position = 'sticky';
    timelineSection.style.top = '50px';
    timelineSection.style.zIndex = '999';
    timelineSection.style.backgroundColor = 'var(--bg-color, #ffffff)';
    timelineSection.style.paddingBottom = '10px';
    timelineSection.style.borderBottom = '1px solid var(--line-color, #e5e5e5)';
    timelineSection.style.boxShadow = '0 4px 6px -6px #222';
  }
});

// ======= 基本機能・ナビゲーション =======
function updateProjectBadge(mode) {
  document.querySelectorAll('.project-badge-label').forEach(badge => {
    if (mode === "make") {
      badge.innerText = "聴く絵画をつくる 6/30";
      badge.style.display = "inline-block";
    } else if (mode === "mikiki") {
      badge.innerText = "ミキキの交差点 7/19";
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  });
}

function resetAudioAndUI() {
  isMasterPlaying = false;
  if (btnMasterPlayStop) {
    btnMasterPlayStop.innerText = "再生";
    btnMasterPlayStop.classList.remove('recording');
  }
  tracks.forEach(t => {
    if (t.source) { try{t.source.stop()}catch(ex){} t.source = null; }
    if (t.previewSource) { try{t.previewSource.stop()}catch(ex){} t.previewSource = null; }
  });
  cancelAnimationFrame(animationFrameId);
  if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
  if (assetPreviewAudio) { assetPreviewAudio.pause(); assetPreviewAudio = null; }
  if (assetPreviewBtn) { assetPreviewBtn.innerText = "試聴"; }
  if (playheadEl) playheadEl.style.left = '0px';
  document.querySelectorAll('.preview-btn').forEach(b => {
    b.innerText = '▶';
    b.classList.remove('active');
  });

  if (appMode === "mikiki" && isListenModePlaying) {
    stopMikikiMode();
    isListenModePlaying = false;
    if (btnPlayUnityAudio) {
      btnPlayUnityAudio.innerText = "絵画の音を聴く";
      btnPlayUnityAudio.classList.remove('recording');
    }
  }
}

if (btnChoiceFirst) {
  btnChoiceFirst.addEventListener('click', () => {
    loginStatus = "first";
    modalStep1.style.display = 'none';
    modalStep2.style.display = 'block';
  });
}

if (btnChoiceReturn) {
  btnChoiceReturn.addEventListener('click', () => {
    loginStatus = "return";
    modalStep1.style.display = 'none';
    modalStep2.style.display = 'block';
  });
}

if (btnBackToStep1) {
  btnBackToStep1.addEventListener('click', () => {
    modalStep2.style.display = 'none';
    modalStep1.style.display = 'block';
  });
}

if (btnLogin) {
  btnLogin.addEventListener('click', async (e) => {
    e.preventDefault();
    const username = inputUsername.value.trim();
    if (!username) { alert("ユーザー名を入力してください。"); return; }
    if (db && loginStatus === "first") {
      try {
        const userDoc = await db.collection("users").doc(username).get();
        if (userDoc.exists) {
          alert("このユーザー名は既に存在します。別の名前を入力するか、戻って「2回目以降」を選択してください。"); return;
        }
        await db.collection("users").doc(username).set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      } catch (err) { console.error("Firestore error:", err); }
    }
    currentUser = username;
    modalStep2.style.display = 'none';
    modalStep3.style.display = 'block';
    await initAudio();
  });
}

if (btnBackToStep2) {
  btnBackToStep2.addEventListener('click', () => {
    modalStep3.style.display = 'none';
    modalStep2.style.display = 'block';
  });
}

if (btnBackToStep3) {
  btnBackToStep3.addEventListener('click', () => {
    modalStep4.style.display = 'none';
    modalStep3.style.display = 'block';
  });
}

if (btnChoiceMake) {
  btnChoiceMake.addEventListener('click', async (e) => {
    e.preventDefault();
    await initAudio();
    appMode = "make";
    updateProjectBadge("make");
    userModal.style.display = 'none';
    mainApp.style.display = 'block';
    if (currentUserDisplay) currentUserDisplay.innerText = currentUser;
    if (inputRecordSection) inputRecordSection.style.display = 'none';
    startSyncTracks();
    checkExistingExport();
  });
}

if (btnChoiceMikiki) {
  btnChoiceMikiki.addEventListener('click', async (e) => {
    e.preventDefault();
    await initAudio();
    appMode = "mikiki";
    updateProjectBadge("mikiki");
    loadUnityInstance();
    document.getElementById('asset-pool-section').style.display = 'none';

    if (btnModeListen) btnModeListen.innerText = "展示";
    if (btnModeRecord) btnModeRecord.innerText = "ワークショップ";

    modalStep3.style.display = 'none';
    modalStep4.style.display = 'block';
  });
}

if (btnModeListen) {
  btnModeListen.addEventListener('click', (e) => {
    e.preventDefault();
    userModal.style.display = 'none';
    listenApp.style.display = 'block';
    if (listenUserDisplay) listenUserDisplay.innerText = currentUser;
  });
}

if (btnModeRecord) {
  btnModeRecord.addEventListener('click', (e) => {
    e.preventDefault();
    userModal.style.display = 'none';
    mainApp.style.display = 'block';
    if (currentUserDisplay) currentUserDisplay.innerText = currentUser;
    if (inputRecordSection) inputRecordSection.style.display = 'block';
    startSyncTracks();
    checkExistingExport();
  });
}

document.querySelectorAll('.btn-global-back').forEach(btn => {
  btn.addEventListener('click', () => {
    resetAudioAndUI();
    if (appMode === "mikiki" && listenApp.style.display === 'block') {
      listenApp.style.display = 'none';
      userModal.style.display = 'flex';
      modalStep4.style.display = 'block';
    } else {
      mainApp.style.display = 'none';
      listenApp.style.display = 'none';
      outputPlayerContainer.style.display = 'none';
      userModal.style.display = 'flex';
      modalStep3.style.display = 'block';
    }
  });
});

document.querySelectorAll('.logo-home-trigger').forEach(logo => {
  logo.addEventListener('click', () => {
    resetAudioAndUI();
    mainApp.style.display = 'none';
    listenApp.style.display = 'none';
    outputPlayerContainer.style.display = 'none';
    modalStep1.style.display = 'none';
    modalStep2.style.display = 'none';
    modalStep4.style.display = 'none';
    modalStep3.style.display = 'block';
    userModal.style.display = 'flex';
  });
});

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);
document.body.addEventListener('touchstart', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, {passive: true, once: true});


// ======= ★ミキキの交差点：ビーコン連動モードの実装 =======
async function initMikikiWorks() {
  await initAudio();
  const loadPromises = MIKIKI_WORKS.map(async (work) => {
    if (!work.buffer) {
      try {
        const response = await fetch(work.url || `assets/sounds/${work.fileName}`);
        if (response.ok) {
          work.buffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
        }
      } catch(e) { console.error("ミキキ用オーディオの読み込み失敗", e); }
    }
    if (!work.gainNode && audioCtx) {
      work.gainNode = audioCtx.createGain();
      work.gainNode.gain.value = 0.0;
      work.gainNode.connect(masterGain);
    }
  });
  await Promise.all(loadPromises);
}

async function startMikikiMode() {
  await initMikikiWorks();
  playUnityAudio();

  MIKIKI_WORKS.forEach(work => {
    if (work.source) { try{work.source.stop();}catch(e){} }
    if (work.buffer && work.gainNode) {
      work.source = audioCtx.createBufferSource();
      work.source.buffer = work.buffer;
      work.source.loop = true;
      work.source.connect(work.gainNode);
      work.source.start(0);
    }
  });

  try {
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) {
      throw new Error("お使いのブラウザはWeb Bluetoothのスキャンに対応していません。（iOSは非対応です）");
    }
    mikikiBluetoothScan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
    navigator.bluetooth.addEventListener('advertisementreceived', handleBeaconAdvertisement);
    isMikikiScanning = true;

    if (mikikiScanInterval) clearInterval(mikikiScanInterval);
    mikikiScanInterval = setInterval(() => {
      const now = Date.now();
      MIKIKI_WORKS.forEach(work => {
        if (now - work.lastSeen > 3000 && work.gainNode && work.gainNode.gain.value > 0.01) {
          work.gainNode.gain.setTargetAtTime(0.0, audioCtx.currentTime, 1.0);
        }
      });
    }, 1000);

  } catch (error) {
    console.error(error);
    alert(error.message || "Bluetoothスキャンを開始できませんでした。ブラウザの設定や権限を確認してください。");
  }
}

function handleBeaconAdvertisement(event) {
  const deviceName = event.device.name;
  if (!deviceName) return;
  const work = MIKIKI_WORKS.find(w => deviceName.includes(w.beaconName));
  if (work && work.gainNode) {
    work.lastSeen = Date.now();
    const rssi = event.rssi;
    const minRssi = -90;
    const maxRssi = -50;
    let targetVolume = 0;
    if (rssi >= maxRssi) {
      targetVolume = 1.0;
    } else if (rssi <= minRssi) {
      targetVolume = 0.0;
    } else {
      targetVolume = (rssi - minRssi) / (maxRssi - minRssi);
    }
    work.gainNode.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.5);
  }
}

function stopMikikiMode() {
  stopUnityAudio();
  if (isMikikiScanning && navigator.bluetooth) {
    navigator.bluetooth.removeEventListener('advertisementreceived', handleBeaconAdvertisement);
    if (mikikiBluetoothScan && mikikiBluetoothScan.stop) {
      mikikiBluetoothScan.stop();
    }
  }
  isMikikiScanning = false;
  if (mikikiScanInterval) clearInterval(mikikiScanInterval);

  MIKIKI_WORKS.forEach(work => {
    if (work.source) { try{work.source.stop();}catch(e){} work.source = null; }
    if (work.gainNode) work.gainNode.gain.value = 0;
  });
}

if (btnPlayUnityAudio) {
  btnPlayUnityAudio.addEventListener('click', async () => {
    if (appMode === "mikiki") {
      if (!getUnityInstance()) { alert("Unityシステムをロード中です。数秒お待ちください。"); return; }
      if (!isListenModePlaying) {
        await startMikikiMode();
        isListenModePlaying = true;
        btnPlayUnityAudio.innerText = "絵画の音を停止";
        btnPlayUnityAudio.classList.add('recording');
      } else {
        stopMikikiMode();
        isListenModePlaying = false;
        btnPlayUnityAudio.innerText = "絵画の音を聴く";
        btnPlayUnityAudio.classList.remove('recording');
      }
    } else {
      if (!isListenModePlaying) {
        if (tracks.length > 0 && tracks.url) {
          currentGalleryAudio = new Audio(formalizeUrl(tracks.url));
          currentGalleryAudio.loop = true;
          currentGalleryAudio.play();
          isListenModePlaying = true;
          btnPlayUnityAudio.innerText = "絵画の音を停止";
        }
      } else {
        if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
        isListenModePlaying = false;
        btnPlayUnityAudio.innerText = "絵画の音を聴く";
      }
    }
  });
}

if (btnRecord) {
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
          const storagePath = `audios/track_${timestamp}.webm`;
          
          if (storage && db) {
            try {
              const snapshot = await storage.ref().child(storagePath).put(blob);
              const downloadUrl = await snapshot.ref.getDownloadURL();
              const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";
              await db.collection(targetCollection).add({
                user: currentUser, name: `Track ${String(timestamp).substring(9, 13)}`, url: downloadUrl,
                storagePath: storagePath, isLooping: false, volume: 1.0, delayTime: 0,
                estimatedDuration: (Date.now() - recordStart) / 1000, createdAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            } catch (e) { alert("録音の保存に失敗しました。"); }
          } else {
            simulateLocalTrack(`Track ${String(timestamp).substring(9, 13)}`, URL.createObjectURL(blob), `local_${timestamp}`);
          }
          btnRecord.innerText = "録音を開始";
        };
        
        const recordStart = Date.now();
        mediaRecorder.start();
        isRecording = true;
        btnRecord.innerText = "録音を停止";
        btnRecord.classList.add('recording');
        playUnityAudio();
      } catch (err) { alert("マイクへのアクセスが拒否されました。"); }
    } else {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      isRecording = false;
      btnRecord.classList.remove('recording');
      stopUnityAudio();
    }
  });
}

const showWorksLogic = async () => {
  if (worksModal) worksModal.style.display = 'flex';
  if (worksListContainer) worksListContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">読み込み中...</div>';
  await loadGalleryWorks();
};

if (btnShowWorksRecord) btnShowWorksRecord.addEventListener('click', showWorksLogic);
if (btnShowWorksListen) btnShowWorksListen.addEventListener('click', showWorksLogic);

async function loadGalleryWorks() {
  try {
    if (!db) {
      if (worksListContainer) worksListContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">ローカルデモ動作中のため、作品一覧の読み込みをスキップします。</div>';
      return;
    }
    if (worksListContainer) worksListContainer.innerHTML = "";

    const renderItem = (data, docId, isExport, overrideCollection) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'track-item';
      itemEl.style.borderBottom = '1px solid var(--line-color)';
      itemEl.style.padding = '12px 0';
      
      const isOwn = (data.user === currentUser);
      const colAttr = overrideCollection ? `data-col="${overrideCollection}"` : `data-is-export="${isExport}"`;
      const delBtnHTML = isOwn ? `<button class="action-btn gallery-delete-btn" data-id="${docId}" ${colAttr} style="color:var(--danger); margin-left:12px;">削除</button>` : "";
      
      const title = isExport ? (data.title || 'Untitled') : data.name;

      itemEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:4px; max-width:60%;">
          <div class="track-name" style="font-size:0.75rem; color:var(--text-main); font-weight:bold;">${title}</div>
          <div style="font-size:0.55rem; color:var(--text-muted);">by ${data.user}</div>
        </div>
        <div class="track-controls" style="flex-grow:0; gap: 0;">
          <button class="action-btn gallery-play-btn" data-url="${data.url}">再生</button>
          ${delBtnHTML}
        </div>
      `;
      worksListContainer.appendChild(itemEl);
    };

    let totalCount = 0;

    if (appMode === "mikiki") {
      // ★ミキキのワークショップ用：1回目と2回目で完成作品を分けて表示
      worksListContainer.insertAdjacentHTML('beforeend', '<div style="font-size:0.8rem; font-weight:bold; color:var(--text-main); margin-bottom:8px; margin-top: 10px;">▼ 1回目 完成作品</div>');
      const snap1 = await db.collection("mikiki_exports_1").orderBy("updatedAt", "desc").get();
      snap1.forEach(doc => { renderItem(doc.data(), doc.id, true, "mikiki_exports_1"); totalCount++; });
      if (snap1.empty) worksListContainer.insertAdjacentHTML('beforeend', '<div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:12px;">まだ作品がありません。</div>');

      worksListContainer.insertAdjacentHTML('beforeend', '<div style="font-size:0.8rem; font-weight:bold; color:var(--text-main); margin-bottom:8px; margin-top: 20px;">▼ 2回目 完成作品</div>');
      const snap2 = await db.collection("mikiki_exports_2").orderBy("updatedAt", "desc").get();
      snap2.forEach(doc => { renderItem(doc.data(), doc.id, true, "mikiki_exports_2"); totalCount++; });
      if (snap2.empty) worksListContainer.insertAdjacentHTML('beforeend', '<div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:12px;">まだ作品がありません。</div>');

    } else {
      // 通常モード（makeなど）の表示
      const trackCollection = (appMode === "make") ? "make_tracks" : "tracks";
      const tracksSnapshot = await db.collection(trackCollection).orderBy("createdAt", "desc").get();
      tracksSnapshot.forEach(doc => {
        renderItem(doc.data(), doc.id, false);
        totalCount++;
      });

      const targetCollection = (appMode === "make") ? "make_exports" : "exports";
      const exportsSnapshot = await db.collection(targetCollection).orderBy("updatedAt", "desc").get();
      exportsSnapshot.forEach(doc => {
        renderItem(doc.data(), doc.id, true);
        totalCount++;
      });

      if(totalCount === 0) {
        worksListContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">まだ作品がありません。</div>';
      }
    }

    document.querySelectorAll('.gallery-play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = e.target.getAttribute('data-url');
        if (currentGalleryPlayBtn === e.target) {
          if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
          e.target.innerText = '再生'; currentGalleryPlayBtn = null; return;
        }
        if (currentGalleryAudio) { currentGalleryAudio.pause(); if (currentGalleryPlayBtn) currentGalleryPlayBtn.innerText = '再生'; }
        currentGalleryAudio = new Audio(formalizeUrl(url));
        currentGalleryAudio.loop = true; currentGalleryAudio.play();
        currentGalleryPlayBtn = e.target; e.target.innerText = '停止';
      });
    });

    document.querySelectorAll('.gallery-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if(!confirm("削除しますか？")) return;
        const docId = e.target.getAttribute('data-id');
        const overrideCol = e.target.getAttribute('data-col');
        
        let col = overrideCol;
        if (!col) {
          const isExport = e.target.getAttribute('data-is-export') === 'true';
          col = isExport 
              ? ((appMode === "make") ? "make_exports" : "exports") 
              : ((appMode === "make") ? "make_tracks" : "tracks");
        }
        await db.collection(col).doc(docId).delete();
        loadGalleryWorks();
      });
    });

  } catch (err) { console.error(err); }
}

if (btnCloseWorks) {
  btnCloseWorks.addEventListener('click', () => {
    worksModal.style.display = 'none';
    if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
    if (currentGalleryPlayBtn) { currentGalleryPlayBtn.innerText = '再生'; currentGalleryPlayBtn = null; }
  });
}

function updateReverb() {
  if (!dryGain || !wetGain || !reverbSlider) return;
  const wetVal = parseFloat(reverbSlider.value);
  wetGain.gain.value = wetVal * 2.5;
  dryGain.gain.value = 1.0;
}

if (reverbSlider) {
  reverbSlider.addEventListener('input', updateReverb);
}

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

function formalizeUrl(url) {
  return url ? url.replace("http://", "https://") : "";
}

async function simulateLocalTrack(name, url, localId, assetId, insertAfterId = null) {
  if (emptyMsg) emptyMsg.style.display = 'none';
  let audioBuffer = null;
  try {
    const response = await fetch(url);
    if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
  } catch (e) { console.error(e); }
  
  const trackGain = audioCtx.createGain();
  const trackRevGain = audioCtx.createGain();
  trackGain.connect(dryGain);
  trackRevGain.connect(wetGain);
  trackGain.gain.value = 0.0;
  trackRevGain.gain.value = 0.0;
  
  const localTrack = {
    id: assetId || localId, dbDocId: localId, name: name, url: url, buffer: audioBuffer, source: null, previewSource: null,
    gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: false, volume: 1.0, isActive: false,
    trackReverb: 0.0, delayTime: 0, duration: audioBuffer ? audioBuffer.duration : 5, isDeletable: true
  };
  
  if (insertAfterId) {
    const targetIndex = tracks.findIndex(t => t.dbDocId === insertAfterId);
    if (targetIndex !== -1) {
      tracks.splice(targetIndex + 1, 0, localTrack);
    } else {
      tracks.push(localTrack);
    }
  } else {
    tracks.push(localTrack);
  }
  
  renderUI();
  if (isMasterPlaying) startTrackSource(localTrack, audioCtx.currentTime - startTime);
}

function startSyncTracks() {
  if (unsubscribeTracks) { unsubscribeTracks(); unsubscribeTracks = null; }
  tracks = [];
  
  if (appMode === "make") {
    if (emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = "環境を読み込み中..."; }
    const loadInitialAssets = MAKE_MODE_ASSETS.map(async (asset) => {
      const path = `assets/sounds/${asset.fileName}`;
      let audioBuffer = null;
      try {
        const response = await fetch(path);
        if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
      } catch (e) { console.error(e); }
      
      const trackGain = audioCtx.createGain();
      const trackRevGain = audioCtx.createGain();
      if (trackGain && trackRevGain) {
        trackGain.connect(dryGain);
        trackRevGain.connect(wetGain);
        trackGain.gain.value = 0.0;
        trackRevGain.gain.value = 0.0;
      }
      return {
        id: asset.id, dbDocId: `local_${asset.id}`, name: asset.name, url: path, buffer: audioBuffer, source: null, previewSource: null,
        gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: false, volume: 1.0, isActive: false,
        trackReverb: 0.0, delayTime: 0, duration: audioBuffer ? audioBuffer.duration : 5, isDeletable: false
      };
    });
    
    Promise.all(loadInitialAssets).then(loadedTracks => {
      if (emptyMsg) emptyMsg.style.display = 'none';
      tracks = loadedTracks;
      renderUI();
    });
  } else {
    if (!db) return;
    unsubscribeTracks = db.collection("tracks").where("user", "==", currentUser).onSnapshot(async (snapshot) => {
      if (snapshot.empty) {
        if(emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = 'トラックを読み込み中...'; }
        if(trackListEl) trackListEl.innerHTML = ''; if(timelineTracksEl) timelineTracksEl.innerHTML = ''; tracks = []; return;
      }
      if (emptyMsg) emptyMsg.style.display = 'none';
      
      const loadPromises = snapshot.docs.map(async (docSnapshot) => {
        const id = docSnapshot.id; const data = docSnapshot.data(); const safeUrl = formalizeUrl(data.url);
        const existingTrack = tracks.find(t => t.dbDocId === id);
        
        if (existingTrack) {
          existingTrack.name = data.name;
          existingTrack.isLooping = data.isLooping !== undefined ? data.isLooping : false;
          existingTrack.isActive = data.isActive !== undefined ? data.isActive : false;
          existingTrack.volume = data.volume !== undefined ? data.volume : 1.0;
          if (existingTrack.delayTime !== data.delayTime) {
            existingTrack.delayTime = data.delayTime !== undefined ? data.delayTime : 0;
            if (isMasterPlaying && audioCtx && !isTransportBusy) {
              if (existingTrack.source) { try{existingTrack.source.stop()}catch(e){} }
              startTrackSource(existingTrack, audioCtx.currentTime - startTime);
            }
          }
          if (existingTrack.gainNode) {
            try { existingTrack.gainNode.disconnect(); } catch(e){}
            try { existingTrack.reverbGainNode.disconnect(); } catch(e){}
            existingTrack.gainNode.connect(dryGain);
            existingTrack.reverbGainNode.connect(wetGain);
            existingTrack.gainNode.gain.value = existingTrack.isActive ? existingTrack.volume : 0.0;
            existingTrack.reverbGainNode.gain.value = existingTrack.isActive ? (existingTrack.trackReverb * 2.0) : 0.0;
          }
          if (existingTrack.source) existingTrack.source.loop = existingTrack.isLooping;
          return existingTrack;
        }
        
        let audioBuffer = null;
        try { const response = await fetch(safeUrl); if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer()); } catch (e) {}
        
        const trackGain = audioCtx.createGain();
        const trackRevGain = audioCtx.createGain();
        const isActiveState = data.isActive !== undefined ? data.isActive : false;
        if (trackGain && trackRevGain) {
          trackGain.connect(dryGain);
          trackRevGain.connect(wetGain);
          trackGain.gain.value = isActiveState ? (data.volume !== undefined ? data.volume : 1.0) : 0.0;
          trackRevGain.gain.value = isActiveState ? ((data.trackReverb || 0.0) * 2.0) : 0.0;
        }
        
        const newTrack = {
          id: id, dbDocId: id, name: data.name, url: safeUrl, buffer: audioBuffer, source: null, previewSource: null,
          gainNode: trackGain, reverbGainNode: trackRevGain,
          isLooping: data.isLooping !== undefined ? data.isLooping : false,
          isActive: isActiveState,
          volume: data.volume !== undefined ? data.volume : 1.0, trackReverb: data.trackReverb || 0.0,
          delayTime: data.delayTime !== undefined ? data.delayTime : 0, duration: audioBuffer ? audioBuffer.duration : 5,
          isDeletable: true
        };
        return newTrack;
      });
      
      const newTracks = await Promise.all(loadPromises);
      const filtered = newTracks.filter(Boolean);
      const merged = [];
      tracks.forEach(t => { if (t.dbDocId.startsWith("local_")) merged.push(t); });
      filtered.forEach(t => merged.push(t));
      tracks = merged;
      renderUI();
    });
  }
}

function renderUI() {
  if (appMode === "make" && document.getElementById('asset-grid-container')) {
    const assetGrid = document.getElementById('asset-grid-container');
    assetGrid.innerHTML = '';
    MAKE_MODE_ASSETS.forEach(asset => {
      const item = document.createElement('div');
      item.className = 'asset-item';
      item.innerHTML = `
        <div class="asset-name">${asset.name}</div>
        <div style="display:flex; justify-content:center; gap:8px;">
          <button class="action-btn asset-preview-btn" data-url="assets/sounds/${asset.fileName}">試聴</button>
          <button class="action-btn asset-add-btn" data-id="${asset.id}" data-url="assets/sounds/${asset.fileName}" data-name="${asset.name}">追加</button>
        </div>
      `;
      assetGrid.appendChild(item);
    });
    
    document.querySelectorAll('.asset-preview-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const url = e.target.getAttribute('data-url');
        if (assetPreviewBtn === e.target && assetPreviewAudio) {
          assetPreviewAudio.pause(); assetPreviewAudio = null;
          e.target.innerText = "試聴"; assetPreviewBtn = null; return;
        }
        if (assetPreviewAudio) { assetPreviewAudio.pause(); if (assetPreviewBtn) assetPreviewBtn.innerText = "試聴"; }
        assetPreviewAudio = new Audio(url); assetPreviewAudio.play();
        assetPreviewBtn = e.target; e.target.innerText = "停止";
        assetPreviewAudio.onended = () => { e.target.innerText = "試聴"; assetPreviewAudio = null; assetPreviewBtn = null; };
      });
    });
    
    document.querySelectorAll('.asset-add-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const url = e.target.getAttribute('data-url');
        const name = e.target.getAttribute('data-name');
        const id = e.target.getAttribute('data-id');
        const ts = Date.now();
        simulateLocalTrack(name, url, `local_${id}_${ts}`, id);
      });
    });
  }

  if (trackListEl) trackListEl.innerHTML = '';
  if (timelineTracksEl) timelineTracksEl.innerHTML = '';
  
  tracks.forEach((track, index) => {
    const mixerEl = document.createElement('div');
    mixerEl.className = 'track-item';
    
    const activeBtnStyle = track.isActive ? "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:var(--text-main); color:var(--bg-color); border:1px solid var(--text-main);" : "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:transparent; color:var(--text-muted); border:1px solid var(--text-muted);";
    const onOffBtnHTML = `<button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} cursor:pointer; flex-shrink:0;">${track.isActive ? 'ON' : 'OFF'}</button>`;
    
    const displayName = (appMode === "make") ? `${track.name} [${index + 1}]` : track.name;
    const nameTrackHTML = (appMode === "make") ? `<span class="track-name-label">${displayName}</span>` : `<input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}">`;
    const deleteBtnHTML = track.isDeletable !== false ? `<button class="action-btn delete-btn" data-id="${track.dbDocId}">削除</button>` : '';
    const previewBtnHTML = `<button class="action-btn preview-btn" data-id="${track.dbDocId}" style="color:var(--text-main); font-size: 0.8rem; padding: 0 4px;">▶</button>`;
    
    const delaySliderHTML = `
      <div class="vol-slider-wrapper" style="width:100px; display:flex; flex-direction:column; align-items:flex-start; gap:2px;">
        <span style="font-size:0.55rem; color:var(--text-muted);">Start</span>
        <input type="range" class="track-delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}">
      </div>`;

    mixerEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          ${onOffBtnHTML}
          ${nameTrackHTML}
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button>
          <div style="display:flex; align-items:center; gap:8px;">
            ${previewBtnHTML}
            <button class="action-btn clone-btn" data-id="${track.dbDocId}">複製</button>
            ${deleteBtnHTML}
          </div>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; align-items:center; gap:16px; width:100%;">
        ${delaySliderHTML}
      </div>
    `;
    if (trackListEl) trackListEl.appendChild(mixerEl);
    
    const rowEl = document.createElement('div');
    rowEl.className = 'timeline-row';
    if (!track.isActive) {
      rowEl.style.display = 'none';
    }
    
    const clipEl = document.createElement('div');
    clipEl.className = 'timeline-clip';
    clipEl.setAttribute('data-id', track.dbDocId);
    clipEl.innerText = displayName + (track.isLooping ? " ↻" : "");
    
    const leftPx = track.delayTime * PIXELS_PER_SEC;
    clipEl.style.left = `${leftPx}px`;
    
    if (track.isLooping) {
      clipEl.style.width = `600px`;
      clipEl.style.background = "repeating-linear-gradient(90deg, #f0f0f0, #f0f0f0 100px, #e8e8e8 101px)";
    } else {
      const w = Math.max(track.duration * PIXELS_PER_SEC, 20);
      clipEl.style.width = `${w}px`;
    }
    rowEl.appendChild(clipEl);
    if (timelineTracksEl) timelineTracksEl.appendChild(rowEl);
  });
  
  if (appMode !== "make") {
    document.querySelectorAll('.track-name-input').forEach(input => {
      input.addEventListener('change', async e => {
        const dbDocId = e.target.getAttribute('data-id');
        if (db && !dbDocId.startsWith("local_")) {
          await db.collection("tracks").doc(dbDocId).update({ name: e.target.value.trim() });
        }
      });
    });
  }

  document.querySelectorAll('.toggle-active-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if (t) {
        t.isActive = !t.isActive;
        if (t.gainNode) t.gainNode.gain.value = t.isActive ? t.volume : 0.0;
        if (t.reverbGainNode) t.reverbGainNode.gain.value = t.isActive ? (t.trackReverb * 2.0) : 0.0;
        const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";
        if (db && !dbDocId.startsWith("local_")) {
          await db.collection(targetCollection).doc(dbDocId).update({ isActive: t.isActive });
        } else {
          renderUI();
        }
      }
    });
  });

  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if(!t || !t.buffer) return;
      if (t.previewSource) {
        try { t.previewSource.stop(); } catch(ex){}
        t.previewSource = null;
        e.target.innerText = '▶'; e.target.classList.remove('active');
      } else {
        await initAudio();
        const source = audioCtx.createBufferSource();
        source.buffer = t.buffer;
        source.connect(masterGain);
        source.onended = () => { t.previewSource = null; e.target.innerText = '▶'; e.target.classList.remove('active'); };
        source.start(0);
        t.previewSource = source;
        e.target.innerText = '■'; e.target.classList.add('active');
      }
    });
  });

  document.querySelectorAll('.loop-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if(!t) return;
      t.isLooping = !t.isLooping;
      const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";
      if (db && !dbDocId.startsWith("local_")) {
        await db.collection(targetCollection).doc(dbDocId).update({ isLooping: t.isLooping });
      } else { renderUI(); }
    });
  });

  document.querySelectorAll('.track-delay-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if(t) {
        t.delayTime = parseFloat(e.target.value);
        const clip = document.querySelector(`.timeline-clip[data-id="${dbDocId}"]`);
        if(clip) clip.style.left = `${t.delayTime * PIXELS_PER_SEC}px`;
      }
    });
    slider.addEventListener('change', async e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if(!t) return;
      t.delayTime = parseFloat(e.target.value);
      const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";
      if (db && !dbDocId.startsWith("local_")) {
        await db.collection(targetCollection).doc(dbDocId).update({ delayTime: t.delayTime });
      } else { renderUI(); }
    });
  });

  document.querySelectorAll('.clone-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if(!t) return;
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";
      
      if (db && !dbDocId.startsWith("local_")) {
        await db.collection(targetCollection).add({
          user: currentUser, name: t.name + " (copy)", url: t.url, storagePath: t.storagePath || "",
          isLooping: t.isLooping, isActive: t.isActive, volume: t.volume, delayTime: t.delayTime,
          estimatedDuration: t.duration, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        simulateLocalTrack(t.name + " (copy)", t.url, localId, t.id, dbDocId);
      } else {
        simulateLocalTrack(t.name + " (copy)", t.url, localId, t.id, dbDocId);
      }
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      if(confirm("削除しますか？")) {
        const dbDocId = e.target.getAttribute('data-id');
        const collectionName = (appMode === "make") ? "make_tracks" : "tracks";
        tracks = tracks.filter(x => x.dbDocId !== dbDocId);
        if (db && !dbDocId.startsWith("local_")) {
          await db.collection(collectionName).doc(dbDocId).delete();
        } else { renderUI(); }
      }
    });
  });
}

function startTrackSource(track, elapsed = 0) {
  if (!track.buffer || !track.gainNode) return;
  if (!track.isActive) return;
  if (track.source) { try { track.source.stop(); } catch(e){} }

  track.source = audioCtx.createBufferSource();
  track.source.buffer = track.buffer;
  track.source.loop = track.isLooping;

  track.source.connect(track.gainNode);
  if (track.reverbGainNode) {
    track.source.connect(track.reverbGainNode);
  }

  const targetStartTime = startTime + track.delayTime;
  const now = audioCtx.currentTime;

  if (isMasterPlaying) {
    if (now < targetStartTime) {
      track.source.start(targetStartTime);
    } else {
      const offset = now - targetStartTime;
      if (track.isLooping) {
        track.source.start(0, offset % track.buffer.duration);
      } else if (offset < track.buffer.duration) {
        track.source.start(0, offset);
      }
    }
  }
}

if (btnMasterPlayStop) {
  btnMasterPlayStop.addEventListener('click', async () => {
    if (isTransportBusy || tracks.length === 0) return;
    isTransportBusy = true;
    try {
      if (!isMasterPlaying) {
        await initAudio();
        tracks.forEach(t => { if (t.previewSource) { try{ t.previewSource.stop(); } catch(e){} t.previewSource = null; } });
        document.querySelectorAll('.preview-btn').forEach(b => { b.innerText = '▶'; b.classList.remove('active'); });

        isMasterPlaying = true;
        btnMasterPlayStop.innerText = "停止";
        btnMasterPlayStop.classList.add('recording');

        startTime = audioCtx.currentTime;
        tracks.forEach(t => startTrackSource(t, 0));
        updateProgress();
      } else {
        isMasterPlaying = false;
        btnMasterPlayStop.innerText = "再生";
        btnMasterPlayStop.classList.remove('recording');
        tracks.forEach(t => { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } });
        cancelAnimationFrame(animationFrameId);
        if (playheadEl) playheadEl.style.left = '0px';
      }
    } finally { isTransportBusy = false; }
  });
}

function updateProgress() {
  animationFrameId = requestAnimationFrame(updateProgress);
  if (!isMasterPlaying) return;

  const elapsed = audioCtx.currentTime - startTime;
  if (playheadEl) playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;

  const loopCycle = 20;

  if (elapsed >= loopCycle) {
    if (isMasterLooping) {
      startTime += loopCycle;
      tracks.forEach(t => {
        if (t.isActive && !t.isLooping) {
          if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; }
          startTrackSource(t, 0);
        }
      });
    } else {
      if (btnMasterPlayStop) btnMasterPlayStop.click();
    }
  }
}

// ★修正：ミキキの交差点ワークショップ用のUI生成とイベントバインド
function setupMikikiExportUI() {
  if (isMikikiExportUISetup || appMode !== "mikiki") return;
  const exportSection = document.getElementById('export-section');
  if (!exportSection) return;

  // 既存のボタンとプレイヤーを非表示にして、1回目・2回目のUIを構築
  const defaultBtn = document.getElementById('btn-export-master');
  const defaultPlayer = document.getElementById('output-player-container');
  if(defaultBtn) defaultBtn.style.display = 'none';
  if(defaultPlayer) defaultPlayer.style.display = 'none';

  exportSection.insertAdjacentHTML('beforeend', `
    <div style="margin-bottom: 24px;">
      <div style="font-size: 0.75rem; color: var(--text-main); margin-bottom: 8px; letter-spacing: 0.1em;">▼ 1回目</div>
      <button id="btn-export-master-1" class="record-btn-export">1回目を完成させる</button>
      <div id="output-player-container-1" style="display: none; margin-top: 15px; padding-bottom: 15px; border-bottom: 1px dashed var(--line-color);">
        <div class="track-item" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 0;">
          <div class="track-name" id="output-file-name-1" style="letter-spacing: 0.1em; color: var(--text-main);">Master Track</div>
          <div class="track-controls" style="gap: 15px;">
            <button id="btn-output-loop-1" class="action-btn active" style="letter-spacing: 0.1em;">Loop: ON</button>
            <button id="btn-output-play-1" class="action-btn" style="letter-spacing: 0.1em;">再生</button>
            <button id="btn-output-stop-1" class="action-btn" style="letter-spacing: 0.1em;">停止</button>
            <button id="btn-output-download-1" class="action-btn-download" style="letter-spacing: 0.1em;">保存</button>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div style="font-size: 0.75rem; color: var(--text-main); margin-bottom: 8px; letter-spacing: 0.1em;">▼ 2回目</div>
      <button id="btn-export-master-2" class="record-btn-export">2回目を完成させる</button>
      <div id="output-player-container-2" style="display: none; margin-top: 15px; padding-bottom: 15px; border-bottom: 1px dashed var(--line-color);">
        <div class="track-item" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 0;">
          <div class="track-name" id="output-file-name-2" style="letter-spacing: 0.1em; color: var(--text-main);">Master Track</div>
          <div class="track-controls" style="gap: 15px;">
            <button id="btn-output-loop-2" class="action-btn active" style="letter-spacing: 0.1em;">Loop: ON</button>
            <button id="btn-output-play-2" class="action-btn" style="letter-spacing: 0.1em;">再生</button>
            <button id="btn-output-stop-2" class="action-btn" style="letter-spacing: 0.1em;">停止</button>
            <button id="btn-output-download-2" class="action-btn-download" style="letter-spacing: 0.1em;">保存</button>
          </div>
        </div>
      </div>
    </div>
  `);

  bindMikikiExportEvents(1);
  bindMikikiExportEvents(2);

  isMikikiExportUISetup = true;
}

function bindMikikiExportEvents(phase) {
  const btnExport = document.getElementById(`btn-export-master-${phase}`);
  const outContainer = document.getElementById(`output-player-container-${phase}`);
  const outFileName = document.getElementById(`output-file-name-${phase}`);
  const btnLoop = document.getElementById(`btn-output-loop-${phase}`);
  const btnPlay = document.getElementById(`btn-output-play-${phase}`);
  const btnStop = document.getElementById(`btn-output-stop-${phase}`);
  const btnDownload = document.getElementById(`btn-output-download-${phase}`);
  const inputName = document.getElementById('input-export-name');

  btnExport.addEventListener('click', async () => {
    if (tracks.length === 0) return;
    const exportName = inputName.value.trim() || `Master_${currentUser}_${phase}`;
    btnExport.innerText = "音源を合成中...";
    btnExport.disabled = true;

    try {
      await initAudio();
      const OfflineCtxConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtxConstructor) throw new Error("非対応");

      const activeTracks = tracks.filter(t => t.isActive);
      if (activeTracks.length === 0) { alert("アクティブな(ONの)トラックがありません。"); return; }

      let renderDur = 20;
      const offlineCtx = new OfflineCtxConstructor(2, audioCtx.sampleRate * renderDur, audioCtx.sampleRate);
      const offlineMasterGain = offlineCtx.createGain();
      offlineMasterGain.connect(offlineCtx.destination);

      const offlineConvolver = offlineCtx.createConvolver();
      offlineConvolver.buffer = createReverbBuffer(offlineCtx, 4.5, 2.5);

      const offlineDryGain = offlineCtx.createGain();
      const offlineWetGain = offlineCtx.createGain();

      offlineDryGain.connect(offlineMasterGain);
      offlineWetGain.connect(offlineConvolver);
      offlineConvolver.connect(offlineMasterGain);

      const wetVal = parseFloat(reverbSlider ? reverbSlider.value : 0);
      offlineWetGain.gain.value = wetVal * 2.5;
      offlineDryGain.gain.value = 1.0;

      activeTracks.forEach(t => {
        if (!t.buffer) return;
        const source = offlineCtx.createBufferSource();
        source.buffer = t.buffer;
        source.loop = t.isLooping;

        const gain = offlineCtx.createGain();
        const revGain = offlineCtx.createGain();

        gain.gain.value = t.volume;
        revGain.gain.value = (t.trackReverb || 0) * 2.0;

        source.connect(gain);
        source.connect(revGain);
        gain.connect(offlineDryGain);
        revGain.connect(offlineWetGain);

        source.start(t.delayTime);
      });

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = bufferToWavBlob(renderedBuffer);

      if (db) {
        const targetCollection = `mikiki_exports_${phase}`;
        const storagePath = `${targetCollection}/${exportName}_${Date.now()}.mp3`;
        const snapshot = await storage.ref().child(storagePath).put(wavBlob);
        const downloadUrl = await snapshot.ref.getDownloadURL();
        await db.collection(targetCollection).doc(currentUser).set({ user: currentUser, title: exportName, url: downloadUrl, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        alert(`クラウドへの保存(${phase}回目)が完了しました。`);
      } else {
        if(phase === 1) outputAudioBuffer1 = renderedBuffer;
        else outputAudioBuffer2 = renderedBuffer;
        if (outContainer) outContainer.style.display = 'block';
        if (outFileName) outFileName.innerText = exportName;
        alert("ローカル環境での合成保存が完了しました。");
      }
    } catch (err) {
      console.error(err);
      alert("合成に失敗しました。");
    } finally {
      btnExport.innerText = `${phase}回目を完成させる`;
      btnExport.disabled = false;
    }
  });

  btnLoop.addEventListener('click', () => {
    if(phase === 1) {
      isOutputLooping1 = !isOutputLooping1;
      btnLoop.innerText = `Loop: ${isOutputLooping1 ? 'ON' : 'OFF'}`;
      btnLoop.classList.toggle('active', isOutputLooping1);
      if (outputAudioSource1) outputAudioSource1.loop = isOutputLooping1;
    } else {
      isOutputLooping2 = !isOutputLooping2;
      btnLoop.innerText = `Loop: ${isOutputLooping2 ? 'ON' : 'OFF'}`;
      btnLoop.classList.toggle('active', isOutputLooping2);
      if (outputAudioSource2) outputAudioSource2.loop = isOutputLooping2;
    }
  });

  btnPlay.addEventListener('click', () => {
    const buffer = phase === 1 ? outputAudioBuffer1 : outputAudioBuffer2;
    if (!buffer) return;
    
    if (phase === 1 && outputAudioSource1) { try{outputAudioSource1.stop()}catch(e){} }
    if (phase === 2 && outputAudioSource2) { try{outputAudioSource2.stop()}catch(e){} }
    if (isMasterPlaying && btnMasterPlayStop) btnMasterPlayStop.click();
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = phase === 1 ? isOutputLooping1 : isOutputLooping2;
    source.connect(audioCtx.destination);
    source.start(0);
    
    if(phase === 1) outputAudioSource1 = source;
    else outputAudioSource2 = source;
    
    btnPlay.classList.add('active');
  });

  btnStop.addEventListener('click', () => {
    if (phase === 1 && outputAudioSource1) { try{outputAudioSource1.stop()}catch(e){} outputAudioSource1 = null; }
    if (phase === 2 && outputAudioSource2) { try{outputAudioSource2.stop()}catch(e){} outputAudioSource2 = null; }
    btnPlay.classList.remove('active');
  });

  btnDownload.addEventListener('click', () => {
    const buffer = phase === 1 ? outputAudioBuffer1 : outputAudioBuffer2;
    if (!buffer) return;
    const wavBlob = bufferToWavBlob(buffer);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(wavBlob);
    a.download = `${inputName.value.trim() || "master"}_${phase}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

function checkExistingExport() {
  if (!db) return;
  if(unsubscribeExport) { unsubscribeExport(); unsubscribeExport = null; }
  if(unsubscribeExport1) { unsubscribeExport1(); unsubscribeExport1 = null; }
  if(unsubscribeExport2) { unsubscribeExport2(); unsubscribeExport2 = null; }

  if (appMode === "mikiki") {
    setupMikikiExportUI();
    
    unsubscribeExport1 = db.collection("mikiki_exports_1").doc(currentUser).onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        const inputName = document.getElementById('input-export-name');
        if (inputName && !inputName.value) inputName.value = data.title || "";
        const outFileName = document.getElementById('output-file-name-1');
        if (outFileName) outFileName.innerText = data.title || 'Master Track 1';
        fetchExistingExportBufferMikiki(data.url, 1);
      }
    });

    unsubscribeExport2 = db.collection("mikiki_exports_2").doc(currentUser).onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        const inputName = document.getElementById('input-export-name');
        if (inputName && !inputName.value) inputName.value = data.title || "";
        const outFileName = document.getElementById('output-file-name-2');
        if (outFileName) outFileName.innerText = data.title || 'Master Track 2';
        fetchExistingExportBufferMikiki(data.url, 2);
      }
    });

  } else {
    // 従来の処理（makeモード等）
    const targetCollection = (appMode === "make") ? "make_exports" : "exports";
    unsubscribeExport = db.collection(targetCollection).doc(currentUser).onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        if (inputExportName) inputExportName.value = data.title || "";
        if (outputFileDisplay) outputFileDisplay.innerText = data.title || 'Master Track';
        fetchExistingExportBuffer(data.url);
      }
    });
  }
}

async function fetchExistingExportBufferMikiki(url, phase) {
  try {
    await initAudio();
    const response = await fetch(formalizeUrl(url));
    const buffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
    const outContainer = document.getElementById(`output-player-container-${phase}`);
    if (phase === 1) outputAudioBuffer1 = buffer;
    else outputAudioBuffer2 = buffer;
    if (outContainer) outContainer.style.display = 'block';
  } catch(e) {}
}

async function fetchExistingExportBuffer(url) {
  try {
    await initAudio();
    const response = await fetch(formalizeUrl(url));
    outputAudioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
    if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';
  } catch(e) {}
}

// 既存の btnExportMaster の処理（makeモード用）
if (btnExportMaster) {
  btnExportMaster.addEventListener('click', async () => {
    if (tracks.length === 0) return;
    const exportName = inputExportName.value.trim() || `Master_${currentUser}`;
    btnExportMaster.innerText = "音源を合成中...";
    btnExportMaster.disabled = true;

    try {
      await initAudio();
      const OfflineCtxConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtxConstructor) throw new Error("非対応");

      const activeTracks = tracks.filter(t => t.isActive);
      if (activeTracks.length === 0) { alert("アクティブな(ONの)トラックがありません。"); return; }

      let renderDur = 20;
      const offlineCtx = new OfflineCtxConstructor(2, audioCtx.sampleRate * renderDur, audioCtx.sampleRate);
      const offlineMasterGain = offlineCtx.createGain();
      offlineMasterGain.connect(offlineCtx.destination);

      const offlineConvolver = offlineCtx.createConvolver();
      offlineConvolver.buffer = createReverbBuffer(offlineCtx, 4.5, 2.5);

      const offlineDryGain = offlineCtx.createGain();
      const offlineWetGain = offlineCtx.createGain();

      offlineDryGain.connect(offlineMasterGain);
      offlineWetGain.connect(offlineConvolver);
      offlineConvolver.connect(offlineMasterGain);

      const wetVal = parseFloat(reverbSlider ? reverbSlider.value : 0);
      offlineWetGain.gain.value = wetVal * 2.5;
      offlineDryGain.gain.value = 1.0;

      activeTracks.forEach(t => {
        if (!t.buffer) return;
        const source = offlineCtx.createBufferSource();
        source.buffer = t.buffer;
        source.loop = t.isLooping;

        const gain = offlineCtx.createGain();
        const revGain = offlineCtx.createGain();

        gain.gain.value = t.volume;
        revGain.gain.value = (t.trackReverb || 0) * 2.0;

        source.connect(gain);
        source.connect(revGain);
        gain.connect(offlineDryGain);
        revGain.connect(offlineWetGain);

        source.start(t.delayTime);
      });

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = bufferToWavBlob(renderedBuffer);

      if (db) {
        const targetCollection = (appMode === "make") ? "make_exports" : "exports";
        const storagePath = `${targetCollection}/${exportName}_${Date.now()}.mp3`;
        const snapshot = await storage.ref().child(storagePath).put(wavBlob);
        const downloadUrl = await snapshot.ref.getDownloadURL();
        await db.collection(targetCollection).doc(currentUser).set({ user: currentUser, title: exportName, url: downloadUrl, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        alert("クラウドへの保存が完了しました。");
      } else {
        outputAudioBuffer = renderedBuffer;
        if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';
        if (outputFileDisplay) outputFileDisplay.innerText = exportName;
        alert("ローカル環境での合成保存が完了しました。下のダウンロードボタンから保存できます。");
      }
    } catch (err) {
      console.error(err);
      alert("合成に失敗しました。スマホのメモリ不足か、ブラウザが未対応の可能性があります。");
    } finally {
      btnExportMaster.innerText = "作品を完成させる";
      btnExportMaster.disabled = false;
    }
  });
}

if (btnOutputDownload) {
  btnOutputDownload.addEventListener('click', () => {
    if (!outputAudioBuffer) return;
    const wavBlob = bufferToWavBlob(outputAudioBuffer);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(wavBlob);
    a.download = `${inputExportName.value.trim() || "master"}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

if (btnOutputLoop) {
  btnOutputLoop.addEventListener('click', () => {
    isOutputLooping = !isOutputLooping;
    btnOutputLoop.innerText = `Loop: ${isOutputLooping ? 'ON' : 'OFF'}`;
    btnOutputLoop.classList.toggle('active', isOutputLooping);
    if (outputAudioSource) outputAudioSource.loop = isOutputLooping;
  });
}

if (btnOutputPlay) {
  btnOutputPlay.addEventListener('click', () => {
    if (!outputAudioBuffer) return;
    if (outputAudioSource) { try{outputAudioSource.stop()}catch(e){} }
    if (isMasterPlaying && btnMasterPlayStop) btnMasterPlayStop.click();
    
    outputAudioSource = audioCtx.createBufferSource();
    outputAudioSource.buffer = outputAudioBuffer;
    outputAudioSource.loop = isOutputLooping;
    outputAudioSource.connect(audioCtx.destination);
    outputAudioSource.start(0);
    btnOutputPlay.classList.add('active');
  });
}

if (btnOutputStop) {
  btnOutputStop.addEventListener('click', () => {
    if (outputAudioSource) { try{outputAudioSource.stop()}catch(e){} outputAudioSource = null; }
    btnOutputPlay.classList.remove('active');
  });
}

function bufferToWavBlob(buffer) {
  const numOfChan = buffer.numberOfChannels, length = buffer.length * numOfChan * 2 + 44, bufferArr = new ArrayBuffer(length), view = new DataView(bufferArr);
  let pos = 0;
  function setUint16(d) { view.setUint16(pos, d, true); pos += 2; }
  function setUint32(d) { view.setUint32(pos, d, true); pos += 4; }
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numOfChan; c++) {
      let sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      pos += 2;
    }
  }
  return new Blob([bufferArr], { type: 'audio/mp3' });
}
