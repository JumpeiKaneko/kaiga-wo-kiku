// ==============================================
// 「絵画を聴く」 音声ガイド＋ミキキ完全統合版 app.js
// ==============================================

const firebaseConfig = {
  apiKey: "AIzaSyCwbqi08ShVjJ90Mku2NsXJK0E03p4CsT4",
  authDomain: "kaiga-wo-kiku.firebaseapp.com",
  projectId: "kaiga-wo-kiku",
  storageBucket: "kaiga-wo-kiku.firebasestorage.app"
};

try { firebase.initializeApp(firebaseConfig); } catch (e) { console.error("Firebase初期化失敗", e); }
const db = firebase.apps.length ? firebase.firestore() : null;
const storage = firebase.apps.length ? firebase.storage() : null;

let appMode = ""; let exhibitMode = ""; let currentUser = ""; let audioCtx;
let masterGain, convolver, dryGain, wetGain; let mediaRecorder, recordedChunks = []; let isRecording = false;

// ワークショップ用変数
let tracks = []; let isMasterPlaying = false; let isMasterLooping = true; let startTime = 0; let animationFrameId; let isTransportBusy = false;
const PIXELS_PER_SEC = 30;

// ★修正：立体の色判定用のターゲットカラー4色を設定
const AR_TARGET_COLORS = [
  { r: 52,  g: 163, b: 168 }, // ターコイズ
  { r: 84,  g: 76,  b: 70  }, // 暗い茶
  { r: 38,  g: 127, b: 124 }, // 深い緑青
  { r: 63,  g: 148, b: 161 }  // 凹凸の青緑
];

// ★修正：展示モード用変数を6つ（平面5つ、立体1つ）に再定義
const EXHIBIT_WORKS = [
  { id: "work_1", type: "ar", fileName: "1.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "work_2", type: "ar", fileName: "2.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "work_3", type: "ar", fileName: "3.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "work_4", type: "ar", fileName: "4.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "work_5", type: "ar", fileName: "5.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "work_6", type: "color", fileName: "6.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 }
];

let isListenModePlaying = false; let isMikikiScanning = false;
let mikikiFadeInterval = null; let arScanAnimationFrame = null;

let guideAiSource = null; let exhibitGuideTracks = [];

// みんなの音ランダム再生用変数
let everyoneTracks = []; let isListeningEveryone = false; let currentEveryoneSource = null; let everyonePlayTimeout = null;

window.addEventListener('DOMContentLoaded', () => {
  const appExhibit = document.getElementById('app-exhibit');
  const userModal = document.getElementById('user-modal');
  const modalStepLogin = document.getElementById('modal-step-login');
  const modalStepSelect = document.getElementById('modal-step-select');
  const listenApp = document.getElementById('listen-app');
  const mainApp = document.getElementById('main-app');

  // ★追加：MindAR（平面の画像認識）のイベントリスナー登録
  const sceneEl = document.querySelector('a-scene');
  if (sceneEl) {
    for (let i = 0; i < 5; i++) {
      const target = document.querySelector('#target-' + i);
      if (target) {
        // 画像が見つかったら音量を1にする
        target.addEventListener("targetFound", () => {
          EXHIBIT_WORKS[i].targetVolume = 1.0;
        });
        // 画像が外れたら音量を0にする
        target.addEventListener("targetLost", () => {
          EXHIBIT_WORKS[i].targetVolume = 0.0;
        });
      }
    }
  }

  function resetAudioAndUI() {
    isMasterPlaying = false;
    const btnPlayStop = document.getElementById('btn-master-play-stop');
    if (btnPlayStop) { btnPlayStop.innerText = "自分の音を再生"; btnPlayStop.classList.remove('recording'); }
    tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(ex){} t.source = null; } });
    cancelAnimationFrame(animationFrameId);
    if (document.getElementById('playhead')) document.getElementById('playhead').style.left = '0px';

    if (isListenModePlaying) {
      if (exhibitMode === "camera") stopMikikiMode();
      if (exhibitMode === "guide") stopGuideExhibitMode();
      isListenModePlaying = false;
      const btnPlayUnity = document.getElementById('btn-play-unity-audio');
      if (btnPlayUnity) btnPlayUnity.classList.remove('recording');
    }
    
    if (guideAiSource) { try{guideAiSource.stop()}catch(e){} guideAiSource = null; }
    const btnGuidePlay = document.getElementById('btn-guide-base-play');
    if (btnGuidePlay) { btnGuidePlay.innerText = "AI解説をONにする"; btnGuidePlay.classList.remove('recording'); }

    if (isListeningEveryone) { document.getElementById('btn-listen-everyone').click(); }
  }

  // ARカメラモードの起動
  const btnCamera = document.getElementById('btn-choice-exhibit-camera');
  if (btnCamera) {
    btnCamera.addEventListener('click', (e) => {
      e.preventDefault(); exhibitMode = "camera"; appMode = "mikiki";
      appExhibit.style.display = 'none'; listenApp.style.display = 'block';
      document.getElementById('listen-section-title').innerText = "ミキキの交差点";
      document.getElementById('btn-play-unity-audio').innerText = "かざして体験を開始";
      document.getElementById('guide-info-area').style.display = 'none';
    });
  }

  const btnGuide = document.getElementById('btn-choice-exhibit-guide');
  if (btnGuide) {
    btnGuide.addEventListener('click', (e) => {
      e.preventDefault(); exhibitMode = "guide"; appMode = "guide";
      appExhibit.style.display = 'none'; listenApp.style.display = 'block';
      document.getElementById('listen-section-title').innerText = "非言語音声ガイド";
      document.getElementById('btn-play-unity-audio').innerText = "音声ガイドを聴く";
      document.getElementById('guide-info-area').style.display = 'block';
    });
  }

  // ワークショップへの遷移
  const btnToWs = document.getElementById('btn-to-workshop');
  if (btnToWs) { btnToWs.addEventListener('click', () => { appExhibit.style.display = 'none'; userModal.style.display = 'flex'; modalStepLogin.style.display = 'block'; }); }
  
  const btnWsLoginBack = document.getElementById('btn-ws-login-back');
  if (btnWsLoginBack) { btnWsLoginBack.addEventListener('click', () => { userModal.style.display = 'none'; modalStepLogin.style.display = 'none'; appExhibit.style.display = 'block'; }); }
  
  const btnWsLogin = document.getElementById('btn-ws-login');
  if (btnWsLogin) {
    btnWsLogin.addEventListener('click', async (e) => {
      e.preventDefault(); const username = document.getElementById('input-username').value.trim();
      if (!username) { alert("名前を入力してください。"); return; }
      currentUser = username; modalStepLogin.style.display = 'none'; modalStepSelect.style.display = 'block';
      await initAudio();
    });
  }

  const btnWsSelectBack = document.getElementById('btn-ws-select-back');
  if (btnWsSelectBack) { btnWsSelectBack.addEventListener('click', () => { modalStepSelect.style.display = 'none'; modalStepLogin.style.display = 'block'; }); }

  const btnWsMikiki = document.getElementById('btn-choice-mikiki-ws');
  if (btnWsMikiki) {
    btnWsMikiki.addEventListener('click', (e) => {
      e.preventDefault(); appMode = "mikiki"; userModal.style.display = 'none'; mainApp.style.display = 'block';
      document.getElementById('current-user-display').innerText = currentUser; document.getElementById('ws-badge').innerText = "ミキキの交差点";
      document.getElementById('guide-base-sound-section').style.display = 'none'; startSyncTracks();
    });
  }

  const btnWsGuide = document.getElementById('btn-choice-guide-ws');
  if (btnWsGuide) {
    btnWsGuide.addEventListener('click', (e) => {
      e.preventDefault(); appMode = "guide"; userModal.style.display = 'none'; mainApp.style.display = 'block';
      document.getElementById('current-user-display').innerText = currentUser; document.getElementById('ws-badge').innerText = "非言語音声ガイド";
      document.getElementById('guide-base-sound-section').style.display = 'block'; startSyncTracks();
    });
  }

  document.querySelectorAll('.btn-global-back').forEach(btn => {
    btn.addEventListener('click', () => { resetAudioAndUI(); mainApp.style.display = 'none'; listenApp.style.display = 'none'; userModal.style.display = 'none'; modalStepSelect.style.display = 'none'; appExhibit.style.display = 'block'; });
  });

  document.querySelectorAll('.logo-home-trigger').forEach(logo => {
    logo.addEventListener('click', () => { resetAudioAndUI(); mainApp.style.display = 'none'; listenApp.style.display = 'none'; userModal.style.display = 'none'; modalStepSelect.style.display = 'none'; modalStepLogin.style.display = 'none'; appExhibit.style.display = 'block'; });
  });

  // 音声ガイドのAI音声ON/OFF
  const btnGuidePlay = document.getElementById('btn-guide-base-play');
  if(btnGuidePlay) {
    btnGuidePlay.addEventListener('click', async (e) => {
      await initAudio();
      if (guideAiSource) {
        guideAiSource.stop(); guideAiSource = null; e.target.innerText = "AI解説をONにする"; e.target.classList.remove('recording');
      } else {
        try {
          const res = await fetch("assets/sounds/ai_guide.mp3"); const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
          guideAiSource = audioCtx.createBufferSource(); guideAiSource.buffer = buf; guideAiSource.loop = true;
          guideAiSource.connect(masterGain); guideAiSource.start(0);
          e.target.innerText = "AI解説をOFFにする"; e.target.classList.add('recording');
        } catch(err) { alert("AI解説用ファイルが見つかりません。"); }
      }
    });
  }

  // 展示モードの再生ボタン制御
  const btnPlayUnity = document.getElementById('btn-play-unity-audio');
  if (btnPlayUnity) {
    btnPlayUnity.addEventListener('click', async (e) => {
      if (!isListenModePlaying) {
        if (exhibitMode === "camera") { await startMikikiMode(); }
        else if (exhibitMode === "guide") { await startGuideExhibitMode(); }
        isListenModePlaying = true;
        e.target.innerText = "体験を停止する"; e.target.classList.add('recording');
      } else {
        if (exhibitMode === "camera") { stopMikikiMode(); }
        else if (exhibitMode === "guide") { stopGuideExhibitMode(); }
        isListenModePlaying = false;
        if (exhibitMode === "camera") e.target.innerText = "かざして体験を開始";
        if (exhibitMode === "guide") e.target.innerText = "音声ガイドを聴く";
        e.target.classList.remove('recording');
      }
    });
  }

  // ワークショップ録音ボタン
  const btnRecord = document.getElementById('btn-record');
  if (btnRecord) {
    btnRecord.addEventListener('click', async (e) => {
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
            const localId = `local_${timestamp}`;
            const trackName = `投稿音 ${String(timestamp).substring(9, 13)}`;

            if (storage && db) {
              try {
                const snapshot = await storage.ref().child(storagePath).put(blob);
                const downloadUrl = await snapshot.ref.getDownloadURL();
                
                const targetCollection = (appMode === "mikiki") ? "mikiki_tracks" : "guide_tracks";
                
                const newDoc = await db.collection(targetCollection).add({
                  user: currentUser, name: trackName, url: downloadUrl,
                  storagePath: storagePath, isLooping: false, volume: 1.0, delayTime: 0, isActive: false,
                  createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                simulateLocalTrack(trackName, downloadUrl, newDoc.id, null, false);
              } catch (err) { alert("録音の保存に失敗しました。"); }
            } else {
              simulateLocalTrack(trackName, URL.createObjectURL(blob), localId, null, false);
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
  }

  // 自分の音を再生ボタン
  const btnMasterPlay = document.getElementById('btn-master-play-stop');
  if (btnMasterPlay) {
    btnMasterPlay.addEventListener('click', async (e) => {
      if (isTransportBusy || tracks.length === 0) return; isTransportBusy = true;
      try {
        if (!isMasterPlaying) {
          await initAudio(); isMasterPlaying = true;
          e.target.innerText = "自分の音を停止"; e.target.classList.add('recording');
          startTime = audioCtx.currentTime; tracks.forEach(t => startTrackSource(t, 0)); updateProgress();
        } else {
          isMasterPlaying = false; e.target.innerText = "自分の音を再生"; e.target.classList.remove('recording');
          tracks.forEach(t => { if (t.source) { try{ t.source.stop(); } catch(err){} t.source = null; } });
          cancelAnimationFrame(animationFrameId); if (document.getElementById('playhead')) document.getElementById('playhead').style.left = '0px';
        }
      } finally { isTransportBusy = false; }
    });
  }

  // みんなの音を聴きながら鑑賞するボタン
  const btnListenEveryone = document.getElementById('btn-listen-everyone');
  if (btnListenEveryone) {
    btnListenEveryone.addEventListener('click', async (e) => {
      await initAudio();
      if (!isListeningEveryone) {
        isListeningEveryone = true; e.target.innerText = "鑑賞を停止する"; e.target.classList.add('recording');
        document.getElementById('current-playing-info').innerText = "みんなの音を読み込み中...";
        startListenEveryone();
      } else {
        isListeningEveryone = false; e.target.innerText = "みんなの音を聴きながら鑑賞する"; e.target.classList.remove('recording');
        document.getElementById('current-playing-info').innerText = ""; stopListenEveryone();
      }
    });
  }

  const reverbSlider = document.getElementById('master-reverb');
  if(reverbSlider) { reverbSlider.addEventListener('input', updateReverb); }

}); 

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);

// ======= 展示モード：非言語音声ガイド =======
async function startGuideExhibitMode() {
  await initAudio();
  try {
    const res = await fetch("assets/sounds/ai_guide.mp3");
    if(res.ok) {
      const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
      guideAiSource = audioCtx.createBufferSource(); guideAiSource.buffer = buf; guideAiSource.loop = true;
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
          const src = audioCtx.createBufferSource(); src.buffer = b; src.loop = true;
          const g = audioCtx.createGain(); g.gain.value = 0.3; 
          src.connect(g); g.connect(masterGain); src.start(audioCtx.currentTime + Math.random() * 5); 
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

// ======= 展示モード：ミキキの交差点（ARカメラ判定 / 平面・立体ハイブリッド） =======
async function initMikikiWorks() {
  await initAudio();
  const loadPromises = EXHIBIT_WORKS.map(async (work) => {
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
  EXHIBIT_WORKS.forEach(work => {
    if (work.source) { try{work.source.stop();}catch(e){} }
    if (work.buffer && work.gainNode) {
      work.source = audioCtx.createBufferSource(); work.source.buffer = work.buffer;
      work.source.loop = true; work.source.connect(work.gainNode); work.source.start(0);
    }
    work.targetVolume = 0; work.currentVolume = 0;
  });

  isMikikiScanning = true;
  
  // ★追加：MindAR（画像認識）のカメラシステムを起動
  document.getElementById('ar-container').style.display = 'block';
  const sceneEl = document.querySelector('a-scene');
  if (sceneEl && sceneEl.systems["mindar-image-system"]) {
    sceneEl.systems["mindar-image-system"].start();
  }
  
  // ★追加：立体用の色判定ループを開始
  scanColorsLoop();

  if (mikikiFadeInterval) clearInterval(mikikiFadeInterval);
  mikikiFadeInterval = setInterval(() => {
    EXHIBIT_WORKS.forEach(work => {
      if (Math.abs(work.currentVolume - work.targetVolume) > 0.01) {
        work.currentVolume += (work.targetVolume - work.currentVolume) * 0.15;
        if(work.gainNode) work.gainNode.gain.value = work.currentVolume;
      } else if (work.currentVolume !== work.targetVolume) {
        work.currentVolume = work.targetVolume;
        if(work.gainNode) work.gainNode.gain.value = work.currentVolume;
      }
    });
  }, 33);
}

// ★修正：立体の色判定ループ（MindARのビデオをフックして解析）
function scanColorsLoop() {
  if (!isMikikiScanning) return;
  
  // MindARが生成した背景ビデオを取得
  const videoEl = document.querySelector('video'); 
  if (videoEl && videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
    const canvasEl = document.getElementById('camera-canvas');
    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    const data = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    
    let matchCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      if ((r > 240 && g > 240 && b > 240) || (r < 20 && g < 20 && b < 20)) continue;
      
      // 4つの特徴的な色のどれかにマッチするか判定
      for (let j = 0; j < AR_TARGET_COLORS.length; j++) {
        const tc = AR_TARGET_COLORS[j];
        if (Math.sqrt(Math.pow(r - tc.r, 2) + Math.pow(g - tc.g, 2) + Math.pow(b - tc.b, 2)) < 55) {
          matchCount++;
          break; // いずれかの色にマッチすればカウントして次のピクセルへ
        }
      }
    }
    // インデックス5 (work_6) が立体の色判定
    EXHIBIT_WORKS[1].targetVolume = matchCount > 20 ? 1.0 : 0.0; 
  }
  
  arScanAnimationFrame = requestAnimationFrame(scanColorsLoop);
}

function stopMikikiMode() {
  isMikikiScanning = false;
  if (arScanAnimationFrame) cancelAnimationFrame(arScanAnimationFrame);
  
  // ★追加：MindAR（画像認識）システムを停止
  const sceneEl = document.querySelector('a-scene');
  if (sceneEl && sceneEl.systems["mindar-image-system"]) {
    sceneEl.systems["mindar-image-system"].stop();
  }
  document.getElementById('ar-container').style.display = 'none';
  
  if (mikikiFadeInterval) clearInterval(mikikiFadeInterval);
  EXHIBIT_WORKS.forEach(work => {
    work.targetVolume = 0; work.currentVolume = 0;
    if (work.source) { try{work.source.stop();}catch(e){} work.source = null; }
    if (work.gainNode) { work.gainNode.gain.value = 0; }
  });
}

// ======= 汎用オーディオ機能 =======
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

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

async function simulateLocalTrack(name, url, localId, assetId, isActiveState = false) {
  const emptyMsg = document.getElementById('empty-msg'); if (emptyMsg) emptyMsg.style.display = 'none';
  let audioBuffer = null;
  try { const response = await fetch(url); if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer()); } catch (e) {}
  const trackGain = audioCtx.createGain(); const trackRevGain = audioCtx.createGain();
  trackGain.connect(dryGain); trackRevGain.connect(wetGain); trackGain.gain.value = isActiveState ? 1.0 : 0.0; trackRevGain.gain.value = 0.0;
  
  const localTrack = {
    id: assetId || localId, dbDocId: localId, name: name, url: url, buffer: audioBuffer, source: null,
    gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: false, volume: 1.0, isActive: isActiveState, 
    trackReverb: 0.0, delayTime: 0, duration: audioBuffer ? audioBuffer.duration : 5, isPreset: false
  };
  tracks.unshift(localTrack); 
  renderUI();
  if (isMasterPlaying && isActiveState) startTrackSource(localTrack, audioCtx.currentTime - startTime);
}

function startSyncTracks() {
  tracks = [];
  const emptyMsg = document.getElementById('empty-msg');
  if (emptyMsg) { 
    emptyMsg.style.display = 'block'; 
    emptyMsg.innerText = "まだ音がありません。録音を追加してください。"; 
  }
  renderUI();
}

function renderUI() {
  const trackListEl = document.getElementById('track-list'); const timelineTracksEl = document.getElementById('timeline-tracks');
  if (trackListEl) trackListEl.innerHTML = ''; if (timelineTracksEl) timelineTracksEl.innerHTML = '';
  
  const emptyMsg = document.getElementById('empty-msg');
  if (tracks.length === 0) {
    if (emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = "まだ音がありません。録音を追加してください。"; }
  } else {
    if (emptyMsg) emptyMsg.style.display = 'none';
  }

  tracks.forEach((track) => {
    const mixerEl = document.createElement('div'); mixerEl.className = 'track-item';
    const activeBtnStyle = track.isActive ? "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:var(--text-main); color:var(--bg-color); border:1px solid var(--text-main);" : "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:transparent; color:var(--text-muted); border:1px solid var(--text-muted);";
    const onOffBtnHTML = `<button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} cursor:pointer; flex-shrink:0;">${track.isActive ? 'ON' : 'OFF'}</button>`;
    
    const subtitleHTML = track.category ? `<div style="font-size:0.55rem; color:var(--text-muted); font-weight:normal;">${track.category}</div>` : '';
    const nameTrackHTML = track.isPreset 
      ? `<div style="display:flex; flex-direction:column;"><span class="track-name-label" style="font-weight:bold; color:var(--text-main);">${track.name}</span>${subtitleHTML}</div>` 
      : `<input type="text" class="track-name-input" data-id="${track.dbDocId}" value="${track.name}" style="color:var(--text-main);">`;
    
    const cloneBtnHTML = `<button class="action-btn clone-btn" data-id="${track.dbDocId}">複製</button>`;
    const deleteBtnHTML = !track.isPreset ? `<button class="action-btn delete-btn" data-id="${track.dbDocId}">削除</button>` : '';
    const delaySliderHTML = `<div class="vol-slider-wrapper" style="width:100px; display:flex; flex-direction:column; align-items:flex-start; gap:2px;"><span style="font-size:0.55rem; color:var(--text-muted);">Start</span><input type="range" class="track-delay-slider" data-id="${track.dbDocId}" min="0" max="20" step="0.1" value="${track.delayTime}"></div>`;

    mixerEl.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;"><div style="display:flex; align-items:center; gap:8px;">${onOffBtnHTML}${nameTrackHTML}</div><div style="display:flex; align-items:center; gap:12px;"><button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button><div style="display:flex; align-items:center; gap:8px;">${cloneBtnHTML}${deleteBtnHTML}</div></div></div><div style="display:flex; justify-content:flex-end; align-items:center; gap:16px; width:100%;">${delaySliderHTML}</div>`;
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
  const col = (appMode === "mikiki") ? "mikiki_tracks" : "guide_tracks";
  
  document.querySelectorAll('.track-name-input').forEach(input => { 
    input.addEventListener('change', async e => { 
      const id = e.target.getAttribute('data-id'); 
      const t = tracks.find(x => x.dbDocId === id); 
      if (t) {
        t.name = e.target.value.trim();
        if (db && !id.startsWith("local_")) db.collection(col).doc(id).update({ name: t.name }); 
      }
    }); 
  });
  
  document.querySelectorAll('.toggle-active-btn').forEach(btn => { 
    btn.addEventListener('click', async e => { 
      const id = e.target.getAttribute('data-id'); 
      const t = tracks.find(x => x.dbDocId === id); 
      if (t) { 
        t.isActive = !t.isActive; 
        if (t.gainNode) t.gainNode.gain.value = t.isActive ? t.volume : 0.0; 
        if (db && !id.startsWith("local_")) db.collection(col).doc(id).update({ isActive: t.isActive }); 
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
      if (t.source) t.source.loop = t.isLooping; 
      if (db && !id.startsWith("local_")) db.collection(col).doc(id).update({ isLooping: t.isLooping }); 
      renderUI(); 
    }); 
  });
  
  document.querySelectorAll('.track-delay-slider').forEach(slider => { 
    slider.addEventListener('input', e => { 
      const id = e.target.getAttribute('data-id'); 
      const t = tracks.find(x => x.dbDocId === id); 
      if (t) { 
        t.delayTime = parseFloat(e.target.value); 
        const clip = document.querySelector(`.timeline-clip[data-id="${id}"]`); 
        if (clip) clip.style.left = `${t.delayTime * PIXELS_PER_SEC}px`; 
      } 
    }); 
    slider.addEventListener('change', async e => { 
      const id = e.target.getAttribute('data-id'); 
      const t = tracks.find(x => x.dbDocId === id); 
      if(!t) return; 
      t.delayTime = parseFloat(e.target.value); 
      if (db && !id.startsWith("local_")) db.collection(col).doc(id).update({ delayTime: t.delayTime }); 
      renderUI(); 
    }); 
  });
  
  document.querySelectorAll('.clone-btn').forEach(btn => { 
    btn.addEventListener('click', async e => { 
      const id = e.target.getAttribute('data-id'); 
      const t = tracks.find(x => x.dbDocId === id); 
      if(!t) return; 
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`; 
      const newName = t.name + " (複製)";
      if (db && !id.startsWith("local_")) { 
        const newDoc = await db.collection(col).add({ 
          user: currentUser, name: newName, url: t.url, storagePath: t.storagePath || "", 
          isLooping: t.isLooping, isActive: false, volume: t.volume, delayTime: t.delayTime,
          createdAt: firebase.firestore.FieldValue.serverTimestamp() 
        }); 
        simulateLocalTrack(newName, t.url, newDoc.id, t.id, false); 
      } else { 
        simulateLocalTrack(newName, t.url, localId, t.id, false); 
      } 
    }); 
  });

  document.querySelectorAll('.delete-btn').forEach(btn => { 
    btn.addEventListener('click', async e => { 
      if(confirm("削除しますか？")) { 
        const id = e.target.getAttribute('data-id'); 
        tracks = tracks.filter(x => x.dbDocId !== id); 
        if (db && !id.startsWith("local_")) db.collection(col).doc(id).delete(); 
        renderUI(); 
      } 
    }); 
  });
}

function startTrackSource(track, elapsed = 0) {
  if (!track.buffer || !track.gainNode) return; if (!track.isActive) return;
  if (track.source) { try { track.source.stop(); } catch(e){} }
  track.source = audioCtx.createBufferSource(); track.source.buffer = track.buffer; track.source.loop = track.isLooping; track.source.connect(track.gainNode);
  const targetStartTime = startTime + track.delayTime; const now = audioCtx.currentTime;
  if (isMasterPlaying) { if (now < targetStartTime) { track.source.start(targetStartTime); } else { const offset = now - targetStartTime; if (track.isLooping) { track.source.start(0, offset % track.buffer.duration); } else if (offset < track.buffer.duration) { track.source.start(0, offset); } } }
}

function updateProgress() {
  animationFrameId = requestAnimationFrame(updateProgress); if (!isMasterPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  const playhead = document.getElementById('playhead'); if (playhead) playhead.style.left = `${elapsed * PIXELS_PER_SEC}px`;
  if (elapsed >= 20) { if (isMasterLooping) { startTime += 20; tracks.forEach(t => { if (t.isActive && !t.isLooping) { if (t.source) { try{ t.source.stop(); } catch(e){} t.source = null; } startTrackSource(t, 0); } }); } else { document.getElementById('btn-master-play-stop').click(); } }
}

// ======= みんなの音を聴きながら鑑賞するシステム =======
async function startListenEveryone() {
  const collectionName = (appMode === "mikiki") ? "mikiki_tracks" : "guide_tracks";
  if (db) {
    try {
      const snap = await db.collection(collectionName).get();
      everyoneTracks = [];
      snap.forEach(doc => { const data = doc.data(); if(data.url) everyoneTracks.push(data); });
      if (everyoneTracks.length === 0) {
        document.getElementById('current-playing-info').innerText = "まだ投稿された音がありません。";
        isListeningEveryone = false; const btn = document.getElementById('btn-listen-everyone');
        if (btn) { btn.innerText = "みんなの音を聴きながら鑑賞する"; btn.classList.remove('recording'); }
        return;
      }
      shuffleArray(everyoneTracks); playNextEveryoneTrack(0);
    } catch(err) { document.getElementById('current-playing-info').innerText = "読み込みに失敗しました。"; }
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
}

async function playNextEveryoneTrack(index) {
  if (!isListeningEveryone) return;
  if (index >= everyoneTracks.length) { shuffleArray(everyoneTracks); index = 0; }
  
  const trackData = everyoneTracks[index];
  const infoEl = document.getElementById('current-playing-info');
  if (infoEl) infoEl.innerText = `♪ 再生中: ${trackData.name || "名無しの音"} (by ${trackData.user || "誰か"})`;
  
  try {
    const res = await fetch(formalizeUrl(trackData.url));
    if (res.ok) {
      const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
      currentEveryoneSource = audioCtx.createBufferSource(); currentEveryoneSource.buffer = buf;
      const gain = audioCtx.createGain(); gain.gain.value = 1.0;
      const revGain = audioCtx.createGain(); revGain.gain.value = 0.5;
      currentEveryoneSource.connect(gain); currentEveryoneSource.connect(revGain); gain.connect(dryGain); revGain.connect(wetGain);
      
      currentEveryoneSource.onended = () => {
        if (!isListeningEveryone) return;
        if (infoEl) infoEl.innerText = "（余韻...）";
        everyonePlayTimeout = setTimeout(() => { playNextEveryoneTrack(index + 1); }, Math.random() * 2000 + 1000);
      };
      currentEveryoneSource.start(0);
    } else { playNextEveryoneTrack(index + 1); }
  } catch(e) { playNextEveryoneTrack(index + 1); }
}

function stopListenEveryone() {
  if (currentEveryoneSource) { try { currentEveryoneSource.stop(); } catch(e){} currentEveryoneSource = null; }
  if (everyonePlayTimeout) { clearTimeout(everyonePlayTimeout); everyonePlayTimeout = null; }
}
