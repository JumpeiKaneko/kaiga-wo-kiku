// --- Firebase 設定（コンソールから取得した値をここに貼り付けます） ---
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Firebase 初期化
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

// --- オーディオシステム変数 ---
let audioCtx;
let masterGain;
let convolver;
let dryGain, wetGain;

// --- 録音用変数 ---
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// --- アプリケーション状態 ---
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

// --- リアルタイムにクラウド（Firestore）からトラック一覧を同期 ---
db.collection("tracks").orderBy("createdAt", "asc").onSnapshot(async (snapshot) => {
    // 既存のソースを一度すべて停止
    tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} } });
    
    tracks = [];
    
    if (snapshot.empty) {
        emptyMsg.style.display = 'block';
        emptyMsg.innerText = 'クラウドに録音されたトラックはありません';
        trackListEl.innerHTML = '';
        return;
    }

    emptyMsg.style.display = 'none';
    
    // クラウド上のデータを配列に格納
    const loadPromises = snapshot.docs.map(async (doc) => {
        const data = doc.data();
        
        // すでにオーディオコンテキストがあれば、URLからバイナリデータを取得してデコード
        let audioBuffer = null;
        if (audioCtx) {
            const response = await fetch(data.url);
            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
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
    
    // 再接続ルーティング
    if (audioCtx) {
        tracks.forEach(t => {
            if (t.gainNode) {
                t.gainNode.connect(dryGain);
                t.gainNode.connect(wetGain);
                if (isMasterPlaying) {
                    startTrackSource(t, 0);
                }
            }
        });
    }

    renderTracks();
});

// --- 録音とインターネット（クラウド）保存 ---
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
                btnRecord.innerText = "クラウドに保存中...";
                const blob = new Blob(recordedChunks, { type: 'audio/webm' });
                
                const filename = `track_${Date.now()}.webm`;
                const storageRef = storage.ref().child(`audios/${filename}`);
                
                // 1. クラウドストレージに音声ファイルをアップロード
                const uploadTask = await storageRef.put(blob);
                const downloadUrl = await uploadTask.ref.getDownloadURL();
                
                // 2. データベースにメタデータを保存して全体に共有
                await db.collection("tracks").add({
                    name: `Track_${filename.split('_')[1].split('.')[0]}`,
                    url: downloadUrl,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

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
    tracks.forEach((track, index) => {
        const el = document.createElement('div');
        el.className = 'track-item';
        el.innerHTML = `
            <div class="track-header">
                <div class="track-name">${track.name}</div>
                <button class="delete-btn" data-id="${track.id}">クラウドから削除</button>
            </div>
            <div class="control-row" style="margin-bottom:0;">
                <button class="loop-btn ${track.isLooping ? 'active' : ''}" data-id="${track.id}">
                    Loop: ${track.isLooping ? 'ON' : 'OFF'}
                </button>
                <div class="slider-wrapper">
                    <label>Volume</label>
                    <input type="range" class="vol-slider" data-id="${track.id}" min="0" max="1" step="0.01" value="${track.volume}">
                </div>
            </div>
            <div class="progress-container">
                <div class="progress-bar" id="prog_${track.id}"></div>
            </div>
        `;
        trackListEl.appendChild(el);
    });

    // リスナー登録
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
            if(!confirm("クラウドからこの音源を完全に削除しますか？")) return;
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            
            try {
                // データベースとストレージ両方から削除
                await db.collection("tracks").doc(id).delete();
                const fileRef = storage.refFromURL(t.url);
                await fileRef.delete();
            } catch(err) {
                console.error("削除エラー:", err);
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

// --- マスターコントロール ---
btnPlay.addEventListener('click', async () => {
    if (tracks.length === 0) return;
    await initAudio();
    
    if (isMasterPlaying) return;
    isMasterPlaying = true;
    
    btnPlay.classList.add('active');
    btnStop.classList.remove('active');

    // 再生時に各トラックのオーディオノードの接続とデコード処理を確定させる
    for (let t of tracks) {
        if (!t.buffer) {
            const response = await fetch(t.url);
            const arrayBuffer = await response.arrayBuffer();
            t.buffer = await audioCtx.decodeAudioData(arrayBuffer);
            t.duration = t.buffer.duration;
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