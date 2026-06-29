// Firebase初期化  
const firebaseConfig = {
  apiKey: "AIzaSyCwBqi08ShVjJ90Mku2NsXJK0E03p4CsT4",  
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

let appMode = ""; // "make" (聴く絵画をつくる) 又は "mikiki" (ミキキの交差点)  
let loginStatus = ""; // "first" 又は "return"  
let currentUser = "";  
let audioCtx;  
// リバーブのルーティングを改善  
let masterGain, convolver, dryGain, masterReverbSend;  
let mediaRecorder, recordedChunks = [];  
let isRecording = false;

let tracks = [];  
let isMasterPlaying = false;  
let isMasterLooping = true;  
let startTime = 0;  
let animationFrameId;  
let isTransportBusy = false;

let outputAudioBuffer = null;  
let outputAudioSource = null;  
let isOutputLooping = true;

// 通信重複によるトラック増殖・意図しないデータ混合を確実に防忘するための解除変数  
let unsubscribeTracks = null;  
let unsubscribeExport = null;

const PIXELS_PER_SEC = 30;

// --- 🛠  修正：GitHubの実際ファイル名（日本語名アセット）に100%完全一致させました ---  
const MAKE_MODE_ASSETS = [
  { id: "make_yuragi", name: "ゆらぎ", fileName: "ゆらぎ.mp3" },  
  { id: "make_seseragi", name: "せせらぎ", fileName: "せせらぎ.mp3" },  
  { id: "make_zawameki", name: "ざわめき", fileName: "ざわめき.mp3" },  
  { id: "make_saezuri", name: "さえずり", fileName: "さえずり.mp3" },  
  { id: "make_nakigoe", name: "なきごえ", fileName: "なきごえ.mp3" },  
  { id: "make_haoto", name: "はおと", fileName: "はおと.mp3" }
];

// アセットプール試聴用オーディオインスタンス管理  
let assetPreviewAudio = null;  
let assetPreviewBtn = null;
let assetAudioSourceNode = null; // 試聴ノード解放用の管理変数

// --- Unity（WebGL）自動検出中継用 ---  
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

// --- DOM要素取得 ---  
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
const btnPlayUnityAudio = document.getElementById('btn-play-unity-audio');

const btnRecord = document.getElementById('btn-record');  
const btnPlay = document.getElementById('btn-play');  
const btnRewind = document.getElementById('btn-rewind');  
const btnStop = document.getElementById('btn-stop');  
const btnMasterLoop = document.getElementById('btn-master-loop');  
const reverbSlider = document.getElementById('master-reverb');  
const trackListEl = document.getElementById('track-list');  
const emptyMsg = document.getElementById('empty-msg');  
const timelineTracksEl = document.getElementById('timeline-tracks');  
const playheadEl = document.getElementById('playhead');  
const timelineContainerEl = document.getElementById('timeline-container');

const btnExportMaster = document.getElementById('btn-export-master');

const outputPlayerContainer = document.getElementById('output-player-container');  
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

// --- ヘッダー配下のプロジェクト名バッジ更新制御 ---  
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

// --- オーディオリセット関数 ---  
function resetAudioAndUI() {
  isMasterPlaying = false;  
  tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(ex){} t.source = null; } });  
  cancelAnimationFrame(animationFrameId);  
  if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }  
  if (assetPreviewAudio) { assetPreviewAudio.pause(); assetPreviewAudio = null; }  
  if (assetPreviewBtn) { assetPreviewBtn.innerText = "試聴"; }  
  if (playheadEl) playheadEl.style.left = '0px';
}

// --- モーダル遷移・ログイン・重複確認ロジック ---  
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
    if (!username) {
      alert("ユーザー名を入力してください。");  
      return;
    }
    if (db && loginStatus === "first") {  
      try {
        const userDoc = await db.collection("users").doc(username).get();  
        if (userDoc.exists) {
          alert("このユーザー名は既に存在します。別の名前を入力するか、戻って「2回目以降」を選択してください。");
          return;  
        }  
        await db.collection("users").doc(username).set({
          createdAt: firebase.firestore.FieldValue.serverTimestamp()  
        });
      } catch (err) {  
        console.error("Firestore error:", err);
      }  
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

// --- プロジェクト選択分岐ロジック ---  
if (btnChoiceMake) {
  btnChoiceMake.addEventListener('click', (e) => {
    e.preventDefault();  
    appMode = "make";  
    updateProjectBadge("make");
    
    userModal.style.display = 'none';  
    mainApp.style.display = 'block';  
    if (currentUserDisplay) currentUserDisplay.innerText = currentUser;  
    if (inputRecordSection) inputRecordSection.style.display = 'none';
    
    document.getElementById('asset-pool-section').style.display = 'block';  
    buildAssetPoolUI();
    
    startSyncTracks();  
    checkExistingExport();
  });  
}

if (btnChoiceMikiki) {  
  btnChoiceMikiki.addEventListener('click', (e) => {
    e.preventDefault();  
    appMode = "mikiki";  
    updateProjectBadge("mikiki");  
    loadUnityInstance();
    
    document.getElementById('asset-pool-section').style.display = 'none';
    
    modalStep3.style.display = 'none';  
    modalStep4.style.display = 'block';
  });  
}

if (btnBackToStep3) {  
  btnBackToStep3.addEventListener('click', () => {
    modalStep4.style.display = 'none';  
    modalStep3.style.display = 'block';
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

// --- 全てのメイン画面に設置される階層別の「← 戻る」ロジック ---  
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

// --- ロゴを押すとホーム（ステップ3）にリセットして戻るロジック ---  
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

// --- 聴くモード用アセットロード中継 ---  
let isListenModePlaying = false;

if (btnPlayUnityAudio) {
  btnPlayUnityAudio.addEventListener('click', () => {  
    if (appMode === "mikiki") {
      if (!getUnityInstance()) {  
        alert("Unityシステムをロード中です。数秒お待ちください。");  
        return;
      }  
      if (!isListenModePlaying) {
        playUnityAudio();  
        isListenModePlaying = true;  
        btnPlayUnityAudio.innerText = "絵画の音を停止";  
        btnPlayUnityAudio.classList.add('recording');
      } else {  
        stopUnityAudio();  
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
        if (currentGalleryAudio) {  
          currentGalleryAudio.pause();  
          currentGalleryAudio = null;
        }  
        isListenModePlaying = false;  
        btnPlayUnityAudio.innerText = "絵画の音を聴く";
      }  
    }
  });  
}

// オーディオコンテキストのユーザー操作による再開（ブラウザセキュリティ対策）  
document.body.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();  
}, true);

document.body.addEventListener('touchstart', () => {  
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, {passive: true, once: true});

// --- ミキキの交差点・録音処理 ---  
if (btnRecord) {
  btnRecord.addEventListener('click', async () => {  
    await initAudio();  
    if (!isRecording) {
      try {  
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });  
        mediaRecorder = new MediaRecorder(stream);  
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = e => {  
          if (e.data.size > 0) recordedChunks.push(e.data);
        };
        
        mediaRecorder.onstop = async () => {  
          btnRecord.innerText = "Processing...";  
          const blob = new Blob(recordedChunks, { type: 'audio/webm' });  
          const timestamp = Date.now();  
          const storagePath = `audios/track_${timestamp}.webm`;
          
          if (storage && db) {  
            try {
              const snapshot = await storage.ref().child(storagePath).put(blob);  
              const downloadUrl = await snapshot.ref.getDownloadURL();
              
              await db.collection("tracks").add({  
                user: currentUser,  
                name: `Track ${String(timestamp).substring(9, 13)}`,  
                url: downloadUrl,  
                storagePath: storagePath,  
                isLooping: true,  
                volume: 1.0,  
                delayTime: 0,  
                estimatedDuration: (Date.now() - recordStart) / 1000,  
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              });  
            } catch (e) {
              alert("録音の保存に失敗しました。");  
            }
          } else {  
            simulateLocalTrack(`Track ${String(timestamp).substring(9, 13)}`, URL.createObjectURL(blob));  
          }  
          btnRecord.innerText = "録音を開始";
        };
        
        const recordStart = Date.now();  
        mediaRecorder.start();  
        isRecording = true;  
        btnRecord.innerText = "録音を停止";  
        btnRecord.classList.add('recording');  
        playUnityAudio();
      } catch (err) {  
        alert("マイクへのアクセスが拒否されました。");
      }  
    } else {
      mediaRecorder.stop();  
      mediaRecorder.stream.getTracks().forEach(t => t.stop());  
      isRecording = false;  
      btnRecord.classList.remove('recording');  
      stopUnityAudio();
    }  
  });
}

// --- 作品一覧ロジック ---  
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
    const targetCollection = (appMode === "make") ? "make_exports" : "exports";  
    const snapshot = await db.collection(targetCollection).orderBy("updatedAt", "desc").get();
    
    if (worksListContainer) worksListContainer.innerHTML = '';
    
    if (snapshot.empty) {  
      worksListContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">まだ作品がありません。</div>';  
      return;
    }
    
    snapshot.forEach(doc => {  
      const data = doc.data();  
      const itemEl = document.createElement('div');  
      itemEl.className = 'track-item';  
      itemEl.style.borderBottom = '1px solid var(--line-color)';  
      itemEl.style.padding = '12px 0';
      
      const isOwn = (data.user === currentUser);  
      const delBtnHTML = isOwn ? `<button class="action-btn gallery-delete-btn" data-id="${doc.id}" style="color:var(--danger); margin-left:12px;">削除</button>` : '';
      
      itemEl.innerHTML = `  
        <div style="display:flex; flex-direction:column; gap:4px; max-width:60%;">
          <div class="track-name" style="font-size:0.75rem; color:var(--text-main);">${data.title || 'Untitled'}</div>
          <div style="font-size:0.55rem; color:var(--text-muted);">by ${data.user}</div>  
        </div>  
        <div class="track-controls" style="flex-grow:0; gap: 0;">
          <button class="action-btn gallery-play-btn" data-url="${data.url}">再生</button>  
          ${delBtnHTML}
        </div>`;  
      worksListContainer.appendChild(itemEl);
    });
    
    document.querySelectorAll('.gallery-play-btn').forEach(btn => {  
      btn.addEventListener('click', (e) => {
        const url = e.target.getAttribute('data-url');
        if (currentGalleryPlayBtn === e.target) {  
          if (currentGalleryAudio) {
            currentGalleryAudio.pause();  
            currentGalleryAudio = null;
          }  
          e.target.innerText = '再生';  
          currentGalleryPlayBtn = null;  
          return;
        }
        if (currentGalleryAudio) {  
          currentGalleryAudio.pause();  
          if (currentGalleryPlayBtn) currentGalleryPlayBtn.innerText = '再生';
        }
        currentGalleryAudio = new Audio(formalizeUrl(url));  
        currentGalleryAudio.loop = true;  
        currentGalleryAudio.play();  
        currentGalleryPlayBtn = e.target;  
        e.target.innerText = '停止';
      });  
    });
    
    document.querySelectorAll('.gallery-delete-btn').forEach(btn => {  
      btn.addEventListener('click', async (e) => {
        if(!confirm("削除しますか？")) return;  
        const targetCollection = (appMode === "make") ? "make_exports" : "exports";
        await db.collection(targetCollection).doc(e.target.getAttribute('data-id')).delete();  
        loadGalleryWorks();
      });  
    });
  } catch (err) {  
    console.error(err);
  }  
}

if (btnCloseWorks) {  
  btnCloseWorks.addEventListener('click', () => {
    worksModal.style.display = 'none';  
    if (currentGalleryAudio) {
      currentGalleryAudio.pause();  
      currentGalleryAudio = null;
    }  
    if (currentGalleryPlayBtn) {
      currentGalleryPlayBtn.innerText = '再生';  
      currentGalleryPlayBtn = null;
    }  
  });
}

// --- Web Audio API コア初期化（ルーティングを並列センド構造に抜本的改善） ---  
async function initAudio() {
  if (!audioCtx) {  
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    masterGain = audioCtx.createGain();  
    masterGain.gain.value = 1.0;  
    masterGain.connect(audioCtx.destination);
    
    convolver = audioCtx.createConvolver();  
    // 空間の広がりをリッチにするためdecayを3.5に  
    convolver.buffer = createReverbBuffer(audioCtx, 3.5, 3.0);
    
    dryGain = audioCtx.createGain();  
    // マスターリバーブへ送るための専用ゲイン（並列処理）  
    masterReverbSend = audioCtx.createGain();
    
    dryGain.connect(masterGain);  
    dryGain.connect(masterReverbSend);  
    masterReverbSend.connect(convolver);  
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

function updateReverb() {  
  if (!masterReverbSend || !reverbSlider) return;  
  const val = parseFloat(reverbSlider.value);  
  // 全体リバーブをしっかり効かせるために1.5倍ブースト  
  masterReverbSend.gain.value = val * 1.5;
}

if (reverbSlider) {  
  reverbSlider.addEventListener('input', updateReverb);
}

function formalizeUrl(url) {  
  return url ? url.replace("http://", "https://") : "";
}

// --- アセットプール（表型）のUI動的構築 ---  
function buildAssetPoolUI() {
  const poolContainer = document.getElementById('asset-grid-container');  
  if (!poolContainer) return;  
  poolContainer.innerHTML = '';
  
  MAKE_MODE_ASSETS.forEach(asset => {  
    const item = document.createElement('div');  
    item.className = 'asset-pool-item';  
    item.innerHTML = `
      <span class="asset-pool-name">${asset.name}</span>  
      <div class="asset-pool-actions">
        <button class="action-btn asset-preview-btn" data-file="${asset.fileName}">試聴</button>  
        <button class="action-btn asset-add-btn" data-id="${asset.id}" data-name="${asset.name}" data-file="${asset.fileName}">追加</button>  
      </div>`;  
    poolContainer.appendChild(item);
  });
  
  // 試聴ボタン（パス参照バグを完全解消）  
  document.querySelectorAll('.asset-preview-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {  
      await initAudio();  
      const fileName = e.target.getAttribute('data-file');  
      const path = `assets/sounds/${fileName}`;
      
      if (assetPreviewAudio && assetPreviewBtn === e.target) {  
        try { assetPreviewAudio.pause(); } catch(ex){}
        assetPreviewAudio = null;  
        e.target.innerText = "試聴";  
        assetPreviewBtn = null;  
        return;
      }
      
      if (assetPreviewAudio) {  
        try { assetPreviewAudio.pause(); } catch(ex){}
        if (assetPreviewBtn) assetPreviewBtn.innerText = "試聴";
      }
      
      assetPreviewAudio = new Audio(path);  
      assetPreviewAudio.loop = true;
      
      try {  
        if (assetAudioSourceNode) { try { assetAudioSourceNode.disconnect(); } catch(e){} }
        assetAudioSourceNode = audioCtx.createMediaElementSource(assetPreviewAudio);  
        assetAudioSourceNode.connect(masterGain);
      } catch(ex) {}
      
      assetPreviewAudio.play();  
      assetPreviewBtn = e.target;  
      e.target.innerText = "停止";
    });  
  });
  
  // 追加ボタン  
  document.querySelectorAll('.asset-add-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {  
      await initAudio();  
      const assetId = e.target.getAttribute('data-id');  
      const name = e.target.getAttribute('data-name');  
      const fileName = e.target.getAttribute('data-file');  
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      
      if (db) {  
        try {
          await db.collection("make_tracks").add({  
            user: currentUser, assetId: assetId, name: name, url: `assets/sounds/${fileName}`,  
            delayTime: 0, volume: 1.0, trackReverb: 0.0, isLooping: true,  
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          // ★追加: DB保存後、UIに即反映
          if (appMode === "make") {
            simulateLocalTrack(name, `assets/sounds/${fileName}`, localId, assetId);
          }
        } catch (err) {  
          simulateLocalTrack(name, `assets/sounds/${fileName}`, localId, assetId);
        }  
      } else {
        simulateLocalTrack(name, `assets/sounds/${fileName}`, localId, assetId);  
      }
    });  
  });
}

// --- 🔥 ローカル・スタンドアロン専用のフォールバック制御回路（Firestoreエラー時も100%動かす） ---  
async function simulateLocalTrack(name, url, localId, assetId) {
  if (emptyMsg) emptyMsg.style.display = 'none';
  
  let audioBuffer = null;  
  try {
    const response = await fetch(url);  
    if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
  } catch (e) { console.error(e); }
  
  const trackGain = audioCtx.createGain();  
  const trackRevGain = audioCtx.createGain();
  
  // ドライ音はdryGainへ、リバーブ成分は直接convolverへ送る  
  trackGain.connect(dryGain);  
  trackRevGain.connect(convolver);
  
  trackGain.gain.value = 1.0;  
  trackRevGain.gain.value = 0.0;
  
  const localTrack = {  
    id: assetId || localId, dbDocId: localId, name: name, url: url, buffer: audioBuffer, source: null,  
    gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: true, volume: 1.0,  
    trackReverb: 0.0, delayTime: 0, duration: audioBuffer ? audioBuffer.duration : 5
  };
  
  tracks.push(localTrack);  
  renderUI();  
  if (isMasterPlaying) startTrackSource(localTrack, audioCtx.currentTime - startTime);
}

// --- データ同期 ＆ ミキサー展開処理 ---  
function startSyncTracks() {
  if (unsubscribeTracks) {  
    unsubscribeTracks();  
    unsubscribeTracks = null;
  }  
  tracks = [];

  // ★修正: 起動時は「空っぽ」からスタートさせるようにしました。
  if (appMode === "make") {  
    if (emptyMsg) {
      emptyMsg.style.display = 'block';  
      emptyMsg.innerText = "上のプールから音源を追加してください。";
    }
    renderUI();
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
          existingTrack.name = data.name; existingTrack.isLooping = data.isLooping !== undefined ? data.isLooping : true; existingTrack.volume = data.volume !== undefined ? data.volume : 1.0;
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
            existingTrack.reverbGainNode.connect(convolver);  
            existingTrack.gainNode.gain.value = existingTrack.volume;  
            existingTrack.reverbGainNode.gain.value = existingTrack.trackReverb * 1.5;
          }  
          if (existingTrack.source) existingTrack.source.loop = existingTrack.isLooping;  
          return existingTrack;
        }
        
        let audioBuffer = null;  
        try { const response = await fetch(safeUrl); if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer()); } catch (e) {}
        
        const trackGain = audioCtx.createGain();  
        const trackRevGain = audioCtx.createGain();  
        if (trackGain && trackRevGain) {
          trackGain.connect(dryGain);  
          trackRevGain.connect(convolver);  
          trackGain.gain.value = data.volume !== undefined ? data.volume : 1.0;  
          trackRevGain.gain.value = data.trackReverb ? data.trackReverb * 1.5 : 0.0;
        }
        
        const newTrack = {  
          id: id, dbDocId: id, name: data.name, url: safeUrl, buffer: audioBuffer, source: null,
          gainNode: trackGain, reverbGainNode: trackRevGain,  
          isLooping: data.isLooping !== undefined ? data.isLooping : true, volume: data.volume !== undefined ? data.volume : 1.0, trackReverb: data.trackReverb || 0.0,  
          delayTime: data.delayTime !== undefined ? data.delayTime : 0, duration: audioBuffer ? audioBuffer.duration : 5  
        };  
        return newTrack;
      });
      
      tracks = await Promise.all(loadPromises);  
      tracks.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));  
      renderUI();
    });  
  }
}

function renderUI() {  
  if (!trackListEl || !timelineTracksEl) return;  
  trackListEl.innerHTML = '';  
  timelineTracksEl.innerHTML = '';  
  let maxTimelineWidth = 600;
  
  if (tracks.length === 0) {  
    if (emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = "上のプールから音源を追加してください。"; }  
    return;
  } else {  
    if (emptyMsg) emptyMsg.style.display = 'none';
  }
  
  tracks.forEach((track, index) => {  
    const mixerEl = document.createElement('div');  
    mixerEl.className = 'track-item';
    
    const displayName = (appMode === "make") ? `${track.name} [${index + 1}]` : track.name;  
    const nameTrackHTML = (appMode === "make") ? `<span class="track-name-label">${displayName}</span>` : `<input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}">`;
    
    const actionButtonsHTML = `<button class="action-btn clone-btn" data-id="${track.dbDocId}">複製</button><button class="action-btn delete-btn" data-id="${track.dbDocId}">削除</button>`;
    
    const reverbSliderHTML = (appMode === "make") ? `  
      <div class="vol-slider-wrapper" style="width:75px;">
        <input type="range" class="track-reverb-slider" data-id="${track.dbDocId}" min="0" max="1" step="0.01" value="${track.trackReverb}">
      </div>` : '';
      
    mixerEl.innerHTML = `  
      ${nameTrackHTML}  
      <div class="track-controls">
        <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button>
        <div class="vol-slider-wrapper" style="width:75px;">  
          <input type="range" class="vol-slider" data-id="${track.dbDocId}" min="0" max="1" step="0.01" value="${track.volume}">
        </div>  
        ${reverbSliderHTML}  
        ${actionButtonsHTML}
      </div>`;  
    trackListEl.appendChild(mixerEl);
    
    const rowEl = document.createElement('div');  
    rowEl.className = 'timeline-row';  
    const clipEl = document.createElement('div');  
    clipEl.className = 'timeline-clip';  
    clipEl.innerText = displayName + (track.isLooping ? " ↻" : "");
    
    // ★追加: スクロールをブロック
    clipEl.style.touchAction = 'none';
    
    const leftPx = track.delayTime * PIXELS_PER_SEC;  
    clipEl.style.left = `${leftPx}px`;
    
    if (track.isLooping) {  
      clipEl.style.width = `1200px`;  
      clipEl.style.background = "repeating-linear-gradient(90deg, #f0f0f0, #f0f0f0 100px, #e8e8e8 101px)";  
    } else {
      clipEl.style.width = `${Math.max(track.duration * PIXELS_PER_SEC, 20)}px`;  
    }
    
    if (leftPx + (track.duration * PIXELS_PER_SEC) > maxTimelineWidth) {  
      maxTimelineWidth = leftPx + (track.duration * PIXELS_PER_SEC) + 300;
    }
    
    setupDraggableClip(clipEl, track);  
    rowEl.appendChild(clipEl);  
    timelineTracksEl.appendChild(rowEl);
  });
  
  if (timelineContainerEl) timelineContainerEl.style.width = `${maxTimelineWidth}px`;  
  attachMixerEvents();
}

function setupDraggableClip(clipEl, track) {  
  let isDragging = false; let startX = 0; let initialDelay = 0;
  
  const onStart = (e) => {  
    // スマートフォンの標準スクロールのみを抑制し、クリック判定は生かす調整
    if (e.type === 'touchstart') {
      isDragging = true;
      startX = e.touches[0].clientX;
    } else {
      isDragging = true;
      startX = e.clientX;
    }
    if (!isMasterPlaying) initAudio();  
    initialDelay = track.delayTime;  
    clipEl.style.zIndex = 100;  
    document.body.style.userSelect = 'none';
  };
  
  const onMove = (e) => {
    if (!isDragging) return;  
    if (e.cancelable) e.preventDefault(); // ドラッグ中のみ追従スクロールをロック
    
    const currentX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;  
    clipEl.style.left = `${Math.max(0, initialDelay + ((currentX - startX) / PIXELS_PER_SEC)) * PIXELS_PER_SEC}px`;  
  };
  
  const onEnd = async (e) => {  
    if (!isDragging) return;  
    isDragging = false;  
    clipEl.style.zIndex = '';  
    document.body.style.userSelect = '';
    
    const currentX = e.type.includes('touch') ? (e.changedTouches ? e.changedTouches[0].clientX : startX) : e.clientX;  
    let newDelay = Math.max(0, initialDelay + ((currentX - startX) / PIXELS_PER_SEC));  
    track.delayTime = newDelay;
    
    const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";  
    if (db && track.dbDocId && !track.dbDocId.startsWith("local_")) {
      await db.collection(targetCollection).doc(track.dbDocId).update({ delayTime: newDelay });  
    } else {
      renderUI();  
    }
  };
  
  clipEl.addEventListener('mousedown', onStart);  
  clipEl.addEventListener('touchstart', onStart, {passive: true}); 
  window.addEventListener('mousemove', onMove);  
  window.addEventListener('touchmove', onMove, {passive: false}); // ここだけ標準スクロールと競合するためfalseでロック保持
  window.addEventListener('mouseup', onEnd);  
  window.addEventListener('touchend', onEnd);
}

function attachMixerEvents() {  
  document.querySelectorAll('.track-name-input').forEach(input => {
    input.addEventListener('change', async e => {  
      const dbDocId = e.target.getAttribute('data-id');  
      const t = tracks.find(x => x.dbDocId === dbDocId);  
      if (t) t.name = e.target.value.trim();  
      if (db && !dbDocId.startsWith("local_")) await db.collection("tracks").doc(dbDocId).update({ name: e.target.value.trim() });  
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
        if (appMode === "make") renderUI(); // ★追加: 即UI反映
      } else {
        renderUI();  
      }
    });  
  });
  
  document.querySelectorAll('.vol-slider').forEach(slider => {  
    slider.addEventListener('input', e => {
      const dbDocId = e.target.getAttribute('data-id');  
      const t = tracks.find(x => x.dbDocId === dbDocId);  
      if (t && t.gainNode) t.gainNode.gain.value = parseFloat(e.target.value);
    });  
    slider.addEventListener('change', async e => {
      const dbDocId = e.target.getAttribute('data-id');  
      const t = tracks.find(x => x.dbDocId === dbDocId);  
      if(!t) return;  
      t.volume = parseFloat(e.target.value);  
      const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";  
      if (db && !dbDocId.startsWith("local_")) await db.collection(targetCollection).doc(dbDocId).update({ volume: t.volume });  
    });
  });
  
  document.querySelectorAll('.track-reverb-slider').forEach(slider => {  
    slider.addEventListener('input', e => {
      const dbDocId = e.target.getAttribute('data-id');  
      const t = tracks.find(x => x.dbDocId === dbDocId);  
      if (t && t.reverbGainNode) t.reverbGainNode.gain.value = parseFloat(e.target.value) * 1.5;
    });  
    slider.addEventListener('change', async e => {
      const dbDocId = e.target.getAttribute('data-id');  
      const t = tracks.find(x => x.dbDocId === dbDocId);  
      if(t) t.trackReverb = parseFloat(e.target.value);  
      if (db && !dbDocId.startsWith("local_")) await db.collection("make_tracks").doc(dbDocId).update({ trackReverb: t.trackReverb });  
    });
  });
  
  document.querySelectorAll('.clone-btn').forEach(btn => {  
    btn.addEventListener('click', async e => {
      const dbDocId = e.target.getAttribute('data-id');  
      const t = tracks.find(x => x.dbDocId === dbDocId);  
      if (!t) return;
      
      const targetCollection = (appMode === "make") ? "make_tracks" : "tracks";  
      const makeExtension = (appMode === "make") ? { assetId: t.id, trackReverb: t.trackReverb } : {};
      
      if (db && !dbDocId.startsWith("local_")) {  
        await db.collection(targetCollection).add({
          user: currentUser, name: t.name, url: t.url, storagePath: t.storagePath || "",  
          isLooping: t.isLooping, volume: t.volume, delayTime: t.delayTime,  
          estimatedDuration: t.duration,  
          ...makeExtension, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });  
        if (appMode === "make") { // ★追加: 複製時の即UI反映
          const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;  
          simulateLocalTrack(t.name, t.url, localId, t.id);
        }
      } else {
        const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;  
        simulateLocalTrack(t.name, t.url, localId, t.id);
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
          if (appMode === "make") renderUI(); // ★追加: 削除時の即UI反映
        } else {
          renderUI();  
        }
      }  
    });
  });  
}

function startTrackSource(track, elapsed = 0) {  
  if (!track.buffer || !track.gainNode) return;  
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

// --- トランスポート制御 ---  
if (btnPlay) {
  btnPlay.addEventListener('click', async () => {  
    if (isTransportBusy || isMasterPlaying || tracks.length === 0) return;  
    isTransportBusy = true;  
    try {
      await initAudio();  
      isMasterPlaying = true;  
      btnPlay.classList.add('active');  
      if (btnStop) btnStop.classList.remove('active');
      
      startTime = audioCtx.currentTime;  
      tracks.forEach(t => startTrackSource(t, 0));  
      updateProgress();
    } finally {  
      isTransportBusy = false;
    }  
  });
}

if (btnStop) {  
  btnStop.addEventListener('click', () => {
    isMasterPlaying = false;  
    btnPlay.classList.remove('active');  
    btnStop.classList.add('active');  
    tracks.forEach(t => { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } });  
    cancelAnimationFrame(animationFrameId);  
    if (playheadEl) playheadEl.style.left = '0px';
  });  
}

if (btnRewind) {  
  btnRewind.addEventListener('click', () => {
    const wasPlaying = isMasterPlaying;  
    isMasterPlaying = false;  
    tracks.forEach(t => { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } });  
    cancelAnimationFrame(animationFrameId);
    
    if (btnPlay) btnPlay.classList.remove('active');  
    if (btnStop) btnStop.classList.remove('active');  
    if (playheadEl) playheadEl.style.left = '0px';
    
    if (audioCtx) startTime = audioCtx.currentTime;
    
    if (wasPlaying) setTimeout(() => { btnPlay.click(); }, 100);  
  });
}

if (btnMasterLoop) {  
  btnMasterLoop.addEventListener('click', () => {
    isMasterLooping = !isMasterLooping;  
    btnMasterLoop.classList.toggle('active', isMasterLooping);  
    btnMasterLoop.innerText = `全体ループ: ${isMasterLooping ? 'ON' : 'OFF'}`;
  });  
}

function updateProgress() {  
  animationFrameId = requestAnimationFrame(updateProgress);  
  if (!isMasterPlaying) return;
  
  const elapsed = audioCtx.currentTime - startTime;  
  if (playheadEl) playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;
  
  const maxDur = tracks.length > 0 ? Math.max(...tracks.map(t => parseFloat(t.duration) + parseFloat(t.delayTime))) : 0;
  
  if (maxDur > 0 && elapsed >= maxDur) {  
    if (isMasterLooping) {
      startTime = audioCtx.currentTime;  
      tracks.forEach(t => { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; }  
      startTrackSource(t, 0); });
    } else {  
      if (btnStop) btnStop.click();
    }  
  }
}

function checkExistingExport() {  
  if (!db) return;  
  if(unsubscribeExport) { unsubscribeExport(); unsubscribeExport = null; }  
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

async function fetchExistingExportBuffer(url) {  
  try {
    await initAudio();  
    const response = await fetch(formalizeUrl(url));  
    outputAudioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer());  
    if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';
  } catch(e) {}  
}

if (btnExportMaster) {  
  btnExportMaster.addEventListener('click', async () => {
    if (tracks.length === 0) return;  
    const exportName = inputExportName.value.trim() || `Master_${currentUser}`;  
    btnExportMaster.innerText = "音源を合成中...";  
    btnExportMaster.disabled = true;
    
    try {  
      await initAudio();
      
      const maxTrackDur = Math.max(...tracks.map(t => {  
        const dur = (t.buffer ? t.buffer.duration : 5);  
        return parseFloat(dur) + parseFloat(t.delayTime || 0);
      }));
      
      const offlineCtx = new OfflineAudioContext(2, audioCtx.sampleRate * maxTrackDur, audioCtx.sampleRate);
      
      const offlineMasterGain = offlineCtx.createGain();  
      offlineMasterGain.connect(offlineCtx.destination);
      
      const offlineConvolver = offlineCtx.createConvolver();  
      offlineConvolver.buffer = createReverbBuffer(offlineCtx, 3.5, 3.0);
      
      const offlineDryGain = offlineCtx.createGain();  
      offlineDryGain.connect(offlineMasterGain);
      
      const offlineMasterReverbSend = offlineCtx.createGain();  
      offlineDryGain.connect(offlineMasterReverbSend);  
      offlineMasterReverbSend.connect(offlineConvolver);
      
      offlineConvolver.connect(offlineMasterGain);
      
      const masterRevVal = parseFloat(reverbSlider.value);  
      offlineMasterReverbSend.gain.value = masterRevVal * 1.5;
      
      tracks.forEach(t => {  
        if (!t.buffer) return;
        const source = offlineCtx.createBufferSource();  
        source.buffer = t.buffer;  
        source.loop = t.isLooping;
        
        const gain = offlineCtx.createGain();  
        const revGain = offlineCtx.createGain();
        
        gain.gain.value = t.volume;  
        revGain.gain.value = t.trackReverb * 1.5;
        
        source.connect(gain);  
        source.connect(revGain);
        
        gain.connect(offlineDryGain);  
        revGain.connect(offlineConvolver);
        
        source.start(t.delayTime);  
      });
      
      const renderedBuffer = await offlineCtx.startRendering();  
      const wavBlob = bufferToWavBlob(renderedBuffer);
      
      if (db) {  
        const targetCollection = (appMode === "make") ? "make_exports" : "exports";  
        const storagePath = `${targetCollection}/${exportName}_${Date.now()}.mp3`;  
        const snapshot = await storage.ref().child(storagePath).put(wavBlob);  
        const downloadUrl = await snapshot.ref.getDownloadURL();
        
        await db.collection(targetCollection).doc(currentUser).set({  
          user: currentUser, title: exportName, url: downloadUrl, updatedAt: firebase.firestore.FieldValue.serverTimestamp()  
        });  
        alert("クラウドへの保存が完了しました。");
      } else {  
        outputAudioBuffer = renderedBuffer;  
        if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';  
        if (outputFileDisplay) outputFileDisplay.innerText = exportName;  
        alert("ローカル環境での合成保存が完了しました。下のダウンロードボタンから保存できます。");  
      }
    } catch (err) {  
      alert("合成に失敗しました。");
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
    if (isMasterPlaying) btnStop.click();  
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
