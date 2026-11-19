const apiKeyInput = document.getElementById('apiKeyInput');
const settingsModal = document.getElementById('settingsModal');

// Muat API Key tersimpan dari memori HP
apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';

document.getElementById('btnSettings').onclick = () => settingsModal.classList.remove('hidden');
document.getElementById('btnCloseModal').onclick = () => settingsModal.classList.add('hidden');
document.getElementById('btnSaveKey').onclick = () => {
    localStorage.setItem('gemini_api_key', apiKeyInput.value.trim());
    settingsModal.classList.add('hidden');
    alert('API Key berhasil disimpan!');
};

// Fungsi jeda waktu otomatis (untuk auto-retry)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

document.getElementById('btnGenerate').onclick = async () => {
    const topic = document.getElementById('topicInput').value.trim();
    const style = document.getElementById('styleSelect').value;
    const apiKey = localStorage.getItem('gemini_api_key');

    if (!topic) return alert('Isi topik konten terlebih dahulu.');
    if (!apiKey) {
        settingsModal.classList.remove('hidden');
        return alert('Masukkan Gemini API Key Anda terlebih dahulu melalui ikon gerigi.');
    }

    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('resultArea').classList.add('hidden');

    try {
        const prompt = `Buatkan naskah video pendek (Reels/TikTok) bahasa Indonesia tentang: "${topic}". 
        Berikan juga 1 baris deskripsi visual dalam bahasa Inggris di baris paling akhir dengan format: IMAGE_PROMPT: [deskripsi visual detail gaya ${style}]`;

        // Daftar model berurutan: utama & cadangan jika server sibuk
        const models = [
            'gemini-3.8-flash',
            'gemini-3.8-flash-lite',
            'gemini-3.5-flash'
        ];

        let data = null;
        let lastError = '';

        // Coba hingga 2 putaran jika semua model sedang high demand
        for (let attempt = 1; attempt <= 2; attempt++) {
            for (const model of models) {
                try {
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                    });
                    const json = await res.json();
                    if (!json.error && json.candidates) {
                        data = json;
                        break;
                    }
                    lastError = json.error ? json.error.message : 'Respon kosong dari server';
                } catch (netErr) {
                    lastError = netErr.message;
                }
            }
            if (data) break;
            if (attempt < 2) await sleep(2500); // Tunggu 2.5 detik sebelum mencoba ulang
        }

        if (!data) throw new Error(lastError);

        const fullText = data.candidates[0].content.parts[0].text;
        const splitText = fullText.split('IMAGE_PROMPT:');
        const scriptText = splitText[0].trim();
        const imagePrompt = (splitText[1] || topic).trim();

        // Generate Visual dari Endpoint Publik Gratis
        const encodedPrompt = encodeURIComponent(`${imagePrompt}, ${style}, high quality, 9:16 vertical`);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=720&height=1280&nologo=true`;

        document.getElementById('scriptOutput').textContent = scriptText;
        document.getElementById('generatedImage').src = imageUrl;

        document.getElementById('resultArea').classList.remove('hidden');
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
};

document.getElementById('btnCopyScript').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('scriptOutput').textContent);
    alert('Naskah berhasil disalin!');
};

document.getElementById('btnDownloadImg').onclick = () => {
    window.open(document.getElementById('generatedImage').src, '_blank');
};
