// ==============================================
// 「絵画を聴く」 ミキサー詳細パネル対応
// ★AR画像認識（かざした時だけ鳴る）確実動作版
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

let appMode = ""; let currentUser = ""; let audioCtx;
let masterGain, convolver, dryGain, wetGain;

let tracks = []; let isMasterPlaying = false; let startTime = 0; let animationFrameId; let isTransportBusy = false;
const PIXELS_PER_SEC = 30;

let outputAudioBuffer = null;
let outputAudioSource = null;
let isOutputLooping = true;

// 録音機能用の変数
let mediaRecorder, recordedChunks = [];
let isRecording = false;

// AR用の1〜5.mp3（画像マーカー target-0 〜 target-4 と連動）
const AR_WORKS = [
  { id: "ar_1", type: "ar", fileName: "1.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "ar_2", type: "ar", fileName: "2.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "ar_3", type: "ar", fileName: "3.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "ar_4", type: "ar", fileName: "4.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 },
  { id: "ar_5", type: "ar", fileName: "5.mp3", buffer: null, gainNode: null, source: null, currentVolume: 0, targetVolume: 0 }
];

let isARScanning = false; let arFadeInterval = null;

let everyoneTracks = []; let isListeningEveryone = false; let currentEveryoneSource = null; let everyonePlayTimeout = null;

// ★修正箇所: フィールド録音の folder を "assets/sounds/" に統一しました
const ASSETS = [
  { id: "mori_no_oti", name: "森の音", folder: "assets/sounds/", fileName: "mori_no_oti.mp3", category: "フィールド録音" },
  { id: "yoru_no_mori", name: "夜の森", folder: "assets/sounds/", fileName: "yoru_no_mori.mp3", category: "フィールド録音" },
  { id: "kaze_no_oti", name: "風の音", folder: "assets/sounds/", fileName: "kaze_no_oti.mp3", category: "フィールド録音" },
  { id: "mizu_no_oti", name: "水の音", folder: "assets/sounds/", fileName: "mizu_no_oti.mp3", category: "フィールド録音" },
  { id: "ai_yuragi", name: "ゆらぎ", folder: "assets/sounds/", fileName: "yuragi.mp3", category: "AI生成音" },
  { id: "ai_seseragi", name: "せせらぎ", folder: "assets/sounds/", fileName: "seseragi.mp3", category: "AI生成音" },
  { id: "ai_zawameki", name: "ざわめき", folder: "assets/sounds/", fileName: "zawameki.mp3", category: "AI生成音" },
  { id: "ai_saezuri", name: "さえずり", folder: "assets/sounds/", fileName: "saezuri.mp3", category: "AI生成音" },
  { id: "ai_nakigoe", name: "なきごえ", folder: "assets/sounds/", fileName: "nakigoe.mp3", category: "AI生成音" },
  { id: "ai_haoto", name: "はおと", folder: "assets/sounds/", fileName: "haoto.mp3", category: "AI生成音" }
];

function bufferToWavBlob(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  let pos = 0;
  function setUint16(d) { view.setUint16(pos, d, true); pos += 2; }
  function setUint32(d) { view.setUint32(pos, d, true); pos += 4; }
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
  setUint32(length - pos - 4);
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numOfChan; c++) {
      let sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      pos += 2;
    }
  }
  return new Blob([bufferArr], { type: 'audio/wav' });
}

window.addEventListener('DOMContentLoaded', () => {
  const appExhibit = document.getElementById('app-exhibit');
  const userModal = document.getElementById('user-modal');
  const modalStepLogin = document.getElementById('modal-step-login');
  const modalStepSelect = document.getElementById('modal-step-select');
  const mainApp = document.getElementById('main-app');

  const arExitBtn = document.getElementById('ar-exit-btn');
  if (arExitBtn) {
    arExitBtn.addEventListener('click', () => {
      stopARMode(); arExitBtn.style.display = 'none'; appExhibit.style.display = 'block';
    });
  }

  function resetAudioAndUI() {
    isMasterPlaying = false;
    const btnPlayStop = document.getElementById('btn-master-play-stop');
    if (btnPlayStop) { btnPlayStop.innerText = "全体を再生"; btnPlayStop.classList.remove('recording'); }
    tracks.forEach(t => {
      if (t.source) { try{t.source.stop()}catch(ex){} t.source = null; }
      if (t.previewSource) { try{t.previewSource.stop()}catch(ex){} t.previewSource = null; }
    });
    document.querySelectorAll('.preview-btn').forEach(b => { b.innerText = '再生'; b.classList.remove('recording'); });
    cancelAnimationFrame(animationFrameId);
    if (document.getElementById('playhead')) document.getElementById('playhead').style.left = '0px';
    if (isARScanning) stopARMode();
    if (isListeningEveryone) { document.getElementById('btn-listen-everyone').click(); }
    if (outputAudioSource) { try{outputAudioSource.stop()}catch(ex){} outputAudioSource = null; }
  }

  const btnCamera = document.getElementById('btn-choice-exhibit-ar');
  if (btnCamera) {
    btnCamera.addEventListener('click', async (e) => {
      e.preventDefault(); appExhibit.style.display = 'none';
      await startARMode(); if (arExitBtn) arExitBtn.style.display = 'block';
    });
  }

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
    btnWsMikiki.addEventListener('click', async (e) => {
      e.preventDefault(); appMode = "mikiki"; userModal.style.display = 'none'; mainApp.style.display = 'block';
      document.getElementById('current-user-display').innerText = currentUser; document.getElementById('ws-badge').innerText = "ミキキの交差点";
      await startSyncTracks();
    });
  }
  const btnWsGuide = document.getElementById('btn-choice-guide-ws');
  if (btnWsGuide) {
    btnWsGuide.addEventListener('click', async (e) => {
      e.preventDefault(); appMode = "guide"; userModal.style.display = 'none'; mainApp.style.display = 'block';
      document.getElementById('current-user-display').innerText = currentUser; document.getElementById('ws-badge').innerText = "非言語音声ガイド";
      await startSyncTracks();
    });
  }

  document.querySelectorAll('.btn-global-back, .logo-home-trigger').forEach(btn => {
    btn.addEventListener('click', () => { resetAudioAndUI(); mainApp.style.display = 'none'; userModal.style.display = 'none'; modalStepSelect.style.display = 'none'; modalStepLogin.style.display = 'none'; appExhibit.style.display = 'block'; });
  });

  const btnMasterPlay = document.getElementById('btn-master-play-stop');
  if (btnMasterPlay) {
    btnMasterPlay.addEventListener('click', async (e) => {
      if (isTransportBusy || tracks.length === 0) return; isTransportBusy = true;
      try {
        if (!isMasterPlaying) {
          await initAudio(); isMasterPlaying = true;
          e.target.innerText = "全体を停止"; e.target.classList.add('recording');
          startTime = audioCtx.currentTime; tracks.forEach(t => startTrackSource(t, 0)); updateProgress();
        } else {
          isMasterPlaying = false; e.target.innerText = "全体を再生"; e.target.classList.remove('recording');
          tracks.forEach(t => {
            if (t.source) { try{ t.source.stop(); } catch(err){} t.source = null; }
            if (t.previewSource) { try{ t.previewSource.stop(); } catch(err){} t.previewSource = null; }
          });
          document.querySelectorAll('.preview-btn').forEach(b => { b.innerText = '再生'; b.classList.remove('recording'); });
          cancelAnimationFrame(animationFrameId); if (document.getElementById('playhead')) document.getElementById('playhead').style.left = '0px';
        }
      } finally { isTransportBusy = false; }
    });
  }

  // 録音機能イベント
  const btnRecord = document.getElementById('btn-record');
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
            btnRecord.innerText = "処理中...";
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const timestamp = Date.now();
            const storagePath = `audios/track_${timestamp}.webm`;

            if (storage && db) {
              try {
                const snapshot = await storage.ref().child(storagePath).put(blob);
                const downloadUrl = await snapshot.ref.getDownloadURL();
                simulateLocalTrack(`録音 ${String(timestamp).substring(9, 13)}`, downloadUrl, `local_${timestamp}`);
              } catch (e) {
                simulateLocalTrack(`録音 ${String(timestamp).substring(9, 13)}`, URL.createObjectURL(blob), `local_${timestamp}`);
              }
            } else {
              simulateLocalTrack(`録音 ${String(timestamp).substring(9, 13)}`, URL.createObjectURL(blob), `local_${timestamp}`);
            }
            btnRecord.innerText = "録音を開始";
          };
          mediaRecorder.start();
          isRecording = true;
          btnRecord.innerText = "録音を停止";
          btnRecord.classList.add('recording');
        } catch (err) { alert("マイクへのアクセスが拒否されました。ブラウザの設定をご確認ください。"); }
      } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        isRecording = false;
        btnRecord.classList.remove('recording');
      }
    });
  }

  const btnOutputLoop = document.getElementById('btn-output-loop');
  const btnOutputPlay = document.getElementById('btn-output-play');
  const btnOutputStop = document.getElementById('btn-output-stop');

  if (btnOutputLoop) {
    btnOutputLoop.addEventListener('click', () => {
      isOutputLooping = !isOutputLooping;
      btnOutputLoop.innerText = `Loop: ${isOutputLooping ? 'ON' : 'OFF'}`;
      btnOutputLoop.classList.toggle('active', isOutputLooping);
      if (outputAudioSource) outputAudioSource.loop = isOutputLooping;
    });
  }

  if (btnOutputPlay) {
    btnOutputPlay.addEventListener('click', async () => {
      if (!outputAudioBuffer) return;
      if (outputAudioSource) { try{outputAudioSource.stop()}catch(e){} }
      await initAudio();
      outputAudioSource = audioCtx.createBufferSource();
      outputAudioSource.buffer = outputAudioBuffer;
      outputAudioSource.loop = isOutputLooping;
      outputAudioSource.connect(masterGain);
      outputAudioSource.start(0);
      btnOutputPlay.innerText = "再生中";
      btnOutputPlay.classList.add('recording');
    });
  }

  if (btnOutputStop) {
    btnOutputStop.addEventListener('click', () => {
      if (outputAudioSource) { try{outputAudioSource.stop()}catch(e){} outputAudioSource = null; }
      if (btnOutputPlay) {
        btnOutputPlay.innerText = "再生";
        btnOutputPlay.classList.remove('recording');
      }
    });
  }

  const btnExportMaster = document.getElementById('btn-export-master');
  const inputExportName = document.getElementById('input-export-name');
  if (btnExportMaster) {
    btnExportMaster.addEventListener('click', async () => {
      const activeTracks = tracks.filter(t => t.isActive);
      if (activeTracks.length === 0) { alert("ONになっている音がありません。"); return; }

      const exportName = inputExportName.value.trim() || `Untitled`;
      btnExportMaster.innerText = "合成・投稿中...";
      btnExportMaster.disabled = true;

      try {
        await initAudio();
        const OfflineCtxConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineCtxConstructor) throw new Error("OfflineAudioContext非対応");

        let maxDuration = 5;
        activeTracks.forEach(t => {
          const end = t.delayTime + (t.isLooping ? 30 : t.playDuration);
          if (end > maxDuration) maxDuration = end;
        });
        const renderDur = Math.min(Math.ceil(maxDuration + 2), 60);

        const offlineCtx = new OfflineCtxConstructor(2, audioCtx.sampleRate * renderDur, audioCtx.sampleRate);
        const offlineMaster = offlineCtx.createGain(); offlineMaster.connect(offlineCtx.destination);
        const offlineConvolver = offlineCtx.createConvolver(); offlineConvolver.buffer = convolver.buffer;
        const offlineDry = offlineCtx.createGain(); offlineDry.connect(offlineMaster);
        const offlineWet = offlineCtx.createGain(); offlineWet.connect(offlineConvolver); offlineConvolver.connect(offlineMaster);

        activeTracks.forEach(t => {
          if (t.buffer) {
            const src = offlineCtx.createBufferSource();
            src.buffer = t.buffer; src.loop = t.isLooping;
            const g = offlineCtx.createGain(); g.gain.value = t.volume;
            const revG = offlineCtx.createGain(); revG.gain.value = t.trackReverb * 2.0;
            src.connect(g); src.connect(revG);
            g.connect(offlineDry); revG.connect(offlineWet);
            src.start(t.delayTime, 0, t.isLooping ? undefined : t.playDuration);
          }
        });

        const renderedBuffer = await offlineCtx.startRendering();
        outputAudioBuffer = renderedBuffer;

        const wavBlob = bufferToWavBlob(renderedBuffer);
        const timestamp = Date.now();
        const storagePath = `exports/track_${timestamp}.wav`;

        if (storage && db) {
          const targetCollection = (appMode === "mikiki") ? "mikiki_exports" : "exports";
          const snapshot = await storage.ref().child(storagePath).put(wavBlob);
          const downloadUrl = await snapshot.ref.getDownloadURL();
          await db.collection(targetCollection).add({
            user: currentUser, title: exportName, url: downloadUrl,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          alert("クラウドに投稿されました。右上の「作品一覧」から確認できます。");
          inputExportName.value = "";

          document.getElementById('output-player-container').style.display = 'block';
          document.getElementById('output-file-name').innerText = exportName || "Untitled";
        } else { alert("ローカルテスト環境のため保存はスキップされました。"); }
      } catch (err) { alert("作品の合成に失敗しました。"); }
      finally { btnExportMaster.innerText = "投稿する"; btnExportMaster.disabled = false; }
    });
  }

  const worksModal = document.getElementById('works-modal');
  const btnCloseWorks = document.getElementById('btn-close-works');
  const worksListContainer = document.getElementById('works-list-container');
  let currentGalleryAudio = null; let currentGalleryPlayBtn = null;

  const btnShowWorks = document.getElementById('btn-show-works');
  if (btnShowWorks) {
    btnShowWorks.addEventListener('click', async () => {
      worksModal.style.display = 'flex';
      worksListContainer.innerHTML = '読み込み中...';
      if (!db) { worksListContainer.innerHTML = 'データベース未接続です。'; return; }

      const targetCollection = (appMode === "mikiki") ? "mikiki_exports" : "exports";
      const snap = await db.collection(targetCollection).orderBy("createdAt", "desc").get();

      worksListContainer.innerHTML = '';
      if (snap.empty) { worksListContainer.innerHTML = '<div style="font-size: 0.8rem;">まだ作品がありません。</div>'; return; }

      snap.forEach(doc => {
        const data = doc.data();
        const isOwn = (data.user === currentUser);
        const delBtn = isOwn ? `<button class="action-btn gallery-delete-btn" data-id="${doc.id}" style="color:#e74c3c; margin-left:12px;">削除</button>` : '';

        const el = document.createElement('div');
        el.className = 'track-item';
        el.style.borderBottom = '1px solid var(--line-color)';
        el.style.padding = '12px 0';
        el.style.flexDirection = 'row';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'space-between';

        el.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:4px; max-width:60%;">
            <div class="track-name" style="font-size:0.75rem; color:var(--text-main); font-weight:bold;">${data.title || 'Untitled'}</div>
            <div style="font-size:0.55rem; color:var(--text-muted);">by ${data.user}</div>
          </div>
          <div class="track-controls" style="flex-grow:0; gap: 0;">
            <button class="action-btn gallery-play-btn" data-url="${data.url}">再生</button>
            ${delBtn}
          </div>
        `;
        worksListContainer.appendChild(el);
      });

      document.querySelectorAll('.gallery-play-btn').forEach(b => {
        b.addEventListener('click', (e) => {
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

      document.querySelectorAll('.gallery-delete-btn').forEach(b => {
        b.addEventListener('click', async (e) => {
          if(!confirm("本当に削除しますか？")) return;
          const targetCollection = (appMode === "mikiki") ? "mikiki_exports" : "exports";
          await db.collection(targetCollection).doc(e.target.getAttribute('data-id')).delete();
          e.target.closest('.track-item').remove();
        });
      });
    });
  }
  if (btnCloseWorks) {
    btnCloseWorks.addEventListener('click', () => {
      worksModal.style.display = 'none';
      if(currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
      if(currentGalleryPlayBtn) { currentGalleryPlayBtn.innerText = '再生'; currentGalleryPlayBtn = null; }
    });
  }

  const btnListenEveryone = document.getElementById('btn-listen-everyone');
  if (btnListenEveryone) {
    btnListenEveryone.addEventListener('click', async (e) => {
      await initAudio();
      if (!isListeningEveryone) {
        isListeningEveryone = true; e.target.innerText = "停止する"; e.target.classList.add('recording');
        document.getElementById('current-playing-info').innerText = "読み込み中...";
        startListenEveryone();
      } else {
        isListeningEveryone = false; e.target.innerText = "聴く"; e.target.classList.remove('recording');
        document.getElementById('current-playing-info').innerText = ""; stopListenEveryone();
      }
    });
  }

});

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);
document.body.addEventListener('touchstart', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, {passive: true, once: true});

// ======= 展示モード：AR =======
async function initARWorks() {
  await initAudio();
  const loadPromises = AR_WORKS.map(async (work) => {
    if (!work.buffer) {
      try {
        const response = await fetch(`audio/${work.fileName}`);
        if (response.ok) work.buffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
      } catch(e) { console.log("AR音源読み込みエラー", e); }
    }
    if (!work.gainNode && audioCtx) {
      work.gainNode = audioCtx.createGain();
      work.gainNode.gain.value = 0.0;
      work.gainNode.connect(masterGain);
    }
  });
  await Promise.all(loadPromises);
}

async function startARMode() {
  await initAudio();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  document.getElementById('ar-loading').style.display = 'flex';
  await initARWorks();

  if (!window.arEventsBound) {
    for (let i = 0; i < 5; i++) {
      const targetEl = document.getElementById(`target-${i}`);
      if (targetEl) {
        targetEl.addEventListener('targetFound', () => {
          if (AR_WORKS[i]) {
            AR_WORKS[i].targetVolume = 1.0;
            if (AR_WORKS[i].gainNode) AR_WORKS[i].gainNode.gain.value = 1.0;
          }
        });
        targetEl.addEventListener('targetLost', () => {
          if (AR_WORKS[i]) {
            AR_WORKS[i].targetVolume = 0.0;
          }
        });
      }
    }
    window.arEventsBound = true;
  }

  AR_WORKS.forEach(work => {
    if (work.source) { try{work.source.stop();}catch(e){} }
    if (work.buffer && work.gainNode) {
      work.source = audioCtx.createBufferSource();
      work.source.buffer = work.buffer;
      work.source.loop = true;
      work.source.connect(work.gainNode);
      work.source.start(0);
    }
    work.targetVolume = 0;
    work.currentVolume = 0;
    if (work.gainNode) work.gainNode.gain.value = 0;
  });

  isARScanning = true;
  document.getElementById('ar-container').style.display = 'block';

  const sceneEl = document.querySelector('a-scene');
  if (sceneEl) {
    sceneEl.addEventListener('arReady', () => { document.getElementById('ar-loading').style.display = 'none'; });
    sceneEl.addEventListener('arError', () => {
      document.getElementById('ar-loading').style.display = 'none';
      alert("カメラの起動に失敗しました。ブラウザのカメラ許可設定をご確認ください。");
    });

    const startMindAR = () => {
      if (sceneEl.systems["mindar-image-system"]) {
        sceneEl.systems["mindar-image-system"].start();
      } else {
        setTimeout(startMindAR, 500);
      }
    };

    if (sceneEl.hasLoaded) {
      startMindAR();
    } else {
      sceneEl.addEventListener('loaded', startMindAR);
    }
  }

  if (arFadeInterval) clearInterval(arFadeInterval);
  arFadeInterval = setInterval(() => {
    AR_WORKS.forEach(work => {
      if (Math.abs(work.currentVolume - work.targetVolume) > 0.01) {
        const speed = work.targetVolume > 0.5 ? 0.25 : 0.05;
        work.currentVolume += (work.targetVolume - work.currentVolume) * speed;
        if(work.gainNode) work.gainNode.gain.value = work.currentVolume;
      } else if (work.currentVolume !== work.targetVolume) {
        work.currentVolume = work.targetVolume;
        if(work.gainNode) work.gainNode.gain.value = work.currentVolume;
      }
    });
  }, 33);
}

function stopARMode() {
  isARScanning = false;
  const sceneEl = document.querySelector('a-scene');
  if (sceneEl && sceneEl.systems["mindar-image-system"]) sceneEl.systems["mindar-image-system"].stop();
  document.getElementById('ar-container').style.display = 'none';
  document.getElementById('ar-loading').style.display = 'none';
  if (arFadeInterval) clearInterval(arFadeInterval);

  AR_WORKS.forEach(work => {
    work.targetVolume = 0;
    work.currentVolume = 0;
    if (work.source) { try{work.source.stop();}catch(e){} work.source = null; }
    if (work.gainNode) { work.gainNode.gain.value = 0; }
  });
}

// ======= オーディオとワークショップ =======
async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(audioCtx.destination);
    convolver = audioCtx.createConvolver(); convolver.buffer = createReverbBuffer(audioCtx, 4.5, 2.5);
    dryGain = audioCtx.createGain(); wetGain = audioCtx.createGain();
    dryGain.connect(masterGain); wetGain.connect(convolver); convolver.connect(masterGain);
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

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

async function startSyncTracks() {
  tracks = [];
  const emptyMsg = document.getElementById('empty-msg');
  if (emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = "環境を読み込み中..."; }

  const loadInitialAssets = ASSETS.map(async (asset) => {
    const url = `${asset.folder}${encodeURIComponent(asset.fileName)}`;

    let audioBuffer = null;
    try { const response = await fetch(url); if (response.ok) audioBuffer = await audioCtx.decodeAudioData(await response.arrayBuffer()); } catch (e) {}

    const trackGain = audioCtx.createGain(); const trackRevGain = audioCtx.createGain();
    trackGain.connect(dryGain); trackRevGain.connect(wetGain); trackGain.gain.value = 0.0; trackRevGain.gain.value = 0.0;

    return {
      id: asset.id, dbDocId: `preset_${asset.id}`, name: asset.name, url: url, buffer: audioBuffer, source: null, previewSource: null,
      gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: false, volume: 1.0, isActive: false,
      trackReverb: 0.0, delayTime: 0, playDuration: audioBuffer ? audioBuffer.duration : 5, bufferDuration: audioBuffer ? audioBuffer.duration : 5, isPreset: true, category: asset.category
    };
  });

  tracks = await Promise.all(loadInitialAssets);
  if (emptyMsg) emptyMsg.style.display = 'none';
  renderUI();
}

async function simulateLocalTrack(name, url, localId) {
  const emptyMsg = document.getElementById('empty-msg');
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
  trackGain.gain.value = 1.0;
  trackRevGain.gain.value = 0.0;

  const localTrack = {
    id: localId, dbDocId: localId, name: name, url: url, buffer: audioBuffer, source: null, previewSource: null,
    gainNode: trackGain, reverbGainNode: trackRevGain, isLooping: true, volume: 1.0, isActive: true,
    trackReverb: 0.0, delayTime: 0, playDuration: audioBuffer ? audioBuffer.duration : 5, bufferDuration: audioBuffer ? audioBuffer.duration : 5, isPreset: false, category: "録音データ"
  };

  tracks.push(localTrack);
  renderUI();
}

function renderUI() {
  const trackListEl = document.getElementById('track-list'); const timelineTracksEl = document.getElementById('timeline-tracks');
  if (trackListEl) trackListEl.innerHTML = ''; if (timelineTracksEl) timelineTracksEl.innerHTML = '';

  const emptyMsg = document.getElementById('empty-msg');
  if (tracks.length === 0) { if (emptyMsg) { emptyMsg.style.display = 'block'; emptyMsg.innerText = "音がありません。"; } }
  else { if (emptyMsg) emptyMsg.style.display = 'none'; }

  tracks.forEach((track) => {
    const mixerEl = document.createElement('div'); mixerEl.className = 'track-item';
    const activeBtnStyle = track.isActive ? "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:var(--text-main); color:var(--bg-color); border:1px solid var(--text-main);" : "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:transparent; color:var(--text-muted); border:1px solid var(--text-muted);";
    const onOffBtnHTML = `<button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} cursor:pointer; flex-shrink:0;">${track.isActive ? 'ON' : 'OFF'}</button>`;

    const subtitleHTML = track.category ? `<div style="font-size:0.55rem; color:var(--text-muted); font-weight:normal;">${track.category}</div>` : '';
    const nameTrackHTML = `<div style="display:flex; flex-direction:column; flex-grow:1; margin-left:10px;"><span class="track-name-label" style="font-weight:bold; color:var(--text-main); font-size:0.8rem;">${track.name}</span>${subtitleHTML}</div>`;

    const playBtnHTML = `<button class="action-btn preview-btn" data-id="${track.dbDocId}">再生</button>`;
    const detailBtnHTML = `<button class="action-btn toggle-detail-btn" data-id="${track.dbDocId}" style="background:transparent; border:none; color:var(--text-muted); text-decoration:underline; font-size:0.65rem;">▼ 詳細</button>`;

    const detailsHTML = `
      <div class="track-details" id="details-${track.dbDocId}" style="display:none; background: #fafafa; border-radius: 4px; padding: 10px; margin-top: 10px; flex-direction: column; gap: 10px; border: 1px solid #eee;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.65rem; color:var(--text-muted); width: 60px;">Volume</span>
          <input type="range" class="track-vol-slider" data-id="${track.dbDocId}" min="0" max="2" step="0.05" value="${track.volume}" style="flex-grow:1;">
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.65rem; color:var(--text-muted); width: 60px;">Reverb</span>
          <input type="range" class="track-rev-slider" data-id="${track.dbDocId}" min="0" max="1" step="0.05" value="${track.trackReverb}" style="flex-grow:1;">
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.65rem; color:var(--text-muted); width: 60px;">Start</span>
          <input type="range" class="track-delay-slider" data-id="${track.dbDocId}" min="0" max="60" step="0.1" value="${track.delayTime}" style="flex-grow:1;">
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.65rem; color:var(--text-muted); width: 60px;">End</span>
          <input type="range" class="track-duration-slider" data-id="${track.dbDocId}" min="0.1" max="${Math.max(track.bufferDuration, 0.1)}" step="0.1" value="${track.playDuration}" style="flex-grow:1;">
        </div>
      </div>
    `;

    mixerEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
        <div style="display:flex; align-items:center; flex-grow:1;">${onOffBtnHTML}${nameTrackHTML}</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}" style="font-size:0.65rem;">Loop</button>
          ${playBtnHTML}
          ${detailBtnHTML}
        </div>
      </div>
      ${detailsHTML}
    `;
    if (trackListEl) trackListEl.appendChild(mixerEl);

    if (track.isActive) {
      const rowEl = document.createElement('div'); rowEl.className = 'timeline-row';
      const clipEl = document.createElement('div'); clipEl.className = 'timeline-clip'; clipEl.setAttribute('data-id', track.dbDocId); clipEl.innerText = track.name + (track.isLooping ? " ↻" : "");
      clipEl.style.left = `${track.delayTime * PIXELS_PER_SEC}px`;
      if (track.isLooping) { clipEl.style.width = `800px`; clipEl.style.background = "repeating-linear-gradient(90deg, #f0f0f0, #f0f0f0 100px, #e8e8e8 101px)"; }
      else { clipEl.style.width = `${Math.max(track.playDuration * PIXELS_PER_SEC, 10)}px`; }
      rowEl.appendChild(clipEl); if (timelineTracksEl) timelineTracksEl.appendChild(rowEl);
    }
  });
  bindMixerEvents();
}

function bindMixerEvents() {
  document.querySelectorAll('.toggle-active-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id);
      if (t) { t.isActive = !t.isActive; renderUI(); }
    });
  });

  document.querySelectorAll('.loop-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id);
      if(!t) return; t.isLooping = !t.isLooping; renderUI();
    });
  });

  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id);
      if(!t || !t.buffer) return;
      if (t.previewSource) {
        try { t.previewSource.stop(); } catch(ex){} t.previewSource = null; e.target.innerText = '再生'; e.target.classList.remove('recording');
      } else {
        await initAudio(); const source = audioCtx.createBufferSource(); source.buffer = t.buffer; source.connect(masterGain);
        source.onended = () => { t.previewSource = null; e.target.innerText = '再生'; e.target.classList.remove('recording'); };
        source.start(0); t.previewSource = source; e.target.innerText = '停止'; e.target.classList.add('recording');
      }
    });
  });

  document.querySelectorAll('.toggle-detail-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.getAttribute('data-id');
      const detailsDiv = document.getElementById(`details-${id}`);
      if (detailsDiv) {
        if (detailsDiv.style.display === 'none') { detailsDiv.style.display = 'flex'; e.target.innerText = '▲ 閉じる'; }
        else { detailsDiv.style.display = 'none'; e.target.innerText = '▼ 詳細'; }
      }
    });
  });

  document.querySelectorAll('.track-vol-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id);
      if (t) { t.volume = parseFloat(e.target.value); if(t.gainNode) t.gainNode.gain.value = t.isActive ? t.volume : 0; }
    });
  });
  document.querySelectorAll('.track-rev-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id);
      if (t) { t.trackReverb = parseFloat(e.target.value); if(t.reverbGainNode) t.reverbGainNode.gain.value = t.isActive ? (t.trackReverb * 2.0) : 0; }
    });
  });
  document.querySelectorAll('.track-delay-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id);
      if (t) { t.delayTime = parseFloat(e.target.value); const clip = document.querySelector(`.timeline-clip[data-id="${id}"]`); if (clip) clip.style.left = `${t.delayTime * PIXELS_PER_SEC}px`; }
    });
  });
  document.querySelectorAll('.track-duration-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const id = e.target.getAttribute('data-id'); const t = tracks.find(x => x.dbDocId === id);
      if (t) { t.playDuration = parseFloat(e.target.value); const clip = document.querySelector(`.timeline-clip[data-id="${id}"]`); if (clip && !t.isLooping) clip.style.width = `${Math.max(t.playDuration * PIXELS_PER_SEC, 10)}px`; }
    });
  });
}

function startTrackSource(track, elapsed = 0) {
  if (!track.buffer || !track.gainNode) return; if (!track.isActive) return;
  track.gainNode.gain.value = track.volume; track.reverbGainNode.gain.value = track.trackReverb * 2.0;
  if (track.source) { try { track.source.stop(); } catch(e){} }
  track.source = audioCtx.createBufferSource();
  track.source.buffer = track.buffer;
  track.source.loop = track.isLooping;
  track.source.connect(track.gainNode);
  track.source.connect(track.reverbGainNode);

  const now = audioCtx.currentTime;
  const targetStartTime = startTime + track.delayTime;

  if (isMasterPlaying) {
    if (now < targetStartTime) {
      if (track.isLooping) {
        track.source.start(targetStartTime);
      } else {
        track.source.start(targetStartTime, 0, track.playDuration);
      }
    } else {
      const offset = now - targetStartTime;
      if (track.isLooping) {
        track.source.start(now, offset % track.bufferDuration);
      } else if (offset < track.playDuration) {
        track.source.start(now, offset, track.playDuration - offset);
      }
    }
  }
}

function updateProgress() {
  animationFrameId = requestAnimationFrame(updateProgress); if (!isMasterPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  const playhead = document.getElementById('playhead'); if (playhead) playhead.style.left = `${elapsed * PIXELS_PER_SEC}px`;
  if (elapsed >= 40) { document.getElementById('btn-master-play-stop').click(); }
}

async function startListenEveryone() {
  if (db) {
    try {
      const snap = await db.collection("mikiki_exports").get();
      everyoneTracks = [];
      snap.forEach(doc => { const data = doc.data(); if(data.url) everyoneTracks.push(data); });
      if (everyoneTracks.length === 0) {
        document.getElementById('current-playing-info').innerText = "まだ作品がありません。";
        isListeningEveryone = false; const btn = document.getElementById('btn-listen-everyone');
        if (btn) { btn.innerText = "聴く"; btn.classList.remove('recording'); }
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
  if (infoEl) infoEl.innerText = `♪ 再生中: ${trackData.title || "Untitled"}`;

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
        if (infoEl) infoEl.innerText = "（待機中...）";
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
