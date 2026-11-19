const geminiKeyInput = document.getElementById('geminiKeyInput');
const sfKeyInput = document.getElementById('sfKeyInput');
const sfRegionSelect = document.getElementById('sfRegionSelect');
const settingsModal = document.getElementById('settingsModal');
const logContainer = document.getElementById('logContainer');
const progressBar = document.getElementById('progressBar');
const loadingText = document.getElementById('loadingText');

let finalVideoBlobUrl = null;
let finalVideoExt = 'mp4';

// Muat konfigurasi tersimpan dari memori HP
geminiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
sfKeyInput.value = localStorage.getItem('sf_api_key') || '';
sfRegionSelect.value = localStorage.getItem('sf_region') || 'https://api.siliconflow.com';

document.getElementById('btnSettings').onclick = () => settingsModal.classList.remove('hidden');
document.getElementById('btnCloseModal').onclick = () => settingsModal.classList.add('hidden');
document.getElementById('btnSaveKey').onclick = () => {
    localStorage.setItem('gemini_api_key', geminiKeyInput.value.trim());
    localStorage.setItem('sf_api_key', sfKeyInput.value.trim());
    localStorage.setItem('sf_region', sfRegionSelect.value);
    settingsModal.classList.add('hidden');
    alert('Semua pengaturan API Key berhasil disimpan!');
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Mencatat log secara real-time ke kotak terminal di layar
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

// Merender 1 klip video bergerak menggunakan SiliconFlow (Wan 2.1)
async function renderSingleSiliconFlowClip(promptText, sfApiKey, baseUrl, sceneIndex, totalScenes, basePercent, slicePercent) {
    addLog(`Mengirim Adegan ${sceneIndex}/${totalScenes} ke SiliconFlow (Wan 2.1)...`, 'info', basePercent);
    addLog(`Prompt Adegan ${sceneIndex}: "${promptText.substring(0, 75)}..."`, 'info');

    const submitRes = await fetch(`${baseUrl}/v1/video/submit`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${sfApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'Wan-AI/Wan2.1-T2V-14B',
            prompt: promptText,
            image_size: '720x1280'
        })
    });

    const submitData = await submitRes.json();
    if (!submitData.requestId) {
        throw new Error(submitData.message || `Gagal mengirim tugas Adegan ${sceneIndex} ke SiliconFlow.`);
    }

    const requestId = submitData.requestId;
    addLog(`Tugas diterima (ID: ${requestId}). Memulai render GPU...`, 'info');

    let videoUrl = null;
    // Polling status setiap 5 detik (maksimal 5 menit per adegan)
    for (let i = 1; i <= 60; i++) {
        const elapsed = i * 5;
        const currentProgress = basePercent + Math.min(slicePercent * 0.85, (i / 24) * (slicePercent * 0.85));
        loadingText.textContent = `Merender Adegan ${sceneIndex}/${totalScenes}... (${elapsed} dtk)`;
        addLog(`Adegan ${sceneIndex}/${totalScenes}: Merender frame video (${elapsed} detik)...`, 'info', currentProgress);

        await sleep(5000);

        const statusRes = await fetch(`${baseUrl}/v1/video/status`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${sfApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requestId })
        });

        const statusData = await statusRes.json();
        if (statusData.status === 'Succeed') {
            videoUrl = statusData.results?.videos?.[0]?.url;
            break;
        } else if (statusData.status === 'Failed') {
            throw new Error(statusData.reason || `Render Adegan ${sceneIndex} gagal di server SiliconFlow.`);
        }
    }

    if (!videoUrl) {
        throw new Error(`Render Adegan ${sceneIndex} melebihi batas waktu.`);
    }

    loadingText.textContent = `Mengunduh klip Adegan ${sceneIndex}/${totalScenes}...`;
    addLog(`Adegan ${sceneIndex}/${totalScenes} selesai! Mengunduh file MP4...`, 'success', basePercent + slicePercent * 0.9);

    const mp4Res = await fetch(videoUrl);
    const blob = await mp4Res.blob();
    addLog(`Klip Adegan ${sceneIndex} siap (${(blob.size / 1024 / 1024).toFixed(2)} MB).`, 'success', basePercent + slicePercent);
    return blob;
}

// Menggabungkan beberapa Blob MP4 menjadi 1 video utuh
async function mergeVideoBlobs(blobs) {
    if (blobs.length === 1) {
        finalVideoExt = 'mp4';
        addLog('Menyiapkan pemutar video MP4...', 'success', 98);
        return URL.createObjectURL(blobs[0]);
    }

    loadingText.textContent = 'Menggabungkan semua adegan menjadi 1 video...';
    addLog(`Menyambungkan ${blobs.length} klip menjadi 1 video utuh 9:16...`, 'info', 92);

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
        addLog(`Memproses klip ${i + 1} dari ${blobs.length}...`, 'info', 92 + ((i + 1) / blobs.length) * 6);
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
    const geminiKey = localStorage.getItem('gemini_api_key');
    const sfKey = localStorage.getItem('sf_api_key');
    const sfBaseUrl = localStorage.getItem('sf_region') || 'https://api.siliconflow.com';

    if (!topic) return alert('Isi ide cerita video terlebih dahulu.');
    if (!geminiKey || !sfKey) {
        settingsModal.classList.remove('hidden');
        return alert('Lengkapi Gemini API Key dan SiliconFlow API Key di menu Pengaturan (⚙️) terlebih dahulu.');
    }

    logContainer.innerHTML = '';
    progressBar.style.width = '5%';
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('resultArea').classList.add('hidden');
    document.getElementById('btnGenerate').disabled = true;

    try {
        addLog('Memulai produksi video AI...', 'info', 8);

        // 1. Pecah cerita menjadi N adegan konsisten menggunakan Gemini API Gratis
        loadingText.textContent = `Menyusun skenario ${sceneCount} adegan...`;
        addLog(`Menyusun skenario ${sceneCount} adegan menggunakan Gemini...`, 'info', 12);

        const storyboardPrompt = `Pecah ide cerita berikut menjadi ${sceneCount} adegan video berurutan yang saling menyambung untuk model text-to-video AI.
        Pastikan deskripsi fisik karakter utama selalu sama persis di setiap adegan agar konsisten.
        Ide: "${topic}"
        Gaya visual wajib: "${style}"
        
        Jawab HANYA dalam format JSON valid tanpa markdown:
        {
          "caption": "Naskah dialog, narasi & caption lengkap bahasa Indonesia beserta hashtag",
          "scenes": [
            "Detailed English video generation prompt for scene 1 describing character appearance, physical movement, facial expression, camera angle, and ${style}",
            "Detailed English video generation prompt for scene 2..."
          ]
        }`;

        const geminiModels = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.5-flash'];
        let storyData = null;
        let lastErr = '';

        for (const model of geminiModels) {
            addLog(`Menghubungi model skenario: ${model}...`, 'info');
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: storyboardPrompt }] }] })
            });
            const json = await res.json();
            if (!json.error && json.candidates) {
                storyData = json;
                addLog(`Skenario ${sceneCount} adegan berhasil disusun (${model}).`, 'success', 20);
                break;
            }
            lastErr = json.error ? json.error.message : 'Gagal menyusun skenario';
            addLog(`Model ${model} sibuk, beralih ke cadangan...`, 'error');
        }

        if (!storyData) throw new Error(lastErr);

        const rawJson = storyData.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        const parsedStory = JSON.parse(rawJson);
        const scenePrompts = parsedStory.scenes.slice(0, sceneCount);

        // 2. Render setiap adegan secara berurutan di SiliconFlow (20% -> 90%)
        const renderedBlobs = [];
        const totalRenderSpan = 70;
        const perSceneSpan = totalRenderSpan / scenePrompts.length;

        for (let i = 0; i < scenePrompts.length; i++) {
            const basePct = 20 + (i * perSceneSpan);
            const blob = await renderSingleSiliconFlowClip(
                scenePrompts[i],
                sfKey,
                sfBaseUrl,
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
    a.download = `AI-Video-${Date.now()}.${finalVideoExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

document.getElementById('btnCopyScript').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('scriptOutput').textContent);
    alert('Naskah berhasil disalin!');
};
