const firebaseConfig = {
    apiKey: "AIzaSyCwBqi08ShVjJ90Mku2NsXJK0E03p4CsT4",
    authDomain: "kaiga-wo-kiku.firebaseapp.com",
    projectId: "kaiga-wo-kiku",
    storageBucket: "kaiga-wo-kiku.firebasestorage.app",
    messagingSenderId: "1098905292525",
    appId: "1:1098905292525:web:48094a6dea59178c4186e4"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

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

const btnRecord = document.getElementById('btn-record');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnMasterLoop = document.getElementById('btn-master-loop');
const reverbSlider = document.getElementById('master-reverb');
const trackListEl = document.getElementById('track-list');
const emptyMsg = document.getElementById('empty-msg');
const timelineTracksEl = document.getElementById('timeline-tracks');
const playheadEl = document.getElementById('playhead');
const timelineContainerEl = document.getElementById('timeline-container');

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

function formalizeUrl(url) { return url ? url.replace("http://", "https://") : ""; }

// Firestoreのリアルタイム同期
db.collection("tracks").orderBy("createdAt", "asc").onSnapshot(async (snapshot) => {
    tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} } });
    
    if (snapshot.empty) {
        emptyMsg.style.display = 'block';
        trackListEl.innerHTML = '';
        timelineTracksEl.innerHTML = '';
        tracks = [];
        return;
    }
    emptyMsg.style.display = 'none';
    
    const loadPromises = snapshot.docs.map(async (docSnapshot) => {
        const data = docSnapshot.data();
        const safeUrl = formalizeUrl(data.url);
        let audioBuffer = null;
        
        if (audioCtx) {
            try {
                const response = await fetch(safeUrl);
                const arrayBuffer = await response.arrayBuffer();
                audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            } catch (e) { console.error("Audio error:", e); }
        }
        
        return {
            id: docSnapshot.id,
            name: data.name,
            url: safeUrl,
            storagePath: data.storagePath,
            buffer: audioBuffer,
            source: null,
            gainNode: audioCtx ? audioCtx.createGain() : null, // まだ再生ボタンを押していない時はnullになる
            isLooping: data.isLooping !== undefined ? data.isLooping : true,
            volume: data.volume !== undefined ? data.volume : 1.0,
            delayTime: data.delayTime !== undefined ? data.delayTime : 0,
            duration: audioBuffer ? audioBuffer.duration : (data.estimatedDuration || 5)
        };
    });

    tracks = await Promise.all(loadPromises);
    
    // 再生中のスナップショット更新対応
    if (audioCtx) {
        tracks.forEach(t => {
            if (!t.gainNode) {
                t.gainNode = audioCtx.createGain();
            }
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
                            name: `Track ${String(timestamp).substring(9, 13)}`,
                            url: downloadUrl,
                            storagePath: storagePath,
                            isLooping: true,
                            volume: 1.0,
                            delayTime: 0,
                            estimatedDuration: estimatedDur,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    } catch (e) { alert("保存失敗"); }
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
    trackListEl.innerHTML = '';
    timelineTracksEl.innerHTML = '';
    
    let maxTimelineWidth = 600;

    tracks.forEach((track) => {
        const mixerEl = document.createElement('div');
        mixerEl.className = 'track-item';
        mixerEl.innerHTML = `
            <div class="track-name">${track.name}</div>
            <div class="track-controls">
                <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.id}">Loop</button>
                <div class="slider-wrapper" style="flex-grow:1; max-width: 150px;">
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
        clipEl.innerText = track.name;
        
        const leftPx = track.delayTime * PIXELS_PER_SEC;
        const widthPx = track.duration * PIXELS_PER_SEC;
        clipEl.style.left = `${leftPx}px`;
        clipEl.style.width = `${Math.max(widthPx, 20)}px`;
        
        if (leftPx + widthPx > maxTimelineWidth) maxTimelineWidth = leftPx + widthPx + 100;

        setupDraggableClip(clipEl, track);

        rowEl.appendChild(clipEl);
        timelineTracksEl.appendChild(rowEl);
    });

    timelineContainerEl.style.width = `${maxTimelineWidth}px`;
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
    if (!track.buffer) return;
    if (track.source) { try { track.source.stop(); } catch(e){} }
    if (!track.gainNode) return; // 回路がない場合はエラー回避

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
        await initAudio(); // ここでAudioContextが確実に作られる
        
        if (isMasterPlaying) return;
        isMasterPlaying = true;
        
        btnPlay.classList.add('active');
        btnStop.classList.remove('active');

        startTime = audioCtx.currentTime;

        // 再生前にすべての回路と音源データが揃っているか確認・補完する処理
        for (let t of tracks) {
            if (!t.buffer) {
                try {
                    const res = await fetch(t.url);
                    const arr = await res.arrayBuffer();
                    t.buffer = await audioCtx.decodeAudioData(arr);
                    t.duration = t.buffer.duration;
                } catch(e) { console.error("Fetch error:", e); }
            }
            if (!t.gainNode) {
                t.gainNode = audioCtx.createGain();
                t.gainNode.connect(dryGain);
                t.gainNode.connect(wetGain);
                t.gainNode.gain.value = t.volume;
            }
            startTrackSource(t, 0);
        }

        masterGain.gain.cancelScheduledValues(startTime);
        masterGain.gain.setValueAtTime(masterGain.gain.value, startTime);
        masterGain.gain.linearRampToValueAtTime(1, startTime + 0.8);
        
        renderUI();
        updateProgress();
    });
}

if (btnStop) {
    btnStop.addEventListener('click', () => {
        if (!isMasterPlaying) return;
        isMasterPlaying = false;
        
        btnPlay.classList.remove('active');
        btnStop.classList.add('active');

        const now = audioCtx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.linearRampToValueAtTime(0, now + 1.2);

        setTimeout(() => {
            tracks.forEach(t => { if (t.source) { try { t.source.stop(); } catch(e){} t.source = null; } });
            cancelAnimationFrame(animationFrameId);
            playheadEl.style.left = '0px';
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

    playheadEl.style.left = `${elapsed * PIXELS_PER_SEC}px`;

    const scrollRightEdge = timelineContainerEl.parentElement.scrollLeft + timelineContainerEl.parentElement.clientWidth;
    if ((elapsed * PIXELS_PER_SEC) > scrollRightEdge - 50) {
        timelineContainerEl.parentElement.scrollLeft += 200;
    }

    if (!isMasterLooping && tracks.length > 0) {
        const maxDur = Math.max(...tracks.map(t => (t.duration + t.delayTime)));
        if (elapsed >= maxDur) {
            btnStop.click();
            return;
        }
    }
    animationFrameId = requestAnimationFrame(updateProgress);
}
