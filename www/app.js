const apiKeyInput = document.getElementById('apiKeyInput');
const settingsModal = document.getElementById('settingsModal');
const logContainer = document.getElementById('logContainer');
const progressBar = document.getElementById('progressBar');
const loadingText = document.getElementById('loadingText');

let finalVideoBlobUrl = null;
let finalVideoExt = 'mp4';

apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';

document.getElementById('btnSettings').onclick = () => settingsModal.classList.remove('hidden');
document.getElementById('btnCloseModal').onclick = () => settingsModal.classList.add('hidden');
document.getElementById('btnSaveKey').onclick = () => {
    localStorage.setItem('gemini_api_key', apiKeyInput.value.trim());
    settingsModal.classList.add('hidden');
    alert('API Key berhasil disimpan!');
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper mencatat log secara real-time ke kotak terminal di layar
function addLog(message, type = 'info', percent = null) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const div = document.createElement('div');
    div.className = 'log-entry';

    let colorClass = '';
    if (type === 'error') colorClass = 'log-err';
    if (type === 'success') colorClass = 'log-ok';

    div.innerHTML = `<span class="log-time">[${timeStr}]</span><span class="${colorClass}">${message}</span>`;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;

    if (percent !== null) {
        progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
}

// Deteksi otomatis nama model Veo yang aktif pada API Key pengguna
async function detectAvailableVeoModel(apiKey) {
    addLog('Memeriksa daftar model video Veo pada API Key...', 'info', 8);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    if (data.error) throw new Error(`Gagal mengecek daftar model: ${data.error.message}`);

    const models = data.models || [];
    const veoModels = models.filter(m =>
        m.name.toLowerCase().includes('veo') &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('predictLongRunning')
    );

    if (veoModels.length === 0) {
        throw new Error(
            'API Key belum memiliki akses model Veo (pastikan Billing Google Cloud sudah tertaut di Google AI Studio).'
        );
    }

    const veo3 = veoModels.find(m => m.name.includes('veo-3'));
    const chosen = (veo3 ? veo3.name : veoModels[0].name).replace('models/', '');
    addLog(`Model video aktif terdeteksi: ${chosen}`, 'success', 15);
    return chosen;
}

// Merender 1 klip video menggunakan model Veo yang terdeteksi
async function renderSingleVeoClip(modelName, promptText, apiKey, sceneIndex, totalScenes, basePercent, slicePercent) {
    addLog(`Mengirim Adegan ${sceneIndex}/${totalScenes} ke server ${modelName}...`, 'info', basePercent);
    addLog(`Prompt Adegan ${sceneIndex}: "${promptText.substring(0, 75)}..."`, 'info');

    const startRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predictLongRunning?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt: promptText }],
                parameters: {
                    aspectRatio: '9:16',
                    personGeneration: 'allow_adult'
                }
            })
        }
    );

    const startData = await startRes.json();
    if (startData.error) {
        throw new Error(`Veo Error (Adegan ${sceneIndex}): ${startData.error.message}`);
    }

    const operationName = startData.name;
    addLog(`Tugas diterima server (ID: ...${operationName.slice(-10)}). Mulai merender...`, 'info');

    let videoUri = null;
    for (let i = 1; i <= 36; i++) {
        const elapsed = i * 5;
        const currentProgress = basePercent + Math.min(slicePercent * 0.85, (i / 18) * (slicePercent * 0.85));
        loadingText.textContent = `Merender Adegan ${sceneIndex}/${totalScenes}... (${elapsed} dtk)`;
        addLog(`Adegan ${sceneIndex}/${totalScenes}: Server sedang merender frame (${elapsed} detik berjalan)...`, 'info', currentProgress);

        await sleep(5000);

        const checkRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`
        );
        const checkData = await checkRes.json();

        if (checkData.done) {
            if (checkData.error) throw new Error(checkData.error.message);
            videoUri = checkData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
            break;
        }
    }

    if (!videoUri) {
        throw new Error(`Render Adegan ${sceneIndex} melebihi batas waktu (3 menit).`);
    }

    loadingText.textContent = `Mengunduh klip Adegan ${sceneIndex}/${totalScenes}...`;
    addLog(`Adegan ${sceneIndex}/${totalScenes} selesai dirender! Mengunduh file MP4...`, 'success', basePercent + slicePercent * 0.9);

    const mp4Res = await fetch(`${videoUri}&key=${apiKey}`);
    const blob = await mp4Res.blob();
    addLog(`Klip Adegan ${sceneIndex} berhasil diunduh (${(blob.size / 1024 / 1024).toFixed(2)} MB).`, 'success', basePercent + slicePercent);
    return blob;
}

// Menggabungkan beberapa Blob MP4 menjadi 1 video utuh
async function mergeVideoBlobs(blobs) {
    if (blobs.length === 1) {
        finalVideoExt = 'mp4';
        addLog('Hanya 1 adegan, langsung menyiapkan pemutar video...', 'success', 98);
        return URL.createObjectURL(blobs[0]);
    }

    loadingText.textContent = 'Menggabungkan semua adegan menjadi 1 video...';
    addLog(`Menggabungkan ${blobs.length} klip menjadi 1 video utuh 9:16...`, 'info', 92);

    const canvas = document.getElementById('mergeCanvas');
    const ctx = canvas.getContext('2d');
    const player = document.getElementById('hiddenPlayer');

    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm;codecs=vp8';
    finalVideoExt = mimeType.includes('mp4') ? 'mp4' : 'webm';

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3500000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const mergeFinished = new Promise(resolve => {
        recorder.onstop = () => {
            const mergedBlob = new Blob(chunks, { type: mimeType });
            resolve(URL.createObjectURL(mergedBlob));
        };
    });

    recorder.start();

    for (let i = 0; i < blobs.length; i++) {
        addLog(`Menyambung klip adegan ${i + 1} dari ${blobs.length}...`, 'info', 92 + ((i + 1) / blobs.length) * 6);
        const clipUrl = URL.createObjectURL(blobs[i]);
        await new Promise((resolveClip) => {
            player.src = clipUrl;
            player.onloadedmetadata = () => {
                player.play();
                const drawFrame = () => {
                    if (player.paused || player.ended) {
                        URL.revokeObjectURL(clipUrl);
                        resolveClip();
                        return;
                    }
                    ctx.drawImage(player, 0, 0, canvas.width, canvas.height);
                    requestAnimationFrame(drawFrame);
                };
                drawFrame();
            };
        });
    }

    recorder.stop();
    const finalUrl = await mergeFinished;
    addLog('Penggabungan seluruh video selesai!', 'success', 100);
    return finalUrl;
}

document.getElementById('btnGenerate').onclick = async () => {
    const topic = document.getElementById('topicInput').value.trim();
    const style = document.getElementById('styleSelect').value;
    const sceneCount = parseInt(document.getElementById('sceneCountSelect').value, 10);
    const apiKey = localStorage.getItem('gemini_api_key');

    if (!topic) return alert('Isi ide cerita video terlebih dahulu.');
    if (!apiKey) {
        settingsModal.classList.remove('hidden');
        return alert('Masukkan Gemini API Key Anda terlebih dahulu.');
    }

    // Reset tampilan log & progress bar
    logContainer.innerHTML = '';
    progressBar.style.width = '3%';
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('resultArea').classList.add('hidden');
    document.getElementById('btnGenerate').disabled = true;

    try {
        addLog('Memulai proses produksi video AI...', 'info', 5);

        // 0. Deteksi model Veo
        loadingText.textContent = 'Mendeteksi model Veo aktif...';
        const activeVeoModel = await detectAvailableVeoModel(apiKey);

        // 1. Pecah cerita menjadi N adegan konsisten menggunakan Gemini
        loadingText.textContent = `Menyusun skenario ${sceneCount} adegan...`;
        addLog(`Meminta Gemini memecah cerita menjadi ${sceneCount} adegan konsisten...`, 'info', 18);

        const storyboardPrompt = `Pecah ide cerita berikut menjadi ${sceneCount} adegan video berurutan yang saling menyambung untuk generator video AI (Veo).
        Pastikan deskripsi karakter utama selalu sama di setiap adegan agar konsisten. Sertakan juga instruksi suara/dialog jika ada.
        Ide: "${topic}"
        Gaya visual wajib: "${style}"
        
        Jawab HANYA dalam format JSON valid tanpa markdown:
        {
          "caption": "Naskah narasi & caption lengkap bahasa Indonesia beserta hashtag",
          "scenes": [
            "Detailed English video prompt for scene 1 including character action, facial expression, lip-sync dialogue/audio cues, camera movement, and ${style}",
            "Detailed English video prompt for scene 2..."
          ]
        }`;

        const geminiModels = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.5-flash'];
        let storyData = null;
        let lastErr = '';

        for (const model of geminiModels) {
            addLog(`Menghubungi model naskah: ${model}...`, 'info');
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: storyboardPrompt }] }] })
            });
            const json = await res.json();
            if (!json.error && json.candidates) {
                storyData = json;
                addLog(`Skenario berhasil dibuat menggunakan ${model}.`, 'success', 25);
                break;
            }
            lastErr = json.error ? json.error.message : 'Gagal menyusun skenario';
            addLog(`Model ${model} sibuk, beralih ke cadangan...`, 'error');
        }

        if (!storyData) throw new Error(lastErr);

        const rawJson = storyData.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        const parsedStory = JSON.parse(rawJson);
        const scenePrompts = parsedStory.scenes.slice(0, sceneCount);

        // 2. Render setiap adegan secara berurutan (rentang progress 25% s/d 90%)
        const renderedBlobs = [];
        const totalRenderSpan = 65; // 25% -> 90%
        const perSceneSpan = totalRenderSpan / scenePrompts.length;

        for (let i = 0; i < scenePrompts.length; i++) {
            const basePct = 25 + (i * perSceneSpan);
            const blob = await renderSingleVeoClip(
                activeVeoModel,
                scenePrompts[i],
                apiKey,
                i + 1,
                scenePrompts.length,
                basePct,
                perSceneSpan
            );
            renderedBlobs.push(blob);
        }

        // 3. Gabungkan semua klip menjadi 1 video utuh
        if (finalVideoBlobUrl) URL.revokeObjectURL(finalVideoBlobUrl);
        finalVideoBlobUrl = await mergeVideoBlobs(renderedBlobs);

        loadingText.textContent = 'Selesai! Video siap diputar & disimpan.';
        addLog('PROSES SELESAI! Silakan putar atau simpan video ke galeri.', 'success', 100);

        document.getElementById('videoPreview').src = finalVideoBlobUrl;
        document.getElementById('scriptOutput').textContent = parsedStory.caption;
        document.getElementById('resultArea').classList.remove('hidden');

    } catch (err) {
        loadingText.textContent = 'Proses terhenti karena kesalahan.';
        addLog(`ERROR: ${err.message}`, 'error');
        alert('Terjadi kesalahan: ' + err.message);
    } finally {
        document.getElementById('btnGenerate').disabled = false;
    }
};

document.getElementById('btnDownloadVideo').onclick = () => {
    if (!finalVideoBlobUrl) return;
    const a = document.createElement('a');
    a.href = finalVideoBlobUrl;
    a.download = `Veo-Video-${Date.now()}.${finalVideoExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

document.getElementById('btnCopyScript').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('scriptOutput').textContent);
    alert('Naskah berhasil disalin!');
};
