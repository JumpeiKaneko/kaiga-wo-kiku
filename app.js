// スクリーンショットから取得した正確な構成情報を反映
const firebaseConfig = {
    apiKey: "AIzaSyCwBqi08ShVjJ90Mku2NsXJK0E03p4CsT4",
    authDomain: "kaiga-wo-kiku.firebaseapp.com",
    projectId: "kaiga-wo-kiku",
    storageBucket: "kaiga-wo-kiku.firebasestorage.app",
    messagingSenderId: "1098905292525",
    appId: "1:1098905292525:web:48094a6dea59178c4186e4"
};

// Firebaseの初期起動
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

let audioCtx;
let masterGain;
let convolver;
let dryGain, wetGain;

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

let tracks = [];
let isMasterPlaying = false;
let isMasterLooping = true;
let startTime = 0;
let animationFrameId;

const btnRecord = document.getElementById('btn-record');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnMasterLoop = document.getElementById('btn-master-loop');
const reverbSlider = document.getElementById('master-reverb');
const trackListEl = document.getElementById('track-list');
const emptyMsg = document.getElementById('empty-msg');

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
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
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
    if (!dryGain || !wetGain) return;
    const wetVal = parseFloat(reverbSlider.value);
    wetGain.gain.value = wetVal;
    dryGain.gain.value = 1.0 - (wetVal * 0.5);
}
reverbSlider.addEventListener('input', updateReverb);

// クラウドデータの監視とリアルタイムレンダリング
db.collection("tracks").orderBy("createdAt", "asc").onSnapshot(async (snapshot) => {
    tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} } });
    tracks = [];
    
    if (snapshot.empty) {
        emptyMsg.style.display = 'block';
        emptyMsg.innerText = 'No tracks available';
        trackListEl.innerHTML = '';
        return;
    }

    emptyMsg.style.display = 'none';
    
    const loadPromises = snapshot.docs.map(async (doc) => {
        const data = doc.data();
        let audioBuffer = null;
        if (audioCtx) {
            try {
                const response = await fetch(data.url);
                const arrayBuffer = await response.arrayBuffer();
                audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            } catch (e) {
                console.error("Audio fetch error:", e);
            }
        }

        return {
            id: doc.id,
            name: data.name,
            url: data.url,
            buffer: audioBuffer,
            source: null,
            gainNode: audioCtx ? audioCtx.createGain() : null,
            isLooping: true,
            volume: 1.0,
            duration: audioBuffer ? audioBuffer.duration : 0
        };
    });

    tracks = await Promise.all(loadPromises);
    
    if (audioCtx) {
        tracks.forEach(t => {
            if (t.gainNode) {
                t.gainNode.connect(dryGain);
                t.gainNode.connect(wetGain);
                if (isMasterPlaying) startTrackSource(t, 0);
            }
        });
    }

    renderTracks();
});

// マイク入力からクラウドストレージへのパイプライン
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
                const filename = `track_${timestamp}.webm`;
                const storageRef = storage.ref().child(`audios/${filename}`);
                
                try {
                    const uploadTask = await storageRef.put(blob);
                    const downloadUrl = await uploadTask.ref.getDownloadURL();
                    
                    await db.collection("tracks").add({
                        name: `Track ${String(timestamp).substring(9, 13)}`,
                        url: downloadUrl,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                } catch (e) {
                    alert("クラウド保存に失敗しました。FirestoreとStorageのテストモード有効化を確認してください。");
                    console.error(e);
                }

                btnRecord.innerText = "録音を開始";
            };

            mediaRecorder.start();
            isRecording = true;
            btnRecord.innerText = "録音を停止";
            btnRecord.classList.add('recording');
        } catch (err) {
            alert("マイクへのアクセスに失敗しました。");
        }
    } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        isRecording = false;
        btnRecord.classList.remove('recording');
    }
});

function renderTracks() {
    trackListEl.innerHTML = '';
    tracks.forEach((track) => {
        const el = document.createElement('div');
        el.className = 'track-item';
        el.innerHTML = `
            <div class="track-header">
                <div class="track-name">${track.name}</div>
                <div class="track-actions">
                    <button class="action-btn delete-btn" data-id="${track.id}">削除</button>
                </div>
            </div>
            <div class="control-row" style="margin-bottom:0; gap: 20px;">
                <button class="action-btn loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.id}">
                    Loop: ${track.isLooping ? 'ON' : 'OFF'}
                </button>
                <div class="slider-wrapper">
                    <input type="range" class="vol-slider" data-id="${track.id}" min="0" max="1" step="0.01" value="${track.volume}">
                </div>
            </div>
            <div class="progress-container">
                <div class="progress-bar" id="prog_${track.id}"></div>
            </div>
        `;
        trackListEl.appendChild(el);
    });

    document.querySelectorAll('.loop-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            t.isLooping = !t.isLooping;
            e.target.innerText = `Loop: ${t.isLooping ? 'ON' : 'OFF'}`;
            e.target.classList.toggle('active', t.isLooping);
            if (t.source) t.source.loop = t.isLooping;
        });
    });

    document.querySelectorAll('.vol-slider').forEach(slider => {
        slider.addEventListener('input', e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            t.volume = parseFloat(e.target.value);
            if (t.gainNode) t.gainNode.gain.value = t.volume;
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(!confirm("クラウドから完全に削除しますか？")) return;
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            
            try {
                await db.collection("tracks").doc(id).delete();
                const fileRef = storage.refFromURL(t.url);
                await fileRef.delete();
            } catch(err) {
                console.error(err);
            }
        });
    });
}

function startTrackSource(track, offset = 0) {
    if (!track.buffer) return;
    if (track.source) {
        try { track.source.stop(); } catch(e){}
    }
    track.source = audioCtx.createBufferSource();
    track.source.buffer = track.buffer;
    track.source.loop = track.isLooping;
    track.source.connect(track.gainNode);
    track.source.start(0, offset);
}

btnPlay.addEventListener('click', async () => {
    if (tracks.length === 0) return;
    await initAudio();
    
    if (isMasterPlaying) return;
    isMasterPlaying = true;
    
    btnPlay.classList.add('active');
    btnStop.classList.remove('active');

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
        startTrackSource(t);
    }

    const now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(1, now + 0.8);

    startTime = now;
    updateProgress();
});

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
        tracks.forEach(t => {
            if (t.source) {
                try { t.source.stop(); } catch(e){}
                t.source = null;
            }
        });
        cancelAnimationFrame(animationFrameId);
        document.querySelectorAll('.progress-bar').forEach(el => el.style.width = '0%');
    }, 1200);
});

btnMasterLoop.addEventListener('click', () => {
    isMasterLooping = !isMasterLooping;
    btnMasterLoop.classList.toggle('active', isMasterLooping);
    btnMasterLoop.innerText = `全体ループ: ${isMasterLooping ? 'ON' : 'OFF'}`;
    
    tracks.forEach(t => {
        t.isLooping = isMasterLooping;
        if (t.source) t.source.loop = isMasterLooping;
    });
    renderTracks();
});

function updateProgress() {
    if (!isMasterPlaying) return;

    const now = audioCtx.currentTime;
    const elapsed = now - startTime;

    tracks.forEach(t => {
        const el = document.getElementById(`prog_${t.id}`);
        if (el && t.duration > 0) {
            const current = t.isLooping ? (elapsed % t.duration) : Math.min(elapsed, t.duration);
            const percent = (current / t.duration) * 100;
            el.style.width = `${percent}%`;
        }
    });

    if (!isMasterLooping && tracks.length > 0) {
        const maxDur = Math.max(...tracks.map(t => t.duration));
        if (elapsed >= maxDur) {
            btnStop.click();
            return;
        }
    }

    animationFrameId = requestAnimationFrame(updateProgress);
}
