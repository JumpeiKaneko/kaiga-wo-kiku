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

let appMode = "";
let loginStatus = "";
let currentUser = "";
let audioCtx;
let masterGain, convolver, dryGain, masterReverbSend;
let mediaRecorder, recordedChunks = [];
let isRecording = false;

let tracks = [];
let isMasterPlaying = false;
let startTime = 0;
let animationFrameId;
let isTransportBusy = false;

let outputAudioBuffer = null;
let outputAudioSource = null;
let isOutputLooping = true;

let unsubscribeTracks = null;
let unsubscribeExport = null;

const PIXELS_PER_SEC = 30;

const MAKE_MODE_ASSETS = [
  { id: "make_yuragi", name: "ゆらぎ", fileName: "ゆらぎ.mp3" },
  { id: "make_seseragi", name: "せせらぎ", fileName: "せせらぎ.mp3" },
  { id: "make_zawameki", name: "ざわめき", fileName: "ざわめき.mp3" },
  { id: "make_saezuri", name: "さえずり", fileName: "さえずり.mp3" },
  { id: "make_nakigoe", name: "なきごえ", fileName: "なきごえ.mp3" },
  { id: "make_haoto", name: "はおと", fileName: "はおと.mp3" }
];

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
const btnPlay = document.getElementById('btn-play'); // 統合された再生/停止ボタン
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
  if (isMasterPlaying && btnPlay) {
    btnPlay.click(); // 再生中なら停止させる
  }
  isMasterPlaying = false;
  tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(ex){} t.source = null; } });
  cancelAnimationFrame(animationFrameId);
  if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
  if (playheadEl) playheadEl.style.left = '0px';
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
          alert("このユーザー名は既に存在します。別の名前を入力するか、戻って「2回目以降」を選択してください。");
          return;
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

if (btnChoiceMake) {
  btnChoiceMake.addEventListener('click', (e) => {
    e.preventDefault();
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
  btnChoiceMikiki.addEventListener('click', (e) => {
    e.preventDefault();
    appMode = "mikiki";
    updateProjectBadge("mikiki");
    loadUnityInstance();
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

let isListenModePlaying = false;
if (btnPlayUnityAudio) {
  btnPlayUnityAudio.addEventListener('click', () => {
    if (appMode === "mikiki") {
      if (!getUnityInstance()) { alert("Unityシステムをロード中です。数秒お待ちください。"); return; }
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
        if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
        isListenModePlaying = false;
        btnPlayUnityAudio.innerText = "絵画の音を聴く";
      }
    }
  });
}

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);
document.body.addEventListener('touchstart', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, {passive: true, once: true});

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
              await db.collection("tracks").add({
                user: currentUser, name: `Track ${String(timestamp).substring(9, 13)}`, url: downloadUrl,
                storagePath: storagePath, isLooping: true, volume: 1.0, delayTime: 0,
                estimatedDuration: (Date.now() - recordStart) / 1000, createdAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            } catch (e) { alert("録音の保存に失敗しました。"); }
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
          if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
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
  } catch (err) { console.error(err); }
}

if (btnCloseWorks) {
  btnCloseWorks.addEventListener('click', () => {
    worksModal.style.display = 'none';
    if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
    if (currentGalleryPlayBtn) { currentGalleryPlayBtn.innerText = '再生'; currentGalleryPlayBtn = null; }
  });
}

// --- Web Audio API 初期化 ---
async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);

    convolver = audioCtx.createConvolver();
    convolver.buffer = createReverbBuffer(audioCtx, 3.5, 3.0);

    dryGain = audioCtx.createGain();
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
  masterReverbSend.gain.value = val * 1.5;
}

if (reverbSlider) { reverbSlider.addEventListener('input', updateReverb); }

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

// --- データ同期 ＆ ミキサー展開処理 ---
function startSyncTracks() {
  if (unsubscribeTracks) { unsubscribeTracks(); unsubscribeTracks = null; }
  tracks = [];

  if (appMode === "make") {
    if (emptyMsg) {
      emptyMsg.style.display = 'block';
      emptyMsg.innerText = "環境を読み込み中...";
    }
    
    // ★ 起動時に自動で6つのアセットを「OFF状態」で展開
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
        trackRevGain.connect(convolver);
        // ★初期状態はOFFとするためゲインを0に設定
        trackGain.gain.value = 0.0;
        trackRevGain.gain.value = 0.0;
      }

      return {
        id: asset.id, dbDocId: `local_${asset.id}`, name: asset.name, url: path, buffer: audioBuffer, source: null,
        gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: true, volume: 1.0,
        trackReverb: 0.0, delayTime: 0, duration: audioBuffer ? audioBuffer.duration : 5,
        isActive: false // ★ 新設フラグ
      };
    });

    Promise.all(loadInitialAssets).then(loadedTracks => {
      if (emptyMsg) emptyMsg.style.display = 'none';
      tracks = loadedTracks;
      renderUI();
    });

  } else {
    // ミキキモード等の処理はそのまま
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
            existingTrack.gainNode.gain.value = existingTrack.isActive ? existingTrack.volume : 0.0;
            existingTrack.reverbGainNode.gain.value = existingTrack.isActive ? existingTrack.trackReverb * 1.5 : 0.0;
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
          gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: data.isLooping !== undefined ? data.isLooping : true,
          volume: data.volume !== undefined ? data.volume : 1.0, trackReverb: data.trackReverb || 0.0,
          delayTime: data.delayTime !== undefined ? data.delayTime : 0, duration: audioBuffer ? audioBuffer.duration : 5,
          isActive: true
        };
        return newTrack;
      });
      tracks = await Promise.all(loadPromises);
      tracks.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      renderUI();
    });
  }
}

// --- ミキサーおよびタイムラインの描画 ---
function renderUI() {
  if (!trackListEl || !timelineTracksEl) return;
  trackListEl.innerHTML = '';
  timelineTracksEl.innerHTML = '';
  let maxTimelineWidth = 600;

  if (tracks.length === 0) {
    if (emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = "トラックがありません。"; }
    return;
  } else {
    if (emptyMsg) emptyMsg.style.display = 'none';
  }

  tracks.forEach((track, index) => {
    const mixerEl = document.createElement('div');
    mixerEl.className = 'track-item';
    
    // ★新設: ON/OFF 切り替えトグルボタン
    const activeBtnStyle = track.isActive ? 
      "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:var(--text-main); color:var(--bg-color); border:1px solid var(--text-main);" : 
      "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:transparent; color:var(--text-muted); border:1px solid var(--text-muted);";
    const onOffBtnHTML = `<button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} cursor:pointer;">${track.isActive ? 'ON' : 'OFF'}</button>`;
    
    const displayName = track.name;
    const nameTrackHTML = (appMode === "make") ? `<span class="track-name-label" style="font-size:0.8rem; font-weight:bold; color:${track.isActive ? 'var(--text-main)' : 'var(--text-muted)'};">${displayName}</span>` : `<input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}">`;

    // 複製や削除、個別ループボタンは廃止し、スライダーのみにシンプル化
    const reverbSliderHTML = (appMode === "make") ? `
      <div class="vol-slider-wrapper" style="width:75px; display:flex; align-items:center; gap:4px;">
        <span style="font-size:0.55rem; color:var(--text-muted);">Rev</span>
        <input type="range" class="track-reverb-slider" data-id="${track.dbDocId}" min="0" max="1" step="0.01" value="${track.trackReverb}">
      </div>` : '';

    const delaySliderHTML = `
      <div class="vol-slider-wrapper" style="width:85px; display:flex; align-items:center; gap:4px;">
        <span style="font-size:0.55rem; color:var(--text-muted);">Start</span>
        <input type="range" class="track-delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}">
      </div>`;

    mixerEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; width:150px;">
        ${onOffBtnHTML}
        ${nameTrackHTML}
      </div>
      <div class="track-controls" style="flex-wrap: wrap; justify-content: flex-end;">
        <div class="vol-slider-wrapper" style="width:75px; display:flex; align-items:center; gap:4px;">
          <span style="font-size:0.55rem; color:var(--text-muted);">Vol</span>
          <input type="range" class="vol-slider" data-id="${track.dbDocId}" min="0" max="1" step="0.01" value="${track.volume}">
        </div>
        ${reverbSliderHTML}
        ${delaySliderHTML}
      </div>`;
    trackListEl.appendChild(mixerEl);

    // タイムライン描画
    const rowEl = document.createElement('div');
    rowEl.className = 'timeline-row';
    rowEl.style.height = '48px';
    rowEl.style.marginBottom = '12px';

    const clipEl = document.createElement('div');
    clipEl.className = 'timeline-clip';
    clipEl.setAttribute('data-id', track.dbDocId);
    clipEl.innerText = displayName;
    clipEl.style.height = '44px';
    clipEl.style.fontSize = '0.7rem';
    clipEl.style.cursor = 'default';
    
    // ★OFFの時はクリップを半透明にして直感的にする
    clipEl.style.opacity = track.isActive ? '1.0' : '0.3';

    const leftPx = track.delayTime * PIXELS_PER_SEC;
    clipEl.style.left = `${leftPx}px`;

    let trackEndPx = 0;
    if (track.isLooping) {
      clipEl.style.width = `3600px`;
      clipEl.style.background = "repeating-linear-gradient(90deg, #f0f0f0, #f0f0f0 100px, #e8e8e8 101px)";
      trackEndPx = leftPx + 3600;
    } else {
      const w = Math.max(track.duration * PIXELS_PER_SEC, 20);
      clipEl.style.width = `${w}px`;
      trackEndPx = leftPx + w;
    }

    if (trackEndPx > maxTimelineWidth) maxTimelineWidth = trackEndPx + 300;
    rowEl.appendChild(clipEl);
    timelineTracksEl.appendChild(rowEl);
  });

  if (timelineContainerEl) timelineContainerEl.style.width = `${maxTimelineWidth}px`;
  attachMixerEvents();
}

function attachMixerEvents() {
  // ★ 新設: ON/OFF トグルボタンの処理
  document.querySelectorAll('.toggle-active-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if (t) {
        t.isActive = !t.isActive; // 状態を反転
        // リアルタイムにゲインに反映
        if (t.gainNode) t.gainNode.gain.value = t.isActive ? t.volume : 0.0;
        if (t.reverbGainNode) t.reverbGainNode.gain.value = t.isActive ? t.trackReverb * 1.5 : 0.0;
        renderUI(); // 画面を更新
      }
    });
  });

  document.querySelectorAll('.vol-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if (t) {
        t.volume = parseFloat(e.target.value);
        if (t.isActive && t.gainNode) t.gainNode.gain.value = t.volume;
      }
    });
  });

  document.querySelectorAll('.track-reverb-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if (t) {
        t.trackReverb = parseFloat(e.target.value);
        if (t.isActive && t.reverbGainNode) t.reverbGainNode.gain.value = t.trackReverb * 1.5;
      }
    });
  });

  document.querySelectorAll('.track-delay-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if (t) {
        t.delayTime = parseFloat(e.target.value);
        const clip = document.querySelector(`.timeline-clip[data-id="${dbDocId}"]`);
        if (clip) clip.style.left = `${t.delayTime * PIXELS_PER_SEC}px`;
      }
    });
    slider.addEventListener('change', async e => {
      const dbDocId = e.target.getAttribute('data-id');
      const t = tracks.find(x => x.dbDocId === dbDocId);
      if(!t) return;
      t.delayTime = parseFloat(e.target.value);
      if (db && !dbDocId.startsWith("local_")) {
        await db.collection("tracks").doc(dbDocId).update({ delayTime: t.delayTime });
      } else {
        renderUI();
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

// --- トランスポート制御（1ボタンで 再生 / 停止 をトグル化） ---
if (btnPlay) {
  btnPlay.addEventListener('click', async () => {
    if (isTransportBusy || tracks.length === 0) return;
    isTransportBusy = true;
    try {
      await initAudio();
      
      if (isMasterPlaying) {
        // 停止処理
        isMasterPlaying = false;
        btnPlay.innerText = "再生";
        btnPlay.classList.remove('recording');
        tracks.forEach(t => { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } });
        cancelAnimationFrame(animationFrameId);
        if (playheadEl) playheadEl.style.left = '0px';
      } else {
        // 再生処理
        isMasterPlaying = true;
        btnPlay.innerText = "停止";
        btnPlay.classList.add('recording'); // 押している間は色を変える（点滅アニメ）
        startTime = audioCtx.currentTime;
        tracks.forEach(t => startTrackSource(t, 0));
        updateProgress();
      }
    } finally {
      isTransportBusy = false;
    }
  });
}

function updateProgress() {
  animationFrameId = requestAnimationFrame(updateProgress);
  if (!isMasterPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  if (playheadEl) playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;
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
      const OfflineCtxConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtxConstructor) throw new Error("非対応");

      let renderDur = 30;
      const maxTrackDur = Math.max(...tracks.map(t => {
        const dur = (t.buffer ? t.buffer.duration : 5);
        return parseFloat(dur) + parseFloat(t.delayTime || 0);
      }));
      if (!isNaN(maxTrackDur) && maxTrackDur > 0) renderDur = maxTrackDur;
      const hasLooping = tracks.some(t => t.isLooping);
      if (hasLooping && renderDur < 30) renderDur = 30;
      renderDur = Math.min(renderDur, 180);

      const offlineCtx = new OfflineCtxConstructor(2, audioCtx.sampleRate * renderDur, audioCtx.sampleRate);
      const offlineMasterGain = offlineCtx.createGain();
      offlineMasterGain.connect(offlineCtx.destination);
      const offlineConvolver = offlineCtx.createConvolver();
      offlineConvolver.buffer = createReverbBuffer(offlineCtx, 3.5, 3.0);
      const offlineReverbMasterGain = offlineCtx.createGain();
      offlineConvolver.connect(offlineReverbMasterGain);
      offlineReverbMasterGain.connect(offlineMasterGain);
      
      const masterRevVal = parseFloat(reverbSlider.value);
      offlineReverbMasterGain.gain.value = 1.0 + (masterRevVal * 2.0);

      const offlineDryGain = offlineCtx.createGain();
      offlineDryGain.connect(offlineMasterGain);
      offlineDryGain.connect(offlineConvolver);

      tracks.forEach(t => {
        if (!t.buffer) return;
        const source = offlineCtx.createBufferSource();
        source.buffer = t.buffer;
        source.loop = t.isLooping;

        const gain = offlineCtx.createGain();
        const revGain = offlineCtx.createGain();

        // ★ OFFになっているトラックは合成時も無音(0)にする
        gain.gain.value = t.isActive ? t.volume : 0.0;
        revGain.gain.value = t.isActive ? t.trackReverb * 1.5 : 0.0;

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
    if (isMasterPlaying) btnPlay.click();
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
