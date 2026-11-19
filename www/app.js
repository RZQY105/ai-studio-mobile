const apiKeyInput = document.getElementById('apiKeyInput');
const settingsModal = document.getElementById('settingsModal');
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

// Fungsi merender 1 klip video menggunakan Google Veo 3
async function renderSingleVeo3Clip(promptText, apiKey, sceneIndex, totalScenes, loadingEl) {
    const startRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-preview:predictLongRunning?key=${apiKey}`,
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
        throw new Error(`Veo 3 Error (Adegan ${sceneIndex}): ${startData.error.message}`);
    }

    const operationName = startData.name;
    let videoUri = null;

    // Polling status setiap 5 detik (maksimal 3 menit per adegan)
    for (let i = 1; i <= 36; i++) {
        loadingEl.textContent = `Merender Adegan ${sceneIndex}/${totalScenes} di Veo 3... (${i * 5} dtk)`;
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
        throw new Error(`Render Adegan ${sceneIndex} melebihi batas waktu.`);
    }

    loadingEl.textContent = `Mengunduh klip Adegan ${sceneIndex}/${totalScenes}...`;
    const mp4Res = await fetch(`${videoUri}&key=${apiKey}`);
    return await mp4Res.blob();
}

// Menggabungkan beberapa Blob MP4 menjadi 1 video utuh menggunakan Canvas + MediaRecorder
async function mergeVideoBlobs(blobs, loadingEl) {
    if (blobs.length === 1) {
        finalVideoExt = 'mp4';
        return URL.createObjectURL(blobs[0]);
    }

    loadingEl.textContent = 'Menggabungkan semua adegan menjadi 1 video utuh...';
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
    return await mergeFinished;
}

document.getElementById('btnGenerate').onclick = async () => {
    const topic = document.getElementById('topicInput').value.trim();
    const style = document.getElementById('styleSelect').value;
    const sceneCount = parseInt(document.getElementById('sceneCountSelect').value, 10);
    const apiKey = localStorage.getItem('gemini_api_key');
    const loadingText = document.getElementById('loadingText');

    if (!topic) return alert('Isi ide cerita video terlebih dahulu.');
    if (!apiKey) {
        settingsModal.classList.remove('hidden');
        return alert('Masukkan Gemini API Key Anda terlebih dahulu.');
    }

    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('resultArea').classList.add('hidden');

    try {
        // 1. Pecah cerita menjadi N adegan konsisten menggunakan Gemini
        loadingText.textContent = `Menyusun skenario ${sceneCount} adegan konsisten...`;
        const storyboardPrompt = `Pecah ide cerita berikut menjadi ${sceneCount} adegan video berurutan yang saling menyambung untuk generator video AI (Veo 3).
        Pastikan deskripsi karakter utama selalu sama di setiap adegan agar konsisten.
        Ide: "${topic}"
        Gaya visual wajib: "${style}"
        
        Jawab HANYA dalam format JSON valid tanpa markdown:
        {
          "caption": "Naskah narasi & caption lengkap bahasa Indonesia beserta hashtag",
          "scenes": [
            "Detailed English video prompt for scene 1 including character action, facial expression, camera movement, and ${style}",
            "Detailed English video prompt for scene 2..."
          ]
        }`;

        const geminiModels = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.5-flash'];
        let storyData = null;
        let lastErr = '';

        for (const model of geminiModels) {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: storyboardPrompt }] }] })
            });
            const json = await res.json();
            if (!json.error && json.candidates) {
                storyData = json;
                break;
            }
            lastErr = json.error ? json.error.message : 'Gagal menyusun skenario';
        }

        if (!storyData) throw new Error(lastErr);

        const rawJson = storyData.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        const parsedStory = JSON.parse(rawJson);
        const scenePrompts = parsedStory.scenes.slice(0, sceneCount);

        // 2. Render setiap adegan secara berurutan di Veo 3
        const renderedBlobs = [];
        for (let i = 0; i < scenePrompts.length; i++) {
            const blob = await renderSingleVeo3Clip(
                scenePrompts[i],
                apiKey,
                i + 1,
                scenePrompts.length,
                loadingText
            );
            renderedBlobs.push(blob);
        }

        // 3. Gabungkan semua klip menjadi 1 video utuh
        if (finalVideoBlobUrl) URL.revokeObjectURL(finalVideoBlobUrl);
        finalVideoBlobUrl = await mergeVideoBlobs(renderedBlobs, loadingText);

        document.getElementById('videoPreview').src = finalVideoBlobUrl;
        document.getElementById('scriptOutput').textContent = parsedStory.caption;
        document.getElementById('resultArea').classList.remove('hidden');

    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
};

document.getElementById('btnDownloadVideo').onclick = () => {
    if (!finalVideoBlobUrl) return;
    const a = document.createElement('a');
    a.href = finalVideoBlobUrl;
    a.download = `Veo3-Video-${Date.now()}.${finalVideoExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

document.getElementById('btnCopyScript').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('scriptOutput').textContent);
    alert('Naskah berhasil disalin!');
};
