// Firebase初期化
const firebaseConfig = {
    apiKey: "AIzaSyCwBqi08ShVjJ90Mku2NsXJK0E03p4CsT4",
    authDomain: "kaiga-wo-kiku.firebaseapp.com",
    projectId: "kaiga-wo-kiku",
    storageBucket: "kaiga-wo-kiku.firebasestorage.app"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

let appMode = ""; // "make" 又は "mikiki"
let currentUser = ""; 
let audioCtx;
let masterGain, convolver, dryGain, wetGain;
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

const PIXELS_PER_SEC = 30; 

// --- DOM要素取得 ---
const userModal = document.getElementById('user-modal');
const modalStep1 = document.getElementById('modal-step-1');
const modalStep2 = document.getElementById('modal-step-2');
const modalStep3 = document.getElementById('modal-step-3'); 
const inputUsername = document.getElementById('input-username');
const btnChoiceFirst = document.getElementById('btn-choice-first');
const btnChoiceReturn = document.getElementById('btn-choice-return');
const btnLogoutBack = document.getElementById('btn-logout-back');
const btnBackToStep2 = document.getElementById('btn-back-to-step2');

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

// --- Unity WebGL検出命令の中継用 (ミキキの交差点でのみロードされる) ---
function getUnityInstance() {
    if (typeof window.unityInstance !== "undefined" && window.unityInstance && typeof window.unityInstance.SendMessage === "function") return window.unityInstance;
    if (typeof unityInstance !== "undefined" && unityInstance && typeof unityInstance.SendMessage === "function") return unityInstance;
    if (typeof gameInstance !== "undefined" && gameInstance && typeof gameInstance.SendMessage === "function") return gameInstance;
    for (let key in window) {
        try {
            if (window[key] && typeof window[key].SendMessage === "function") return window[key];
        } catch (e) {}
    }
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
    const container = document.getElementById('unity-container');
    container.innerHTML = `<canvas id="unity-canvas" style="display: none; width: 0px; height: 0px;"></canvas>`;
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
        createUnityInstance(document.querySelector("#unity-canvas"), config, (progress) => {}).then((instance) => {
            window.unityInstance = instance;
        }).catch((m) => { console.error(m); });
    };
    document.body.appendChild(script);
}

// --- 最初に入力するログイン認証・重複検知ロジック ---
if (btnChoiceFirst) {
    btnChoiceFirst.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = inputUsername.value.trim();
        if (!username) { alert("ユーザー名を入力してください。"); return; }
        
        // Firestore上のユーザー重複チェック
        const userRef = db.collection("users").doc(username);
        const doc = await userRef.get();
        if (doc.exists) {
            alert("このユーザー名は既に存在します。別の名前を入力するか、再開を選択してください。");
            return;
        }
        
        // 重複がなければ新規登録してステップ2へ
        await userRef.set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        currentUser = username;
        modalStep1.style.display = 'none';
        modalStep2.style.display = 'block';
        await initAudio();
    });
}

if (btnChoiceReturn) {
    btnChoiceReturn.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = inputUsername.value.trim();
        if (!username) { alert("ユーザー名を入力してください。"); return; }
        
        currentUser = username;
        modalStep1.style.display = 'none';
        modalStep2.style.display = 'block';
        await initAudio();
    });
}

if (btnLogoutBack) {
    btnLogoutBack.addEventListener('click', (e) => {
        e.preventDefault();
        currentUser = "";
        modalStep2.style.display = 'none';
        modalStep1.style.display = 'block';
    });
}

// --- プロジェクト選択分岐ロジック ---
if (btnChoiceMake) {
    btnChoiceMake.addEventListener('click', (e) => {
        e.preventDefault();
        appMode = "make"; // 聴く絵画をつくるモード
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
        appMode = "mikiki"; // ミキキの交差点モード
        loadUnityInstance(); // WebGL環境のロード起動
        modalStep2.style.display = 'none';
        modalStep3.style.display = 'block';
    });
}

if (btnBackToStep2) {
    btnBackToStep2.addEventListener('click', (e) => {
        e.preventDefault();
        modalStep3.style.display = 'none';
        modalStep2.style.display = 'block';
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

// --- 聴くモード専用：mp3直接駆動中継 ---
if (btnPlayUnityAudio) {
    btnPlayUnityAudio.addEventListener('click', () => {
        if (appMode === "mikiki") {
            if (!getUnityInstance()) {
                alert("Unityシステムをロード中です。数秒待ってからお試しください。");
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
            // make モード時のフォールバック処理
            if (!isListenModePlaying) {
                if (tracks.length > 0 && tracks[0].url) {
                    currentGalleryAudio = new Audio(formalizeUrl(tracks[0].url));
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

// --- 録音機能ロジック ---
if (btnRecord) {
    btnRecord.addEventListener('click', async () => {
        await initAudio();
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                recordedChunks = [];
                const recordStart = Date.now();

                mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
                mediaRecorder.onstop = async () => {
                    btnRecord.innerText = "Processing...";
                    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
                    const recordEnd = Date.now();
                    const estimatedDur = (recordEnd - recordStart) / 1000;
                    const timestamp = Date.now();
                    const storagePath = `audios/track_${timestamp}.webm`;
                    const storageRef = storage.ref().child(storagePath);
                    
                    try {
                        const snapshot = await storageRef.put(blob);
                        const downloadUrl = await snapshot.ref.getDownloadURL();
                        
                        await db.collection("tracks").add({
                            user: currentUser, 
                            name: `Track ${String(timestamp).substring(9, 13)}`,
                            url: downloadUrl,
                            storagePath: storagePath,
                            isLooping: true,
                            volume: 1.0,
                            delayTime: 0,
                            estimatedDuration: estimatedDur,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    } catch (e) { alert("保存失敗しました。"); }
                    btnRecord.innerText = "録音を開始";
                };
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
        const snapshot = await db.collection("exports").orderBy("updatedAt", "desc").get();
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
                </div>
            `;
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
                const id = e.target.getAttribute('data-id');
                try {
                    await db.collection("exports").doc(id).delete();
                    await loadGalleryWorks();
                } catch(err) { alert("削除失敗しました。"); }
            });
        });
    } catch (err) { console.error(err); }
}

if (btnCloseWorks) {
    btnCloseWorks.addEventListener('click', () => {
        worksModal.style.display = 'none';
        if (currentGalleryAudio) { currentGalleryAudio.pause(); currentGalleryAudio = null; }
        if (currentGalleryPlayBtn) currentGalleryPlayBtn.innerText = '再生';
        currentGalleryPlayBtn = null;
    });
}

// --- Web Audio API コア環境ロジック ---
async function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 1.0; 
        masterGain.connect(audioCtx.destination);
        convolver = audioCtx.createConvolver();
        convolver.buffer = createReverbBuffer(audioCtx, 3.0, 2.0);
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
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
}

function updateReverb() {
    if (!dryGain || !wetGain || !reverbSlider) return;
    const wetVal = parseFloat(reverbSlider.value);
    wetGain.gain.value = wetVal;
    dryGain.gain.value = 1.0 - (wetVal * 0.5);
}
if (reverbSlider) reverbSlider.addEventListener('input', updateReverb);

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

// --- Firestore同期 ＆ タイムラインデコード処理 ---
function startSyncTracks() {
    let query = db.collection("tracks");
    
    // ミキキの交差点モードの時のみ、自分の録音のみにフィルタリング
    if (appMode === "mikiki") {
        query = query.where("user", "==", currentUser);
    }

    query.onSnapshot(async (snapshot) => {
        if (snapshot.empty) {
            if(emptyMsg) emptyMsg.style.display = 'block';
            if(trackListEl) trackListEl.innerHTML = '';
            if(timelineTracksEl) timelineTracksEl.innerHTML = '';
            tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} } });
            tracks = [];
            return;
        }
        if(emptyMsg) emptyMsg.style.display = 'none';
        
        const currentDocIds = snapshot.docs.map(d => d.id);
        tracks.forEach(t => {
            if (!currentDocIds.includes(t.id)) { if (t.source) { try{t.source.stop()}catch(e){} } }
        });

        const sortedDocs = snapshot.docs.sort((a, b) => {
            return (a.data().createdAt?.toMillis() || 0) - (b.data().createdAt?.toMillis() || 0);
        });
        
        const loadPromises = sortedDocs.map(async (docSnapshot) => {
            const id = docSnapshot.id;
            const data = docSnapshot.data();
            const safeUrl = formalizeUrl(data.url);
            
            const existingTrack = tracks.find(t => t.id === id);
            if (existingTrack) {
                existingTrack.name = data.name;
                existingTrack.isLooping = data.isLooping !== undefined ? data.isLooping : true;
                existingTrack.volume = data.volume !== undefined ? data.volume : 1.0;
                
                if (existingTrack.delayTime !== data.delayTime) {
                    existingTrack.delayTime = data.delayTime;
                    if (isMasterPlaying && audioCtx && !isTransportBusy) {
                        if (existingTrack.source) { try{existingTrack.source.stop()}catch(e){} }
                        startTrackSource(existingTrack, audioCtx.currentTime - startTime);
                    }
                }
                if (existingTrack.gainNode) existingTrack.gainNode.gain.value = existingTrack.volume;
                if (existingTrack.source) existingTrack.source.loop = existingTrack.isLooping;
                return existingTrack;
            }

            // Web Audio APIによるmp3ファイルの直接デコード
            let audioBuffer = null;
            if (audioCtx && safeUrl) {
                try {
                    const response = await fetch(safeUrl);
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                    }
                } catch (e) { console.error(e); }
            }
            
            const newTrack = {
                id: id,
                name: data.name,
                url: safeUrl,
                buffer: audioBuffer,
                source: null,
                gainNode: audioCtx ? audioCtx.createGain() : null,
                isLooping: data.isLooping !== undefined ? data.isLooping : true,
                volume: data.volume !== undefined ? data.volume : 1.0,
                delayTime: data.delayTime !== undefined ? data.delayTime : 0,
                duration: audioBuffer ? audioBuffer.duration : (data.estimatedDuration || 5)
            };

            if (audioCtx && newTrack.gainNode) {
                newTrack.gainNode.connect(dryGain);
                newTrack.gainNode.connect(wetGain);
                newTrack.gainNode.gain.value = newTrack.volume;
                if (isMasterPlaying && !isTransportBusy) {
                    startTrackSource(newTrack, audioCtx.currentTime - startTime);
                }
            }
            return newTrack;
        });

        tracks = await Promise.all(loadPromises);
        renderUI();
    });
}

function renderUI() {
    if (!trackListEl || !timelineTracksEl) return;
    trackListEl.innerHTML = '';
    timelineTracksEl.innerHTML = '';
    let maxTimelineWidth = 600;

    tracks.forEach((track) => {
        const mixerEl = document.createElement('div');
        mixerEl.className = 'track-item';
        
        // 聴く絵画をつくるモード時は要素名を変更不可（プレーンテキスト）にする
        const nameTrackHTML = (appMode === "make") 
            ? `<span class="track-name-label">${track.name}</span>`
            : `<input type="text" class="track-name-input" data-id="${track.id}" value="${track.name}">`;

        // 聴く絵画をつくるモード時はトラックの複製・削除ボタンを非表示化
        const actionButtonsHTML = (appMode === "make") ? '' : `
            <button class="action-btn clone-btn" data-id="${track.id}">複製</button>
            <button class="action-btn delete-btn" data-id="${track.id}">削除</button>
        `;

        mixerEl.innerHTML = `
            ${nameTrackHTML}
            <div class="track-controls">
                <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.id}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button>
                <div class="vol-slider-wrapper">
                    <input type="range" class="vol-slider" data-id="${track.id}" min="0" max="1" step="0.01" value="${track.volume}">
                </div>
                ${actionButtonsHTML}
            </div>
        `;
        trackListEl.appendChild(mixerEl);

        const rowEl = document.createElement('div');
        rowEl.className = 'timeline-row';
        
        const clipEl = document.createElement('div');
        clipEl.className = 'timeline-clip';
        clipEl.innerText = track.name + (track.isLooping ? " ↻" : "");
        
        const leftPx = track.delayTime * PIXELS_PER_SEC;
        const widthPx = track.duration * PIXELS_PER_SEC;
        clipEl.style.left = `${leftPx}px`;
        
        if (track.isLooping) {
            clipEl.style.width = `1200px`; 
            clipEl.style.background = "repeating-linear-gradient(90deg, #f0f0f0, #f0f0f0 100px, #e8e8e8 101px)";
        } else {
            clipEl.style.width = `${Math.max(widthPx, 20)}px`;
        }
        
        if (leftPx + widthPx > maxTimelineWidth) maxTimelineWidth = leftPx + widthPx + 300;

        setupDraggableClip(clipEl, track);
        rowEl.appendChild(clipEl);
        timelineTracksEl.appendChild(rowEl);
    });

    if (timelineContainerEl) timelineContainerEl.style.width = `${maxTimelineWidth}px`;
    attachMixerEvents();
}

function setupDraggableClip(clipEl, track) {
    let isDragging = false;
    let startX = 0;
    let initialDelay = 0;

    const onStart = (e) => {
        if (!isMasterPlaying) initAudio();
        isDragging = true;
        startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        initialDelay = track.delayTime;
        clipEl.style.zIndex = 100;
        document.body.style.userSelect = 'none';
    };
    const onMove = (e) => {
        if (!isDragging) return;
        const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        clipEl.style.left = `${Math.max(0, initialDelay + ((currentX - startX) / PIXELS_PER_SEC)) * PIXELS_PER_SEC}px`;
    };
    const onEnd = async (e) => {
        if (!isDragging) return;
        isDragging = false;
        clipEl.style.zIndex = '';
        document.body.style.userSelect = '';
        const currentX = e.type.includes('mouse') ? e.clientX : e.changedTouches[0].clientX;
        let newDelay = Math.max(0, initialDelay + ((currentX - startX) / PIXELS_PER_SEC));
        await db.collection("tracks").doc(track.id).update({ delayTime: newDelay });
    };

    clipEl.addEventListener('mousedown', onStart);
    clipEl.addEventListener('touchstart', onStart, {passive: true});
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, {passive: true});
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
}

function attachMixerEvents() {
    document.querySelectorAll('.track-name-input').forEach(input => {
        input.addEventListener('change', async e => {
            const id = e.target.getAttribute('data-id');
            await db.collection("tracks").doc(id).update({ name: e.target.value.trim() });
        });
    });
    document.querySelectorAll('.loop-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            if(t) await db.collection("tracks").doc(id).update({ isLooping: !t.isLooping });
        });
    });
    document.querySelectorAll('.vol-slider').forEach(slider => {
        slider.addEventListener('input', e => {
            const t = tracks.find(x => x.id === e.target.getAttribute('data-id'));
            if (t && t.gainNode) t.gainNode.gain.value = parseFloat(e.target.value);
        });
        slider.addEventListener('change', async e => {
            await db.collection("tracks").doc(e.target.getAttribute('data-id')).update({ volume: parseFloat(e.target.value) });
        });
    });
    document.querySelectorAll('.clone-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const t = tracks.find(x => x.id === e.target.getAttribute('data-id'));
            if (!t) return;
            await db.collection("tracks").add({
                user: currentUser, name: `${t.name} c`, url: t.url, storagePath: t.storagePath || "",
                isLooping: t.isLooping, volume: t.volume, delayTime: t.delayTime, estimatedDuration: t.duration,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            if(confirm("削除しますか？")) await db.collection("tracks").doc(e.target.getAttribute('data-id')).delete();
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

    const targetStartTime = startTime + track.delayTime;
    const now = audioCtx.currentTime;

    if (isMasterPlaying) {
        if (now < targetStartTime) {
            track.source.start(targetStartTime);
        } else {
            const offset = Math.max(0, now - targetStartTime);
            const bufDur = track.buffer.duration;
            if (track.isLooping) {
                track.source.start(0, offset % bufDur);
            } else if (offset < bufDur) {
                track.source.start(0, offset);
            }
        }
    }
}

// --- トランスポートシステム制御 ---
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
        } finally { isTransportBusy = false; }
    });
}

if (btnStop) {
    btnStop.addEventListener('click', () => {
        isMasterPlaying = false;
        btnPlay.classList.remove('active');
        btnStop.classList.add('active');
        tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} t.source = null; } });
        cancelAnimationFrame(animationFrameId);
        if (playheadEl) playheadEl.style.left = '0px';
    });
}

if (btnRewind) {
    btnRewind.addEventListener('click', () => {
        const wasPlaying = isMasterPlaying;
        isMasterPlaying = false;
        tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} t.source = null; } });
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
            tracks.forEach(t => {
                if (t.source) { try{t.source.stop()}catch(e){} t.source = null; }
                startTrackSource(t, 0);
            });
        } else {
            if (btnStop) btnStop.click();
        }
    }
}

function checkExistingExport() {
    db.collection("exports").doc(currentUser).onSnapshot((doc) => {
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
        const arrayBuffer = await response.arrayBuffer();
        outputAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
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
            const maxDur = Math.max(...tracks.map(t => parseFloat(t.duration) + parseFloat(t.delayTime)));
            let renderDuration = maxDur + (isMasterLooping ? 0 : 2);

            const sampleRate = audioCtx.sampleRate;
            const offlineCtx = new OfflineAudioContext(2, sampleRate * renderDuration, sampleRate);
            const offlineMasterGain = offlineCtx.createGain();
            offlineMasterGain.connect(offlineCtx.destination);

            tracks.forEach(t => {
                if (!t.buffer) return;
                const source = offlineCtx.createBufferSource();
                source.buffer = t.buffer;
                source.loop = t.isLooping;
                const gain = offlineCtx.createGain();
                gain.gain.value = t.volume;
                source.connect(gain);
                gain.connect(offlineMasterGain);
                source.start(t.delayTime);
            });

            const renderedBuffer = await offlineCtx.startRendering();
            const wavBlob = bufferToWavBlob(renderedBuffer);
            const storagePath = `exports/${exportName}_${Date.now()}.mp3`;
            const snapshot = await storage.ref().child(storagePath).put(wavBlob);
            const downloadUrl = await snapshot.ref.getDownloadURL();

            await db.collection("exports").doc(currentUser).set({
                user: currentUser, title: exportName, url: downloadUrl,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("クラウドへの保存が完了しました。");
        } catch (err) { alert("合成失敗しました。"); }
        finally { btnExportMaster.innerText = "作品を完成させる"; btnExportMaster.disabled = false; }
    });
}

if (btnOutputDownload) {
    btnOutputDownload.addEventListener('click', () => {
        if (!outputAudioBuffer) return;
        const wavBlob = bufferToWavBlob(outputAudioBuffer);
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${inputExportName.value.trim() || "kaiga-wo-kiku-master"}.mp3`;
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
    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
    for (let i = 0; i < buffer.length; i++) { for (let c = 0; c < numOfChan; c++) { let sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i])); view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true); pos += 2; } }
    return new Blob([bufferArr], { type: 'audio/mp3' });
}
