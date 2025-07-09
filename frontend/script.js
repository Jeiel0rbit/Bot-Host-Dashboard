document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = '/api';
    const WS_URL = `ws://${window.location.host.split(':')[0]}:8081`;

    // --- Element References ---

    // --- Bot Status & Resources ---
    const cpuProgress = document.getElementById('cpu-progress');
    const cpuText = document.getElementById('cpu-text');
    const ramProgress = document.getElementById('ram-progress');
    const ramText = document.getElementById('ram-text');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const botStatusIndicator = document.getElementById('bot-status-indicator');
    const botStatusText = document.getElementById('bot-status-text');

    startBtn.addEventListener('click', () => sendBotControl('start'));
    stopBtn.addEventListener('click', () => sendBotControl('stop'));

    async function sendBotControl(action) {
        try {
            await fetch(`${API_BASE_URL}/bot/${action}`, { method: 'POST' });
        } catch (err) {
            console.error(`Error ${action}ing bot:`, err);
        }
    }

    async function updateBotStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/bot/status`);
            const data = await response.json();

            const statusDot = botStatusIndicator.querySelector('.w-4.h-4.rounded-full');
            if (data.running) {
                statusDot.classList.remove('bg-red-500');
                statusDot.classList.add('bg-green-500');
                botStatusText.textContent = `Running (PID: ${data.pid})`;
                const cpuUsage = data.cpu.toFixed(1);
                cpuProgress.style.width = `${cpuUsage}%`;
                cpuText.textContent = `${cpuUsage}%`;
                const memInMb = (data.memory / 1024 / 1024).toFixed(2);
                ramProgress.style.width = `${(memInMb / 1024) * 100}%`;
                ramText.textContent = `${memInMb} MB`;
            } else {
                statusDot.classList.remove('bg-green-500');
                statusDot.classList.add('bg-red-500');
                botStatusText.textContent = 'Stopped';
                cpuProgress.style.width = '0%';
                cpuText.textContent = '0%';
                ramProgress.style.width = '0%';
                ramText.textContent = '0 MB';
            }
        } catch (err) {
            botStatusIndicator.classList.remove('running');
            botStatusText.textContent = 'Error';
        }
    }

    // --- Deploy ---
    const fileInput = document.getElementById('file-input');
    const fileName = document.getElementById('file-name');
    const uploadProgressContainer = document.getElementById('upload-progress-container');
    const uploadProgress = document.getElementById('upload-progress');

    fileInput.addEventListener('change', async () => {
        if (fileInput.files.length === 0) return;
        fileName.textContent = fileInput.files[0].name;
        const file = fileInput.files[0];

        addLog('--- File selected. Starting automatic deployment... ---', 'info');
        uploadProgressContainer.classList.remove('hidden');
        uploadProgress.style.width = '0%';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/bot/upload`, true);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                uploadProgress.style.width = `${percentComplete}%`;
            }
        };

        xhr.onload = () => {
            uploadProgressContainer.classList.add('hidden');
            const result = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
                addLog('--- Deployment successful. ---', 'info');
                logsOutput.scrollIntoView({ behavior: 'smooth' });
                if (result.envExists) {
                    fetchEnv();
                }
            } else {
                addLog(`--- Deployment failed: ${result.message} ---`, 'error');
            }
        };

        xhr.onerror = () => {
            addLog('--- Upload failed due to a network error. ---', 'error');
            uploadProgressContainer.classList.add('hidden');
        };

        const formData = new FormData();
        formData.append('bot', file);
        xhr.send(formData);
    });

    // --- .env ---
    const envEditor = document.getElementById('env-editor');
    const saveEnvBtn = document.getElementById('save-env-btn');

    saveEnvBtn.addEventListener('click', async () => {
        try {
            await fetch(`${API_BASE_URL}/bot/env`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: envEditor.value }),
            });
            addLog('--- .env file saved successfully. ---', 'info');
        } catch (err) {
            addLog(`--- Error saving .env: ${err.message} ---`, 'error');
        }
    });

    async function fetchEnv() {
        try {
            const response = await fetch(`${API_BASE_URL}/bot/env`);
            const data = await response.json();
            envEditor.value = data.content;
        } catch (err) {
            console.error('Error fetching .env:', err);
        }
    }

    // --- Backup ---
    const backupBtn = document.getElementById('backup-btn');
    backupBtn.addEventListener('click', () => {
        window.location.href = `${API_BASE_URL}/bot/backup`;
    });

    // --- Logs ---
    const logsOutput = document.getElementById('logs-output');
    function addLog(message, type = 'info') {
        const line = document.createElement('div');
        line.textContent = message;
        const lowerMessage = message.toLowerCase();

        if (lowerMessage.includes('error') || lowerMessage.includes('failed')) {
            type = 'error';
        } else if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) {
            type = 'warn';
        }

        line.className = `py-0.5 px-1 ${type === 'error' ? 'text-red-400' : type === 'warn' ? 'text-yellow-400' : 'text-gray-300'}`;
        logsOutput.appendChild(line);
        logsOutput.scrollTop = logsOutput.scrollHeight;
    }

    // --- WebSocket ---
    function connectWebSocket() {
        const ws = new WebSocket(WS_URL);
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'log') {
                addLog(msg.data.trim());
            }
        };
        ws.onclose = () => {
            addLog('--- WebSocket disconnected. Reconnecting in 3s... ---', 'warn');
            setTimeout(connectWebSocket, 3000);
        };
        ws.onerror = () => {
            addLog('--- WebSocket error. ---', 'error');
        };
    }

    // --- Initial Load ---
    updateBotStatus();
    connectWebSocket();
    setInterval(updateBotStatus, 2000);
});