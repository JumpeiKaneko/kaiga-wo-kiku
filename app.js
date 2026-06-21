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

const PIXELS_PER_SEC = 30; 

const userModal = document.getElementById('user-modal');
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

if (btnLogin) {
    btnLogin.addEventListener('click', () => {
        const username = inputUsername.value.trim();
        if (!username) { alert("ユーザー名を入力してください。"); return; }
        currentUser = username;
        userModal.style.display = 'none';
        mainApp.style.display = 'block';
        currentUserDisplay.innerText = currentUser;
        
        startSyncTracks();
    });
}

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
      .orderBy("createdAt", "asc")
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
        
        const loadPromises = snapshot.docs.map(async (docSnapshot) => {
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
            t.volume = parseFloat(e.target.value);
            if (t.gainNode) t.gainNode.gain.value = t.volume;
        });
        slider.addEventListener('change', async e => {
            const id = e.target.getAttribute('data-id');
            await db.collection("tracks").doc(id).update({ volume: parseFloat(e.target.value) });
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(!confirm("削除しますか？")) return;
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            try {
                await db.collection("tracks").doc(id).delete();
                if (t.storagePath) await storage.ref().child(t.storagePath).delete();
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
    if (!isMasterPlaying) return;
    const now = audioCtx.currentTime;
    const elapsed = now - startTime;

    if (playheadEl) playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;

    if (!isMasterLooping && tracks.length > 0) {
        const maxDur = Math.max(...tracks.map(t => (t.duration + t.delayTime)));
        if (elapsed >= maxDur) {
            if (btnStop) btnStop.click();
            return;
        }
    }
    animationFrameId = requestAnimationFrame(updateProgress);
}
