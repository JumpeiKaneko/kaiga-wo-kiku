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

let outputAudioBuffer = null;
let outputAudioSource = null;

const PIXELS_PER_SEC = 30; 

// HTMLが完全に読み込まれてからボタンのイベントを確実にバインドする
window.addEventListener('DOMContentLoaded', () => {
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

    if (btnChoiceFirst) {
        btnChoiceFirst.addEventListener('click', (e) => {
            e.preventDefault();
            if (modalInputTitle && modalStep1 && modalStep2) {
                modalInputTitle.innerText = "新しく登録するユーザー名を入力";
                modalStep1.style.display = 'none';
                modalStep2.style.display = 'block';
            }
        });
    }

    if (btnChoiceReturn) {
        btnChoiceReturn.addEventListener('click', (e) => {
            e.preventDefault();
            if (modalInputTitle && modalStep1 && modalStep2) {
                modalInputTitle.innerText = "登録済みのユーザー名を入力";
                modalStep1.style.display = 'none';
                modalStep2.style.display = 'block';
            }
        });
    }

    if (btnBackStep) {
        btnBackStep.addEventListener('click', (e) => {
            e.preventDefault();
            if (modalStep1 && modalStep2) {
                modalStep2.style.display = 'none';
                modalStep1.style.display = 'block';
            }
        });
    }

    if (btnLogin) {
        btnLogin.addEventListener('click', (e) => {
            e.preventDefault();
            const username = inputUsername.value.trim();
            if (!username) { alert("ユーザー名を入力してください。"); return; }
            currentUser = username;
            if (userModal && mainApp && currentUserDisplay) {
                userModal.style.display = 'none';
                mainApp.style.display = 'block';
                currentUserDisplay.innerText = currentUser;
                
                startSyncTracks();
                checkExistingExport();
            }
        });
    }
});

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
const btnOutputPlay = document.getElementById('btn-output-play');
const btnOutputStop = document.getElementById('btn-output-stop');

async function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0;
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
    if (!dryGain || !wetGain) return;
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
        tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} } });
        
        if (snapshot.empty) {
            if(emptyMsg) emptyMsg.style.display = 'block';
            if(trackListEl) trackListEl.innerHTML = '';
            if(timelineTracksEl) timelineTracksEl.innerHTML = '';
            tracks = [];
            return;
        }
        if(emptyMsg) emptyMsg.style.display = 'none';
        
        const sortedDocs = snapshot.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis() || 0;
            const bTime = b.data().createdAt?.toMillis() || 0;
            return aTime - bTime;
        });
        
        const loadPromises = sortedDocs.map(async (docSnapshot) => {
            const data = docSnapshot.data();
            const safeUrl = formalizeUrl(data.url);
            let audioBuffer = null;
            
            if (audioCtx) {
                try {
                    const response = await fetch(safeUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                } catch (e) { console.error("Audio fetch error:", e); }
            }
            
            return {
                id: docSnapshot.id,
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
        });

        tracks = await Promise.all(loadPromises);
        
        if (audioCtx) {
            tracks.forEach(t => {
                if (!t.gainNode) t.gainNode = audioCtx.createGain();
                t.gainNode.connect(dryGain);
                t.gainNode.connect(wetGain);
                t.gainNode.gain.value = t.volume;
                
                if (isMasterPlaying) {
                    const elapsed = audioCtx.currentTime - startTime;
                    startTrackSource(t, elapsed);
                }
            });
        }
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
    const trackListEl = document.getElementById('track-list');
    const timelineTracksEl = document.getElementById('timeline-tracks');
    if (!trackListEl || !timelineTracksEl) return;
    trackListEl.innerHTML = '';
    timelineTracksEl.innerHTML = '';
    
    let maxTimelineWidth = 600;

    tracks.forEach((track) => {
        const mixerEl = document.createElement('div');
        mixerEl.className = 'track-item';
        mixerEl.innerHTML = `
            <div class="track-name">${track.name}</div>
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

    const timelineContainerEl = document.getElementById('timeline-container');
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
    document.querySelectorAll('.loop-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            await db.collection("tracks").doc(id).update({ isLooping: !t.isLooping });
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
            
            const timestamp = Date.now();
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
            const offset = now - targetStartTime;
            if (track.isLooping) {
                track.source.start(0, offset % track.buffer.duration);
            } else if (offset < track.buffer.duration) {
                track.source.start(0, offset);
            }
        }
    }
}

if (btnPlay) {
    btnPlay.addEventListener('click', async () => {
        if (tracks.length === 0) return;
        await initAudio();
        
        if (isMasterPlaying) return;
        isMasterPlaying = true;
        
        btnPlay.classList.add('active');
        if (btnStop) btnStop.classList.remove('active');

        startTime = audioCtx.currentTime;

        for (let t of tracks) {
            if (!t.buffer) {
                try {
                    const response = await fetch(t.url);
                    const arrayBuffer = await response.arrayBuffer();
                    t.buffer = await audioCtx.decodeAudioData(arrayBuffer);
                    t.duration = t.buffer.duration;
                } catch(e) { console.error(e); }
            }
            if (!t.gainNode) {
                t.gainNode = audioCtx.createGain();
                t.gainNode.connect(dryGain);
                t.gainNode.connect(wetGain);
            }
            t.gainNode.gain.value = t.volume;
            startTrackSource(t, 0);
        }

        masterGain.gain.cancelScheduledValues(startTime);
        masterGain.gain.setValueAtTime(masterGain.gain.value, startTime);
        masterGain.gain.linearRampToValueAtTime(1, startTime + 0.8);
        
        updateProgress();
    });
}

if (btnRewind) {
    btnRewind.addEventListener('click', () => {
        const wasPlaying = isMasterPlaying;
        if (btnStop) btnStop.click();
        
        tracks.forEach(t => { if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; } });
        cancelAnimationFrame(animationFrameId);
        const playheadEl = document.getElementById('playhead');
        if (playheadEl) playheadEl.style.left = '0px';
        
        if (audioCtx) startTime = audioCtx.currentTime;

        if (wasPlaying) {
            setTimeout(() => { if (btnPlay) btnPlay.click(); }, 100);
        }
    });
}

if (btnStop) {
    btnStop.addEventListener('click', () => {
        if (!isMasterPlaying) return;
        isMasterPlaying = false;
        
        if (btnPlay) btnPlay.classList.remove('active');
        btnStop.classList.add('active');

        const now = audioCtx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.linearRampToValueAtTime(0, now + 1.2);

        setTimeout(() => {
            tracks.forEach(t => { if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; } });
            cancelAnimationFrame(animationFrameId);
            const playheadEl = document.getElementById('playhead');
            if (playheadEl) playheadEl.style.left = '0px';
        }, 1200);
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

    const playheadEl = document.getElementById('playhead');
    if (playheadEl) playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;

    if (!isMasterLooping && tracks.length > 0) {
        const maxDur = Math.max(...tracks.map(t => (t.duration + t.delayTime)));
        if (elapsed >= maxDur) {
            if (btnStop) btnStop.click();
            return;
        }
    }
}

function checkExistingExport() {
    db.collection("exports").doc(currentUser).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
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
        const outputPlayerContainer = document.getElementById('output-player-container');
        if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';
    } catch(e) { console.error("Export load error:", e); }
}

if (btnExportMaster) {
    btnExportMaster.addEventListener('click', async () => {
        if (tracks.length === 0) { alert("トラックが存在しません。"); return; }
        btnExportMaster.innerText = "音源を合成中...";
        btnExportMaster.disabled = true;

        try {
            await initAudio();
            
            let renderDuration = 45;
            if (!isMasterLooping) {
                const maxDur = Math.max(...tracks.map(t => (t.duration + t.delayTime)));
                renderDuration = Math.max(maxDur + 2, 5); 
            }

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
            
            const storagePath = `exports/master_${currentUser}.mp3`;
            const storageRef = storage.ref().child(storagePath);
            const snapshot = await storageRef.put(wavBlob);
            const downloadUrl = await snapshot.ref.getDownloadURL();

            await db.collection("exports").doc(currentUser).set({
                user: currentUser,
                url: downloadUrl,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            outputAudioBuffer = renderedBuffer;
            const outputPlayerContainer = document.getElementById('output-player-container');
            if (outputPlayerContainer) outputPlayerContainer.style.display = 'block';
            alert("完成しました。下のプレイヤーでいつでも試聴可能です。");

        } catch (err) {
            console.error(err);
            alert("合成に失敗しました。");
        } finally {
            btnExportMaster.innerText = "作品を完成させる";
            btnExportMaster.disabled = false;
        }
    });
}

if (btnOutputPlay) {
    btnOutputPlay.addEventListener('click', () => {
        if (!outputAudioBuffer) return;
        if (outputAudioSource) { try{outputAudioSource.stop()}catch(e){} }
        
        if (isMasterPlaying) if (btnStop) btnStop.click();

        outputAudioSource = audioCtx.createBufferSource();
        outputAudioSource.buffer = outputAudioBuffer;
        outputAudioSource.connect(audioCtx.destination);
        outputAudioSource.start(0);
        
        btnOutputPlay.classList.add('active');
    });
}

if (btnOutputStop) {
    btnOutputStop.addEventListener('click', () => {
        if (outputAudioSource) {
            try{outputAudioSource.stop()}catch(e){}
            outputAudioSource = null;
        }
        btnOutputPlay.classList.remove('active');
    });
}

function bufferToWavBlob(buffer) {
    const numOfChan = buffer.numberOfChannels,
          length = buffer.length * numOfChan * 2 + 44,
          bufferArr = new ArrayBuffer(length),
          view = new DataView(bufferArr),
          channels = [], 
          offset = 0;

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
