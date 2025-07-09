const express = require('express');
const multer = require('multer');
const extract = require('extract-zip');
const { spawn, exec } = require('child_process');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pidusage = require('pidusage');
const archiver = require('archiver');

const app = express();
const port = 3001;

// --- Directories ---
const botDirectory = path.join(__dirname, '../bot');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const upload = multer({ dest: uploadDir });

// --- State ---
let botProcess = null;

// --- WebSocket Setup ---
const wss = new WebSocket.Server({ port: 8081 });
wss.on('connection', ws => console.log('Client connected'));
function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// --- API Routes ---
const apiRouter = express.Router();
app.use('/api', apiRouter);

// --- Bot Status API ---
apiRouter.get('/bot/status', async (req, res) => {
    if (!botProcess) {
        return res.json({ running: false });
    }
    try {
        const stats = await pidusage(botProcess.pid);
        res.json({
            running: true,
            pid: botProcess.pid,
            cpu: stats.cpu,
            memory: stats.memory // in bytes
        });
    } catch (e) {
        res.json({ running: false, error: 'Could not retrieve stats.' });
    }
});

// --- Bot Management API ---
apiRouter.post('/bot/upload', upload.single('bot'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    broadcast({ type: 'log', data: '--- Upload received. Stopping and clearing old bot version... ---' });
    if (botProcess) {
        botProcess.kill();
        botProcess = null;
    }

    try {
        fs.rmSync(botDirectory, { recursive: true, force: true });
        fs.mkdirSync(botDirectory, { recursive: true });

        broadcast({ type: 'log', data: '--- Extracting new bot version... ---' });
        await extract(req.file.path, { dir: botDirectory });
        fs.unlinkSync(req.file.path);

        const envExists = fs.existsSync(path.join(botDirectory, '.env'));
        const packageJsonPath = path.join(botDirectory, 'package.json');

        if (fs.existsSync(packageJsonPath)) {
            broadcast({ type: 'log', data: '--- package.json found. Installing dependencies... ---' });
            try {
                await new Promise((resolve, reject) => {
                    const npmInstall = exec('npm install', { cwd: botDirectory });
                    npmInstall.stdout.on('data', data => broadcast({ type: 'log', data }));
                    npmInstall.stderr.on('data', data => broadcast({ type: 'log', data }));
                    npmInstall.on('close', code => {
                        if (code === 0) {
                            broadcast({ type: 'log', data: '--- Dependencies installed successfully. Ready to start. ---' });
                            resolve();
                        } else {
                            broadcast({ type: 'log', data: `--- Error installing dependencies. Exit code: ${code} ---` });
                            reject(new Error('Error installing dependencies.'));
                        }
                    });
                });
                res.json({ message: 'Upload and install complete.', envExists });
            } catch (error) {
                res.status(500).json({ message: error.message });
            }
        } else {
            broadcast({ type: 'log', data: '--- No package.json found. Skipping dependency installation. ---' });
            res.json({ message: 'Upload complete. No package.json found.', envExists });
        }
    } catch (err) {
        broadcast({ type: 'log', data: `--- Error during upload: ${err.message} ---` });
        res.status(500).json({ message: 'Error processing file.' });
    }
});

apiRouter.post('/bot/start', (req, res) => {
    if (botProcess) return res.status(400).json({ message: 'Bot is already running.' });
    const botIndexFile = path.join(botDirectory, 'index.js');
    if (!fs.existsSync(botIndexFile)) return res.status(400).json({ message: 'index.js not found.' });

    broadcast({ type: 'log', data: '--- Starting bot... ---' });
    botProcess = spawn('node', [botIndexFile], { cwd: botDirectory });
    botProcess.stdout.on('data', data => broadcast({ type: 'log', data: data.toString() }));
    botProcess.stderr.on('data', data => broadcast({ type: 'log', data: data.toString() }));
    botProcess.on('close', code => {
        broadcast({ type: 'log', data: `--- Bot process exited with code ${code} ---` });
        botProcess = null;
    });
    res.json({ message: 'Bot started.' });
});

apiRouter.post('/bot/stop', (req, res) => {
    if (!botProcess) return res.status(400).json({ message: 'Bot is not running.' });
    broadcast({ type: 'log', data: '--- Stopping bot... ---' });
    botProcess.kill();
    botProcess = null;
    res.json({ message: 'Bot stopped.' });
});

// --- .env Management API ---
apiRouter.get('/bot/env', (req, res) => {
    const envPath = path.join(botDirectory, '.env');
    if (fs.existsSync(envPath)) {
        res.json({ content: fs.readFileSync(envPath, 'utf-8') });
    } else {
        res.json({ content: '' });
    }
});

apiRouter.post('/bot/env', (req, res) => {
    const { content } = req.body;
    const envPath = path.join(botDirectory, '.env');
    fs.writeFileSync(envPath, content, 'utf-8');
    broadcast({ type: 'log', data: '--- .env file updated. ---' });
    res.json({ message: 'Successfully saved .env file.' });
});

// --- Backup API ---
apiRouter.get('/bot/backup', (req, res) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const backupPath = path.join(__dirname, `bot_backup_${Date.now()}.zip`);
    const output = fs.createWriteStream(backupPath);

    output.on('close', () => {
        res.download(backupPath, err => {
            if (err) console.error(err);
            fs.unlinkSync(backupPath); // delete file after download
        });
    });

    archive.pipe(output);
    archive.directory(botDirectory, false);
    archive.finalize();
});

// --- Serve Frontend ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(port, () => {
  console.log(`Dashboard backend listening at http://localhost:${port}`);
});