const apiKeyInput = document.getElementById('apiKeyInput');
const settingsModal = document.getElementById('settingsModal');

// Muat API Key tersimpan
apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';

document.getElementById('btnSettings').onclick = () => settingsModal.classList.remove('hidden');
document.getElementById('btnCloseModal').onclick = () => settingsModal.classList.add('hidden');
document.getElementById('btnSaveKey').onclick = () => {
    localStorage.setItem('gemini_api_key', apiKeyInput.value.trim());
    settingsModal.classList.add('hidden');
};

document.getElementById('btnGenerate').onclick = async () => {
    const topic = document.getElementById('topicInput').value.trim();
    const style = document.getElementById('styleSelect').value;
    const apiKey = localStorage.getItem('gemini_api_key');

    if (!topic) return alert('Isi topik konten terlebih dahulu.');
    if (!apiKey) {
        settingsModal.classList.remove('hidden');
        return alert('Masukkan Gemini API Key Anda terlebih dahulu.');
    }

    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('resultArea').classList.add('hidden');

    try {
        // 1. Panggil Gemini API Resmi untuk Naskah & Prompt Gambar
        const prompt = `Buatkan naskah video pendek (Reels/TikTok) bahasa Indonesia tentang: "${topic}". 
        Berikan juga 1 baris deskripsi visual dalam bahasa Inggris di baris paling akhir dengan format: IMAGE_PROMPT: [deskripsi visual detail gaya ${style}]`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const fullText = data.candidates[0].content.parts[0].text;
        const splitText = fullText.split('IMAGE_PROMPT:');
        const scriptText = splitText[0].trim();
        const imagePrompt = (splitText[1] || topic).trim();

        // 2. Generate Visual dari Endpoint Publik Gratis
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
