import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCwBqi08ShVjJ90Mku2NsXJK0E03p4CsT4",
    authDomain: "kaiga-wo-kiku.firebaseapp.com",
    projectId: "kaiga-wo-kiku",
    storageBucket: "kaiga-wo-kiku.firebasestorage.app",
    messagingSenderId: "1098905292525",
    appId: "1:1098905292525:web:48094a6dea59178c4186e4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

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

function formalizeUrl(url) {
    if (!url) return "";
    return url.replace("http://", "https://");
}

const q = query(collection(db, "tracks"), orderBy("createdAt", "asc"));
onSnapshot(q, async (snapshot) => {
    tracks.forEach(t => { if (t.source) { try{t.source.stop()}catch(e){} } });
    
    if (snapshot.empty) {
        emptyMsg.style.display = 'block';
        emptyMsg.innerText = 'クラウドに録音されたトラックはありません';
        trackListEl.innerHTML = '';
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
            } catch (e) {
                console.error("Audio download / decode error:", e);
            }
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
            duration: audioBuffer ? audioBuffer.duration : 0
        };
    });

    tracks = await Promise.all(loadPromises);
    
    if (audioCtx && isMasterPlaying) {
        const elapsed = audioCtx.currentTime - startTime;
        tracks.forEach(t => {
            if (t.gainNode) {
                t.gainNode.connect(dryGain);
                t.gainNode.connect(wetGain);
                t.gainNode.gain.value = t.volume;
                startTrackSource(t, elapsed);
            }
        });
    } else if (audioCtx) {
        tracks.forEach(t => {
            if (t.gainNode) {
                t.gainNode.connect(dryGain);
                t.gainNode.connect(wetGain);
                t.gainNode.gain.value = t.volume;
            }
        });
    }
    renderTracks();
});

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
                const storagePath = `audios/track_${timestamp}.webm`;
                const storageRef = ref(storage, storagePath);
                
                try {
                    await uploadBytes(storageRef, blob, { contentType: 'audio/webm' });
                    const downloadUrl = await getDownloadURL(storageRef);
                    
                    await addDoc(collection(db, "tracks"), {
                        name: `Track ${String(timestamp).substring(9, 13)}`,
                        url: downloadUrl,
                        storagePath: storagePath,
                        isLooping: true,
                        volume: 1.0,
                        delayTime: 0,
                        createdAt: new Date()
                    });
                } catch (e) {
                    alert("クラウド保存に失敗しました。");
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
        
        const shiftText = track.delayTime === 0 ? "重ねる" : `${track.delayTime > 0 ? '後ろに' : '前に'} ${Math.abs(track.delayTime)}s`;

        el.innerHTML = `
            <div class="track-header">
                <div class="track-name">${track.name} <span style="font-size:0.6rem; color:var(--text-muted); margin-left:8px;">[配置: ${shiftText}]</span></div>
                <div class="track-actions">
                    <button class="action-btn shift-prev-btn" data-id="${track.id}">前にずらす</button>
                    <button class="action-btn shift-next-btn" data-id="${track.id}">後ろにずらす</button>
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

    document.querySelectorAll('.shift-prev-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            const newDelay = (t.delayTime || 0) - 2;
            await updateDoc(doc(db, "tracks", id), { delayTime: newDelay });
        });
    });

    document.querySelectorAll('.shift-next-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            const newDelay = (t.delayTime || 0) + 2;
            await updateDoc(doc(db, "tracks", id), { delayTime: newDelay });
        });
    });

    document.querySelectorAll('.loop-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            const nextState = !t.isLooping;
            await updateDoc(doc(db, "tracks", id), { isLooping: nextState });
        });
    });

    document.querySelectorAll('.vol-slider').forEach(slider => {
        slider.addEventListener('change', async e => {
            const id = e.target.getAttribute('data-id');
            const vol = parseFloat(e.target.value);
            await updateDoc(doc(db, "tracks", id), { volume: vol });
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(!confirm("クラウドから完全に削除しますか？")) return;
            const id = e.target.getAttribute('data-id');
            const t = tracks.find(x => x.id === id);
            try {
                await deleteDoc(doc(db, "tracks", id));
                if (t.storagePath) {
                    await deleteObject(ref(storage, t.storagePath));
                }
            } catch(err) {
                console.error(err);
            }
        });
    });
}

function startTrackSource(track, currentMasterElapsed = 0) {
    if (!track.buffer) return;
    if (track.source) {
        try { track.source.stop(); } catch(e){}
    }

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

btnPlay.addEventListener('click', async () => {
    if (tracks.length === 0) return;
    await initAudio();
    if (isMasterPlaying) return;
    isMasterPlaying = true;
    
    btnPlay.classList.add('active');
    btnStop.classList.remove('active');

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
        startTrackSource(t, 0);
    }

    masterGain.gain.cancelScheduledValues(startTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, startTime);
    masterGain.gain.linearRampToValueAtTime(1, startTime + 0.8);

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
});

function updateProgress() {
    if (!isMasterPlaying) return;

    const now = audioCtx.currentTime;
    const elapsed = now - startTime;

    tracks.forEach(t => {
        const el = document.getElementById(`prog_${t.id}`);
        if (el && t.duration > 0) {
            const trackElapsed = elapsed - t.delayTime;
            let percent = 0;
            
            if (trackElapsed >= 0) {
                const current = t.isLooping ? (trackElapsed % t.duration) : Math.min(trackElapsed, t.duration);
                percent = (current / t.duration) * 100;
            }
            el.style.width = `${percent}%`;
        }
    });

    if (!isMasterLooping && tracks.length > 0) {
        const maxDur = Math.max(...tracks.map(t => (t.duration + t.delayTime)));
        if (elapsed >= maxDur) {
            btnStop.click();
            return;
        }
    }

    animationFrameId = requestAnimationFrame(updateProgress);
}
