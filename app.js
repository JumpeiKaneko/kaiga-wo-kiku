// ==============================================
// フィールドレコーディング ワークショップ用アプリ
// 録音 → 編集（音量・リバーブ・Start/End・ループ） → 合成して投稿
// 「絵画を聴く」のワークショップ画面をベースに、AR・展示モード・
// 音源プリセットを外し、録音と編集に特化させたバージョン。
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

// 「絵画を聴く」本体とデータが混ざらないよう、コレクション/保存先を分けています
const COLLECTION_NAME = "field_recording_exports";
const STORAGE_EXPORT_PATH = "field_recording/exports";

let currentUser = "";
let audioCtx, masterGain, convolver, dryGain, wetGain;
let tracks = [];
let isMasterPlaying = false;
let startTime = 0;
let animationFrameId;
let isTransportBusy = false;
const PIXELS_PER_SEC = 30;

let outputAudioBuffer = null;
let outputAudioSource = null;
let isOutputLooping = true;

let mediaRecorder, recordedChunks = [];
let isRecording = false;
let takeCount = 0;

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

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

function createReverbBuffer(ctx, duration, decay) {
  const length = ctx.sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return impulse;
}

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

document.body.addEventListener('click', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, true);
document.body.addEventListener('touchstart', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, { passive: true, once: true });

window.addEventListener('DOMContentLoaded', () => {
  const userModal = document.getElementById('user-modal');
  const mainApp = document.getElementById('main-app');

  // ---- ログイン ----
  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) {
    btnLogin.addEventListener('click', async () => {
      const username = document.getElementById('input-username').value.trim();
      if (!username) { alert("名前を入力してください。"); return; }
      currentUser = username;
      document.getElementById('current-user-display').innerText = currentUser;
      userModal.style.display = 'none';
      mainApp.style.display = 'block';
      await initAudio();
      renderUI();
    });
  }

  // ---- 録音 ----
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
            await addRecordingAsTrack(blob);
            btnRecord.innerText = "録音を開始";
          };
          mediaRecorder.start();
          isRecording = true;
          btnRecord.innerText = "録音を停止";
          btnRecord.classList.add('recording');
          document.getElementById('record-status-msg').innerText = "録音中...";
        } catch (err) {
          alert("マイクへのアクセスが拒否されました。ブラウザの設定をご確認ください。");
        }
      } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        isRecording = false;
        btnRecord.classList.remove('recording');
        document.getElementById('record-status-msg').innerText = "環境音を録音して追加できます";
      }
    });
  }

  // ---- 全体再生 ----
  const btnMasterPlay = document.getElementById('btn-master-play-stop');
  if (btnMasterPlay) {
    btnMasterPlay.addEventListener('click', async (e) => {
      if (isTransportBusy || tracks.length === 0) return;
      isTransportBusy = true;
      try {
        if (!isMasterPlaying) {
          await initAudio();
          isMasterPlaying = true;
          e.target.innerText = "全体を停止"; e.target.classList.add('recording');
          startTime = audioCtx.currentTime;
          tracks.forEach(t => startTrackSource(t));
          updateProgress();
        } else {
          stopAllTrackPlayback();
          isMasterPlaying = false;
          e.target.innerText = "全体を再生"; e.target.classList.remove('recording');
          cancelAnimationFrame(animationFrameId);
          const playhead = document.getElementById('playhead');
          if (playhead) playhead.style.left = '0px';
        }
      } finally { isTransportBusy = false; }
    });
  }

  // ---- 投稿した作品の再生 ----
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
      if (outputAudioSource) { try { outputAudioSource.stop(); } catch (e) {} }
      await initAudio();
      outputAudioSource = audioCtx.createBufferSource();
      outputAudioSource.buffer = outputAudioBuffer;
      outputAudioSource.loop = isOutputLooping;
      outputAudioSource.connect(masterGain);
      outputAudioSource.start(0);
      btnOutputPlay.innerText = "再生中"; btnOutputPlay.classList.add('recording');
    });
  }
  if (btnOutputStop) {
    btnOutputStop.addEventListener('click', () => {
      if (outputAudioSource) { try { outputAudioSource.stop(); } catch (e) {} outputAudioSource = null; }
      if (btnOutputPlay) { btnOutputPlay.innerText = "再生"; btnOutputPlay.classList.remove('recording'); }
    });
  }

  // ---- 投稿（合成してアップロード） ----
  const btnExportMaster = document.getElementById('btn-export-master');
  const inputExportName = document.getElementById('input-export-name');
  if (btnExportMaster) {
    btnExportMaster.addEventListener('click', async () => {
      const activeTracks = tracks.filter(t => t.isActive && t.buffer);
      if (activeTracks.length === 0) { alert("ONになっている音がありません。"); return; }

      const exportName = inputExportName.value.trim() || "Untitled";
      btnExportMaster.innerText = "合成・投稿中..."; btnExportMaster.disabled = true;

      try {
        await initAudio();
        const OfflineCtxConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineCtxConstructor) throw new Error("OfflineAudioContext非対応");

        let maxDuration = 5;
        activeTracks.forEach(t => {
          const end = t.delayTime + (t.isLooping ? 30 : t.playDuration);
          if (end > maxDuration) maxDuration = end;
        });
        const renderDur = Math.min(Math.ceil(maxDuration + 2), 90);

        const offlineCtx = new OfflineCtxConstructor(2, audioCtx.sampleRate * renderDur, audioCtx.sampleRate);
        const offlineMaster = offlineCtx.createGain(); offlineMaster.connect(offlineCtx.destination);
        const offlineConvolver = offlineCtx.createConvolver(); offlineConvolver.buffer = convolver.buffer;
        const offlineDry = offlineCtx.createGain(); offlineDry.connect(offlineMaster);
        const offlineWet = offlineCtx.createGain(); offlineWet.connect(offlineConvolver); offlineConvolver.connect(offlineMaster);

        activeTracks.forEach(t => {
          const src = offlineCtx.createBufferSource();
          src.buffer = t.buffer; src.loop = t.isLooping;
          const g = offlineCtx.createGain(); g.gain.value = t.volume;
          const revG = offlineCtx.createGain(); revG.gain.value = t.trackReverb * 2.0;
          src.connect(g); src.connect(revG);
          g.connect(offlineDry); revG.connect(offlineWet);
          src.start(t.delayTime, 0, t.isLooping ? undefined : t.playDuration);
        });

        const renderedBuffer = await offlineCtx.startRendering();
        outputAudioBuffer = renderedBuffer;

        const wavBlob = bufferToWavBlob(renderedBuffer);
        const timestamp = Date.now();
        const storagePath = `${STORAGE_EXPORT_PATH}/track_${timestamp}.wav`;

        if (storage && db) {
          const snapshot = await storage.ref().child(storagePath).put(wavBlob);
          const downloadUrl = await snapshot.ref.getDownloadURL();
          await db.collection(COLLECTION_NAME).add({
            user: currentUser, title: exportName, url: downloadUrl,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          alert("クラウドに投稿されました。右上の「作品一覧」から確認できます。");
          inputExportName.value = "";
          document.getElementById('output-player-container').style.display = 'block';
          document.getElementById('output-file-name').innerText = exportName;
        } else {
          alert("接続に問題があり保存はスキップされました。");
        }
      } catch (err) {
        console.error(err);
        alert("作品の合成に失敗しました。");
      } finally {
        btnExportMaster.innerText = "投稿する"; btnExportMaster.disabled = false;
      }
    });
  }

  // ---- 作品一覧 ----
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

      const snap = await db.collection(COLLECTION_NAME).orderBy("createdAt", "desc").get();
      worksListContainer.innerHTML = '';
      if (snap.empty) { worksListContainer.innerHTML = '<div style="font-size: 0.8rem;">まだ作品がありません。</div>'; return; }

      snap.forEach(doc => {
        const data = doc.data();
        const isOwn = (data.user === currentUser);
        const delBtn = isOwn ? `<button class="action-btn gallery-delete-btn" data-id="${doc.id}" style="color:#cc0000; margin-left:12px;">削除</button>` : '';

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
          if (!confirm("本当に削除しますか？")) return;
          await db.collection(COLLECTION_NAME).doc(e.target.getAttribute('data-id')).delete();
          e.target.closest('.track-item').remove();
        });
      });
    });
  }
  if (btnCloseWorks) {
    btnCloseWorks.addEventListener('click', () => {
      worksModal.style.display = 'none';
      if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
      if (currentGalleryPlayBtn) { currentGalleryPlayBtn.innerText = '再生'; currentGalleryPlayBtn = null; }
    });
  }
});

// 録音済みBlobをデコードしてミキサーにトラックとして追加
async function addRecordingAsTrack(blob) {
  takeCount += 1;
  const localId = `take_${Date.now()}`;
  let audioBuffer = null;
  try {
    const arrayBuffer = await blob.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) { console.error("デコード失敗", e); }

  const trackGain = audioCtx.createGain();
  const trackRevGain = audioCtx.createGain();
  trackGain.connect(dryGain); trackRevGain.connect(wetGain);
  trackGain.gain.value = 1.0; trackRevGain.gain.value = 0.0;

  const track = {
    id: localId, dbDocId: localId, name: `録音 ${takeCount}`, url: URL.createObjectURL(blob),
    buffer: audioBuffer, source: null, previewSource: null,
    gainNode: trackGain, reverbGainNode: trackRevGain,
    isLooping: false, volume: 1.0, isActive: true, trackReverb: 0.0,
    delayTime: 0,
    playDuration: audioBuffer ? audioBuffer.duration : 5,
    bufferDuration: audioBuffer ? audioBuffer.duration : 5,
    category: "録音データ"
  };

  tracks.push(track);
  renderUI();
}

function renderUI() {
  const trackListEl = document.getElementById('track-list');
  const timelineTracksEl = document.getElementById('timeline-tracks');
  if (trackListEl) trackListEl.innerHTML = '';
  if (timelineTracksEl) timelineTracksEl.innerHTML = '';

  const emptyMsg = document.getElementById('empty-msg');
  if (tracks.length === 0) { if (emptyMsg) emptyMsg.style.display = 'block'; }
  else { if (emptyMsg) emptyMsg.style.display = 'none'; }

  tracks.forEach((track) => {
    const mixerEl = document.createElement('div'); mixerEl.className = 'track-item';
    const activeBtnStyle = track.isActive
      ? "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:var(--text-main); color:var(--bg-color); border:1px solid var(--text-main);"
      : "width:44px; height:24px; border-radius:12px; font-weight:bold; font-size:0.6rem; background-color:transparent; color:var(--text-muted); border:1px solid var(--text-muted);";
    const onOffBtnHTML = `<button class="action-btn toggle-active-btn" data-id="${track.dbDocId}" style="${activeBtnStyle} cursor:pointer; flex-shrink:0;">${track.isActive ? 'ON' : 'OFF'}</button>`;
    const subtitleHTML = track.category ? `<div style="font-size:0.55rem; color:var(--text-muted); font-weight:normal;">${track.category}</div>` : '';
    const nameTrackHTML = `<div style="display:flex; flex-direction:column; flex-grow:1; margin-left:10px;"><span class="track-name-label" style="font-weight:bold; color:var(--text-main); font-size:0.8rem;">${track.name}</span>${subtitleHTML}</div>`;
    const playBtnHTML = `<button class="action-btn preview-btn" data-id="${track.dbDocId}">再生</button>`;
    const detailBtnHTML = `<button class="action-btn toggle-detail-btn" data-id="${track.dbDocId}" style="background:transparent; border:none; color:var(--text-muted); text-decoration:underline; font-size:0.65rem;">▼ 詳細</button>`;
    const deleteBtnHTML = `<button class="action-btn delete-track-btn" data-id="${track.dbDocId}" style="color:#cc0000;">削除</button>`;

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
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.dbDocId}" style="font-size:0.65rem;">Loop</button>
          ${playBtnHTML}
          ${detailBtnHTML}
          ${deleteBtnHTML}
        </div>
      </div>
      ${detailsHTML}
    `;
    trackListEl.appendChild(mixerEl);

    if (track.isActive) {
      const rowEl = document.createElement('div'); rowEl.className = 'timeline-row';
      const clipEl = document.createElement('div'); clipEl.className = 'timeline-clip';
      clipEl.setAttribute('data-id', track.dbDocId);
      clipEl.innerText = track.name + (track.isLooping ? " ↻" : "");
      clipEl.style.left = `${track.delayTime * PIXELS_PER_SEC}px`;
      if (track.isLooping) {
        clipEl.style.width = `800px`;
        clipEl.style.background = "repeating-linear-gradient(90deg, #f0f0f0, #f0f0f0 100px, #e8e8e8 101px)";
      } else {
        clipEl.style.width = `${Math.max(track.playDuration * PIXELS_PER_SEC, 10)}px`;
      }
      rowEl.appendChild(clipEl);
      timelineTracksEl.appendChild(rowEl);
    }
  });

  bindMixerEvents();
}

function bindMixerEvents() {
  document.querySelectorAll('.toggle-active-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const t = tracks.find(x => x.dbDocId === e.target.getAttribute('data-id'));
      if (t) { t.isActive = !t.isActive; renderUI(); }
    });
  });

  document.querySelectorAll('.loop-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const t = tracks.find(x => x.dbDocId === e.target.getAttribute('data-id'));
      if (t) { t.isLooping = !t.isLooping; renderUI(); }
    });
  });

  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const t = tracks.find(x => x.dbDocId === e.target.getAttribute('data-id'));
      if (!t || !t.buffer) return;
      if (t.previewSource) {
        try { t.previewSource.stop(); } catch (ex) {}
        t.previewSource = null; e.target.innerText = '再生'; e.target.classList.remove('recording');
      } else {
        await initAudio();
        const source = audioCtx.createBufferSource();
        source.buffer = t.buffer; source.connect(masterGain);
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

  document.querySelectorAll('.delete-track-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.getAttribute('data-id');
      if (!confirm("この録音を削除しますか？")) return;
      const t = tracks.find(x => x.dbDocId === id);
      if (t) {
        if (t.source) { try { t.source.stop(); } catch (ex) {} }
        if (t.previewSource) { try { t.previewSource.stop(); } catch (ex) {} }
        if (t.gainNode) t.gainNode.disconnect();
        if (t.reverbGainNode) t.reverbGainNode.disconnect();
      }
      tracks = tracks.filter(x => x.dbDocId !== id);
      renderUI();
    });
  });

  document.querySelectorAll('.track-vol-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const t = tracks.find(x => x.dbDocId === e.target.getAttribute('data-id'));
      if (t) { t.volume = parseFloat(e.target.value); if (t.gainNode) t.gainNode.gain.value = t.isActive ? t.volume : 0; }
    });
  });
  document.querySelectorAll('.track-rev-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const t = tracks.find(x => x.dbDocId === e.target.getAttribute('data-id'));
      if (t) { t.trackReverb = parseFloat(e.target.value); if (t.reverbGainNode) t.reverbGainNode.gain.value = t.isActive ? (t.trackReverb * 2.0) : 0; }
    });
  });
  document.querySelectorAll('.track-delay-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const t = tracks.find(x => x.dbDocId === e.target.getAttribute('data-id'));
      if (t) {
        t.delayTime = parseFloat(e.target.value);
        const clip = document.querySelector(`.timeline-clip[data-id="${e.target.getAttribute('data-id')}"]`);
        if (clip) clip.style.left = `${t.delayTime * PIXELS_PER_SEC}px`;
      }
    });
  });
  document.querySelectorAll('.track-duration-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const t = tracks.find(x => x.dbDocId === e.target.getAttribute('data-id'));
      if (t) {
        t.playDuration = parseFloat(e.target.value);
        const clip = document.querySelector(`.timeline-clip[data-id="${e.target.getAttribute('data-id')}"]`);
        if (clip && !t.isLooping) clip.style.width = `${Math.max(t.playDuration * PIXELS_PER_SEC, 10)}px`;
      }
    });
  });
}

function startTrackSource(track) {
  if (!track.buffer || !track.gainNode || !track.isActive) return;
  track.gainNode.gain.value = track.volume;
  track.reverbGainNode.gain.value = track.trackReverb * 2.0;
  if (track.source) { try { track.source.stop(); } catch (e) {} }
  track.source = audioCtx.createBufferSource();
  track.source.buffer = track.buffer;
  track.source.loop = track.isLooping;
  track.source.connect(track.gainNode);
  track.source.connect(track.reverbGainNode);

  const targetStartTime = startTime + track.delayTime;
  if (track.isLooping) {
    track.source.start(targetStartTime);
  } else {
    track.source.start(targetStartTime, 0, track.playDuration);
  }
}

function stopAllTrackPlayback() {
  tracks.forEach(t => {
    if (t.source) { try { t.source.stop(); } catch (e) {} t.source = null; }
    if (t.previewSource) { try { t.previewSource.stop(); } catch (e) {} t.previewSource = null; }
  });
  document.querySelectorAll('.preview-btn').forEach(b => { b.innerText = '再生'; b.classList.remove('recording'); });
}

function updateProgress() {
  animationFrameId = requestAnimationFrame(updateProgress);
  if (!isMasterPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  const playhead = document.getElementById('playhead');
  if (playhead) playhead.style.left = `${elapsed * PIXELS_PER_SEC}px`;
  if (elapsed >= 60) { document.getElementById('btn-master-play-stop').click(); }
}
