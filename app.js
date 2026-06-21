const firebaseConfig = {
    apiKey: "AIzaSyCwBqi08ShVjJ90Mku2NsXJK0E03p4CsT4",
    authDomain: "kaiga-wo-kiku.firebaseapp.com",
    projectId: "kaiga-wo-kiku",
    storageBucket: "kaiga-wo-kiku.firebasestorage.app"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

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

// ボタン連打バグを防ぐためのロック制御変数
let isTransportBusy = false;

let outputAudioBuffer = null;
let outputAudioSource = null;
let isOutputLooping = true; 

const PIXELS_PER_SEC = 30; 

const userModal = document.getElementById('user-modal');
const modalStep1 = document.getElementById('modal-step-1');
const modalStep2 = document.getElementById('modal-step-2');
const modalInputTitle = document.getElementById('modal-input-title');
const btnChoiceFirst = document.getElementById('btn-choice-first');
const btnChoiceReturn = document.getElementById('btn-choice-return');
const btnBackStep = document.getElementById('btn-back-step');

const inputUsername = document.getElementById('input-username');
const btnLogin = document.getElementById('btn-login');
const mainApp = document.getElementById('main-app');
const currentUserDisplay = document.getElementById('current-user-display');

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

const btnShowWorks = document.getElementById('btn-show-works');
const worksModal = document.getElementById('works-modal');
const btnCloseWorks = document.getElementById('btn-close-works');
const worksListContainer = document.getElementById('works-list-container');
let currentGalleryAudio = null;
let currentGalleryPlayBtn = null;

// iOS等での無音化を防ぐため、画面タップ時に確実にAudioを解除します
document.body.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}, true);

document.body.addEventListener('touchstart', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}, {passive: true, once: true});

if (btnChoiceFirst) {
    btnChoiceFirst.addEventListener('click', (e) => {
        e.preventDefault();
        if (modalInputTitle) modalInputTitle.innerText = "新しく登録するユーザー名を入力";
        if (modalStep1) modalStep1.style.display = 'none';
        if (modalStep2) modalStep2.style.display = 'block';
    });
}

if (btnChoiceReturn) {
    btnChoiceReturn.addEventListener('click', (e) => {
        e.preventDefault();
        if (modalInputTitle) modalInputTitle.innerText = "登録済みのユーザー名を入力";
        if (modalStep1) modalStep1.style.display = 'none';
        if (modalStep2) modalStep2.style.display = 'block';
    });
}

if (btnBackStep) {
    btnBackStep.addEventListener('click', (e) => {
        e.preventDefault();
        if (modalStep2) modalStep2.style.display = 'none';
        if (modalStep1) modalStep1.style.display = 'block';
    });
}

if (btnLogin) {
    btnLogin.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = inputUsername.value.trim();
        if (!username) { alert("ユーザー名を入力してください。"); return; }
        currentUser = username;
        
        if (userModal) userModal.style.display = 'none';
        if (mainApp) mainApp.style.display = 'block';
        if (currentUserDisplay) currentUserDisplay.innerText = currentUser;
        
        await initAudio(); // ログイン直後に確実にオーディオを起動
        startSyncTracks();
        checkExistingExport();
    });
}

// 作品一覧の表示・削除ロジック
if (btnShowWorks) {
    btnShowWorks.addEventListener('click', async () => {
        if (worksModal) worksModal.style.display = 'flex';
        if (worksListContainer) worksListContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">読み込み中...</div>';
        
        await loadGalleryWorks();
    });
}

async function loadGalleryWorks() {
    try {
        const snapshot = await db.collection("exports").orderBy("updatedAt", "desc").get();
        if (worksListContainer) worksListContainer.innerHTML = '';
        
        if (snapshot.empty) {
            if (worksListContainer) worksListContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">まだ作品がありません。</div>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const itemEl = document.createElement('div');
            itemEl.className = 'track-item';
            itemEl.style.borderBottom = '1px solid var(--line-color)';
            itemEl.style.padding = '12px 0';
            itemEl.style.alignItems = 'flex-start';
            
            // 自分の作品の場合のみ削除ボタンを表示
            const isOwn = (data.user === currentUser);
            const delBtnHTML = isOwn ? `<button class="action-btn gallery-delete-btn" data-id="${doc.id}" style="color:var(--danger); letter-spacing:0.1em; margin-left:12px;">削除</button>` : '';
            
            itemEl.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:4px; max-width:60%;">
                    <div class="track-name" style="font-size:0.75rem; letter-spacing:0.05em; color:var(--text-main); white-space:normal; overflow:visible;">${data.title || 'Untitled'}</div>
                    <div style="font-size:0.55rem; color:var(--text-muted); letter-spacing:0.05em;">by ${data.user}</div>
                </div>
                <div class="track-controls" style="flex-grow:0; gap: 0;">
                    <button class="action-btn gallery-play-btn" data-url="${data.url}" style="letter-spacing:0.2em;">再生</button>
                    ${delBtnHTML}
                </div>
            `;
            if (worksListContainer) worksListContainer.appendChild(itemEl);
        });

        document.querySelectorAll('.gallery-play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = e.target.getAttribute('data-url');
                
                if (currentGalleryAudio) {
                    currentGalleryAudio.pause();
                    if (currentGalleryPlayBtn) {
                        currentGalleryPlayBtn.innerText = '再生';
                        currentGalleryPlayBtn.classList.remove('active');
                    }
                }

                if (currentGalleryPlayBtn === e.target && currentGalleryAudio && !currentGalleryAudio.paused) {
                    currentGalleryAudio = null;
                    currentGalleryPlayBtn = null;
                    return;
                }

                currentGalleryAudio = new Audio(formalizeUrl(url));
                currentGalleryAudio.loop = true; 
                currentGalleryAudio.play();
                
                currentGalleryPlayBtn = e.target;
                currentGalleryPlayBtn.innerText = '停止';
                currentGalleryPlayBtn.classList.add('active');
                
                currentGalleryAudio.onended = () => {
                    if (currentGalleryPlayBtn) {
                        currentGalleryPlayBtn.innerText = '再生';
                        currentGalleryPlayBtn.classList.remove('active');
                    }
                    currentGalleryAudio = null;
                    currentGalleryPlayBtn = null;
                };
            });
        });

        // 削除ボタンのイベント処理
        document.querySelectorAll('.gallery-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(!confirm("この作品をクラウドから完全に削除しますか？")) return;
                const id = e.target.getAttribute('data-id');
                try {
                    await db.collection("exports").doc(id).delete();
                    await loadGalleryWorks(); // リストを再描画
                } catch(err) {
                    alert("削除に失敗しました。");
                }
            });
        });

    } catch (err) {
        console.error(err);
        if (worksListContainer) worksListContainer.innerHTML = '<div style="font-size:0.75rem; color:var(--danger);">読み込みに失敗しました。</div>';
    }
}

if (btnCloseWorks) {
    btnCloseWorks.addEventListener('click', () => {
        if (worksModal) worksModal.style.display = 'none';
        if (currentGalleryAudio) {
            currentGalleryAudio.pause();
            currentGalleryAudio = null;
            if (currentGalleryPlayBtn) {
                currentGalleryPlayBtn.innerText = '再生';
                currentGalleryPlayBtn.classList.remove('active');
                currentGalleryPlayBtn = null;
            }
        }
    });
}

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

function formalizeUrl(url) {
    if (!url) return "";
    return url.replace("http://", "https://");
}

function startSyncTracks() {
    db.collection("tracks")
      .where("user", "==", currentUser) 
      .onSnapshot(async (snapshot) => {
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
            if (!currentDocIds.includes(t.id)) {
                if (t.source) { try{t.source.stop()}catch(e){} }
            }
        });

        const sortedDocs = snapshot.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis() || 0;
            const bTime = b.data().createdAt?.toMillis() || 0;
            return aTime - bTime;
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
                        const elapsed = audioCtx.currentTime - startTime;
                        startTrackSource(existingTrack, elapsed);
                    }
                }
                if (existingTrack.gainNode) existingTrack.gainNode.gain.value = existingTrack.volume;
                if (existingTrack.source) existingTrack.source.loop = existingTrack.isLooping;
                
                return existingTrack;
            }

            let audioBuffer = null;
            if (audioCtx) {
                try {
                    const response = await fetch(safeUrl);
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                    }
                } catch (e) { console.error("Audio fetch error:", e); }
            }
            
            const newTrack = {
                id: id,
                name: data.name,
                url: safeUrl,
                storagePath: data.storagePath,
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
                    const elapsed = audioCtx.currentTime - startTime;
                    startTrackSource(newTrack, elapsed);
                }
            }
            return newTrack;
        });

        tracks = await Promise.all(loadPromises);
        renderUI();
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
                    } catch (e) { alert("保存失敗: ルール設定を確認してください。"); }
                    btnRecord.innerText = "録音を開始";
                };

                mediaRecorder.start();
                isRecording = true;
                btnRecord.innerText = "録音を停止";
                btnRecord.classList.add('recording');
            } catch (err) { alert("マイクへのアクセスが拒否されました。"); }
        } else {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
            isRecording = false;
            btnRecord.classList.remove('recording');
        }
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
        mixerEl.innerHTML = `
            <input type="text" class="track-name-input" data-id="${track.id}" value="${track.name}">
            <div class="track-controls">
                <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.id}">Loop: ${track.isLooping ? 'ON' : 'OFF'}</button>
                <div class="vol-slider-wrapper">
                    <input type="range" class="vol-slider" data-id="${track.id}" min="0" max="1" step="0.01" value="${track.volume}">
                </div>
                <button class="action-btn clone-btn" data-id="${track.id}">複製</button>
                <button class="action-btn delete-btn" data-id="${track.id}">削除</button>
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
        const deltaX = currentX - startX;
        let newDelay = initialDelay + (deltaX / PIXELS_PER_SEC);
        if (newDelay < 0) newDelay = 0;
        clipEl.style.left = `${newDelay * PIXELS_PER_SEC}px`;
    };

    const onEnd = async (e) => {
        if (!isDragging) return;
        isDragging = false;
        clipEl.style.zIndex = '';
        document.body.style.userSelect = '';
        
        const currentX = e.type.includes('mouse') ? e.clientX : e.changedTouches[0].clientX;
        const deltaX = currentX - startX;
        let newDelay = initialDelay + (deltaX / PIXELS_PER_SEC);
        if (newDelay < 0) newDelay = 0;
        
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
            const newName = e.target.value.trim();
            if (newName) {
                await db.collection("tracks").doc(id).update({ name: newName });
            }
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
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            if (t) {
                t.volume = parseFloat(e.target.value);
                if (t.gainNode) t.gainNode.gain.value = t.volume;
            }
        });
        slider.addEventListener('change', async e => {
            const id = e.target.getAttribute('data-id');
            await db.collection("tracks").doc(id).update({ volume: parseFloat(e.target.value) });
        });
    });

    document.querySelectorAll('.clone-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            if (!t) return;
            
            try {
                await db.collection("tracks").add({
                    user: currentUser,
                    name: `${t.name} c`,
                    url: t.url,
                    storagePath: t.storagePath || "",
                    isLooping: t.isLooping,
                    volume: t.volume,
                    delayTime: t.delayTime,
                    estimatedDuration: t.duration,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch(err) { alert("複製に失敗しました。"); }
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(!confirm("削除しますか？")) return;
            const id = e.target.getAttribute('data-id');
            try {
                await db.collection("tracks").doc(id).delete();
            } catch(err) {}
        });
    });
}

// 9. MASTER CONTROL ロジック
function startTrackSource(track, currentMasterElapsed = 0) {
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
            const bufDur = track.buffer.duration > 0 ? track.buffer.duration : 1;
            
            if (track.isLooping) {
                track.source.start(0, offset % bufDur);
            } else if (offset < bufDur) {
                track.source.start(0, offset);
            }
        }
    }
}

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
            for (let t of tracks) {
                if (!t.gainNode) {
                    t.gainNode = audioCtx.createGain();
                    t.gainNode.connect(dryGain);
                    t.gainNode.connect(wetGain);
                }
                t.gainNode.gain.value = t.volume;
                startTrackSource(t, 0);
            }
            updateProgress();
        } finally {
            isTransportBusy = false;
        }
    });
}

if (btnRewind) {
    btnRewind.addEventListener('click', () => {
        if (isTransportBusy) return;
        const wasPlaying = isMasterPlaying;
        tracks.forEach(t => { if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; } });
        cancelAnimationFrame(animationFrameId);
        isMasterPlaying = false;
        if (btnPlay) btnPlay.classList.remove('active');
        if (btnStop) btnStop.classList.remove('active');
        if (playheadEl) playheadEl.style.left = '0px';
        if (audioCtx) startTime = audioCtx.currentTime;
        if (wasPlaying) setTimeout(() => { if (btnPlay) btnPlay.click(); }, 50);
    });
}

if (btnStop) {
    btnStop.addEventListener('click', () => {
        isMasterPlaying = false;
        if (btnPlay) btnPlay.classList.remove('active');
        btnStop.classList.add('active');
        tracks.forEach(t => { 
            if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; } 
        });
        cancelAnimationFrame(animationFrameId);
        if (playheadEl) playheadEl.style.left = '0px';
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
    const now = audioCtx.currentTime;
    const elapsed = now - startTime;
    if (playheadEl) playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;
    const maxDur = tracks.length > 0 ? Math.max(...tracks.map(t => {
        const d = parseFloat(t.duration);
        const del = parseFloat(t.delayTime);
        return (isNaN(d) ? 5 : d) + (isNaN(del) ? 0 : del);
    })) : 0;
    
    if (maxDur > 0 && elapsed >= maxDur) {
        if (isMasterLooping) {
            startTime = audioCtx.currentTime;
            tracks.forEach(t => {
                if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; }
                startTrackSource(t, 0);
            });
        } else {
            isMasterPlaying = false;
            if (btnPlay) btnPlay.classList.remove('active');
            tracks.forEach(t => { if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; } });
            if (playheadEl) playheadEl.style.left = '0px';
        }
    }
}

// 10. 完成音源管理
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
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        outputAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';
    } catch(e) { console.error("Export load error:", e); }
}

if (btnExportMaster) {
    btnExportMaster.addEventListener('click', async () => {
        if (tracks.length === 0) { alert("トラックが存在しません。"); return; }
        const exportName = inputExportName.value.trim() || `Master_${currentUser}`;
        btnExportMaster.innerText = "音源を合成中...";
        btnExportMaster.disabled = true;
        try {
            await initAudio();
            const maxDur = Math.max(...tracks.map(t => {
                const d = parseFloat(t.duration);
                const del = parseFloat(t.delayTime);
                return (isNaN(d) ? 5 : d) + (isNaN(del) ? 0 : del);
            }));
            if (maxDur <= 0 || isNaN(maxDur)) { alert("有効な長さがありません。"); btnExportMaster.disabled = false; return; }
            let renderDuration = maxDur;
            if (!isMasterLooping) renderDuration += 2; 

            const sampleRate = audioCtx.sampleRate;
            const offlineCtx = new OfflineAudioContext(2, sampleRate * renderDuration, sampleRate);
            const offlineMasterGain = offlineCtx.createGain();
            offlineMasterGain.gain.value = 1.0;
            offlineMasterGain.connect(offlineCtx.destination);
            const offlineConvolver = offlineCtx.createConvolver();
            offlineConvolver.buffer = createReverbBuffer(offlineCtx, 3.0, 2.0);
            const offlineDryGain = offlineCtx.createGain();
            const offlineWetGain = offlineCtx.createGain();
            offlineDryGain.connect(offlineMasterGain);
            offlineWetGain.connect(offlineConvolver);
            offlineConvolver.connect(offlineMasterGain);
            const wetVal = parseFloat(reverbSlider.value);
            offlineWetGain.gain.value = wetVal;
            offlineDryGain.gain.value = 1.0 - (wetVal * 0.5);

            tracks.forEach(t => {
                if (!t.buffer) return;
                const source = offlineCtx.createBufferSource();
                source.buffer = t.buffer;
                source.loop = t.isLooping;
                const gain = offlineCtx.createGain();
                gain.gain.value = t.volume;
                source.connect(gain);
                gain.connect(offlineDryGain);
                gain.connect(offlineWetGain);
                if (t.isLooping) {
                    source.start(t.delayTime);
                } else {
                    source.start(t.delayTime);
                    source.stop(t.delayTime + t.buffer.duration);
                }
            });
            const renderedBuffer = await offlineCtx.startRendering();
            const wavBlob = bufferToWavBlob(renderedBuffer);
            const storagePath = `exports/${exportName}_${Date.now()}.mp3`;
            const snapshot = await storage.ref().child(storagePath).put(wavBlob);
            const downloadUrl = await snapshot.ref.getDownloadURL();
            await db.collection("exports").doc(currentUser).set({ user: currentUser, title: exportName, url: downloadUrl, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            outputAudioBuffer = renderedBuffer;
            if (outputFileDisplay) outputFileDisplay.innerText = exportName;
            if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';
            alert("クラウド保存完了");
        } catch (err) { alert("合成失敗"); } finally { btnExportMaster.innerText = "作品を完成させる"; btnExportMaster.disabled = false; }
    });
}

// 停止・再生の同期を確実にするための修正版ダウンロード・ループ
if (btnOutputDownload) btnOutputDownload.addEventListener('click', () => {
    if (!outputAudioBuffer) return;
    const wavBlob = bufferToWavBlob(outputAudioBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${inputExportName.value.trim() || "master"}.mp3`;
    a.click();
    URL.revokeObjectURL(url);
});

if (btnOutputLoop) btnOutputLoop.addEventListener('click', () => {
    isOutputLooping = !isOutputLooping;
    btnOutputLoop.innerText = `Loop: ${isOutputLooping ? 'ON' : 'OFF'}`;
    btnOutputLoop.classList.toggle('active', isOutputLooping);
    if (outputAudioSource) outputAudioSource.loop = isOutputLooping;
});

if (btnOutputPlay) btnOutputPlay.addEventListener('click', () => {
    if (!outputAudioBuffer) return;
    if (outputAudioSource) { try{outputAudioSource.stop()}catch(e){} }
    if (isMasterPlaying) btnStop.click();
    outputAudioSource = audioCtx.createBufferSource();
    outputAudioSource.buffer = outputAudioBuffer;
    outputAudioSource.loop = isOutputLooping;
    outputAudioSource.connect(audioCtx.destination);
    outputAudioSource.onended = () => {
        if (btnOutputPlay) { btnOutputPlay.classList.remove('active'); btnOutputPlay.innerText = "再生"; }
    };
    outputAudioSource.start(0);
    btnOutputPlay.classList.add('active');
    btnOutputPlay.innerText = "停止"; // 再生中に「停止」表記へ変更
});

if (btnOutputStop) btnOutputStop.addEventListener('click', () => {
    if (outputAudioSource) { try{outputAudioSource.stop()}catch(e){} outputAudioSource = null; }
    if (btnOutputPlay) { btnOutputPlay.classList.remove('active'); btnOutputPlay.innerText = "再生"; }
});

function bufferToWavBlob(buffer) { /* (前述の関数をそのまま維持) */ }
    const numOfChan = buffer.numberOfChannels,
          length = buffer.length * numOfChan * 2 + 44,
          bufferArr = new ArrayBuffer(length),
          view = new DataView(bufferArr),
          channels = [];

    let pos = 0;
    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952); 
    setUint32(length - 8); 
    setUint32(0x45564157); 

    setUint32(0x20746d66); 
    setUint32(16); 
    setUint16(1); 
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); 
    setUint16(numOfChan * 2); 
    setUint16(16); 

    setUint32(0x61746164); 
    setUint32(length - pos - 4); 

    for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));

    let localOffset = 0;
    while (pos < length) {
        for (let i = 0; i < numOfChan; i++) {
            let sample = Math.max(-1, Math.min(1, channels[i][localOffset]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        localOffset++;
    }
    return new Blob([bufferArr], { type: 'audio/mp3' });
}
