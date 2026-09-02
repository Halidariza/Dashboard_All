require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const net = require('net');

// Happy Eyeballs bawaan Node hanya memberi 250 ms per percobaan koneksi. Jalur
// keluar server ke Google lebih lambat dari itu, jadi Node membatalkan sendiri
// dan melapor ETIMEDOUT - gejalanya panggilan Apps Script gagal acak meski
// curl dari mesin yang sama lancar. Beri tenggang yang masuk akal.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

// Server juga tidak punya jalur keluar IPv6 sementara DNS Google tetap
// mengembalikan alamat AAAA, jadi dahulukan IPv4 agar tidak ada percobaan
// yang terbuang.
dns.setDefaultResultOrder('ipv4first');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '12mb' }));   // foto peminjaman dikirim sebagai base64

// --- KONFIGURASI MQTT ---
let subscribedTopics = []; // Menyimpan daftar topik yang di-subscribe
let loggedTopics = new Set(); // Melacak topik yang sudah dikirim ke Spreadsheet dalam sesi ini
let isLoggingEnabled = false; // Status apakah logging ke Spreadsheet diizinkan
let isUpdating = false; // Status apakah sedang melakukan proses update massal
const BUFFER_FILE = path.join(__dirname, 'mqtt_buffer.csv');

const getBrokerConfig = (id) => {
    if (id === '2') {
        return {
            url: `mqtt://${process.env.MQTT_BROKER_2}:${process.env.MQTT_PORT_2}`,
            options: {
                clientId: (process.env.MQTT_CLIENT_ID || 'mqtt_client') + '_2',
                username: process.env.MQTT_USERNAME_2,
                password: process.env.MQTT_PASSWORD_2,
                clean: true,
                connectTimeout: 4000,
                reconnectPeriod: 1000,
            }
        };
    } else if (id === '3') {
        return {
            url: `mqtt://${process.env.MQTT_BROKER_3}:${process.env.MQTT_PORT_3}`,
            options: {
                clientId: (process.env.MQTT_CLIENT_ID || 'mqtt_client') + '_3',
                username: process.env.MQTT_USERNAME_3,
                password: process.env.MQTT_PASSWORD_3,
                clean: true,
                connectTimeout: 4000,
                reconnectPeriod: 1000,
            }
        };
    }
    return {
        url: `mqtt://${process.env.MQTT_BROKER}:${process.env.MQTT_PORT}`,
        options: {
            clientId: process.env.MQTT_CLIENT_ID || 'mqtt_client',
            username: process.env.MQTT_USERNAME,
            password: process.env.MQTT_PASSWORD,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 1000,
        }
    };
};

let currentConfig = getBrokerConfig('1');
let client = null; // Initialize as null, will connect on-demand
let activeMqttClients = 0;

// Helper function to save message to local JSONL buffer
function bufferToCsv(topic, message) {
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const entry = JSON.stringify({ timestamp, topic, message });

    // Check if topic is already buffered in this session to keep spreadsheet clean
    if (loggedTopics.has(topic)) return;

    fs.appendFileSync(BUFFER_FILE, entry + '\n');
    loggedTopics.add(topic); // Mark as buffered
    console.log(`📂 Buffered: [${topic}] to local buffer`);
}

// Function to actually send data to Google Spreadsheet via GAS
// --- Pemanggil Apps Script -----------------------------------------------
// Panggilan ke script.google.com sesekali putus di jaringan server. Timeout
// eksplisit plus retry singkat menahan gangguan sesaat supaya permintaan
// pengguna tidak langsung gagal.
const GAS_TIMEOUT_MS = 45000;
const GAS_MAX_RETRY = 3;

async function gasFetch(url, options = {}) {
    let lastError;

    for (let percobaan = 1; percobaan <= GAS_MAX_RETRY; percobaan++) {
        try {
            return await fetch(url, { ...options, signal: AbortSignal.timeout(GAS_TIMEOUT_MS) });
        } catch (e) {
            lastError = e;
            const kode = (e.cause && e.cause.code) || e.name;
            console.warn(`⚠️  Apps Script gagal (percobaan ${percobaan}/${GAS_MAX_RETRY}): ${kode}`);

            if (percobaan < GAS_MAX_RETRY) {
                await new Promise(r => setTimeout(r, 1000 * percobaan));
            }
        }
    }

    throw lastError;
}

async function sendToGas(topic, message, timestamp) {
    const GAS_URL = process.env.GAS_WEB_APP_URL;
    if (!GAS_URL) return;

    try {
        console.log(`📡 Sending buffered data: [${topic}]`);
        const response = await gasFetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'logMqtt',
                topic: topic,
                message: message,
                timestamp: timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            })
        });

        const text = await response.text();
        try {
            const result = JSON.parse(text);
            if (result.status === 'success') {
                console.log(`💾 GAS Status: ✅ Success for ${topic}`);
            } else {
                console.log(`💾 GAS Status: ❌ Failed: ${result.message}`);
            }
        } catch (e) {
            console.error('❌ GAS response not JSON (Deployment Error)');
        }
    } catch (error) {
        console.error('❌ Error sending to GAS:', error.message);
    }
}

// Main logic: Always buffer messages locally
async function logToSheet(topic, message) {
    bufferToCsv(topic, message);
}

const setupClientEvents = (mqttClient) => {
    mqttClient.on('connect', () => {
        console.log(`✅ Terhubung ke Broker: ${currentConfig.url}`);
        if (subscribedTopics.length > 0) {
            mqttClient.subscribe(subscribedTopics);
        }
        io.emit('status', { connected: true, broker: currentConfig.url, topics: subscribedTopics });
    });

    mqttClient.on('message', (topic, payload) => {
        // Hentikan proses simulasi/log jika sedang dalam proses update
        if (isUpdating) return;

        const msg = payload.toString();

        io.emit('mqtt_message', {
            topic,
            message: msg,
            time: new Date().toLocaleTimeString()
        });

        // Auto-log to buffer
        logToSheet(topic, msg);
    });

    mqttClient.on('error', (err) => {
        console.error('❌ Kesalahan MQTT:', err.message);
        io.emit('status', { connected: false, error: err.message });
    });

    mqttClient.on('close', () => {
        console.log('🔌 Koneksi broker ditutup');
        io.emit('status', { connected: false, broker: currentConfig.url, topics: subscribedTopics });
    });

    mqttClient.on('offline', () => {
        console.log('🔌 Broker offline');
        io.emit('status', { connected: false, broker: currentConfig.url, topics: subscribedTopics });
    });
};

// setupClientEvents(client);

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('🖥️ Dashboard connected');
    socket.emit('status', {
        connected: client ? client.connected : false,
        broker: currentConfig.url,
        topics: subscribedTopics
    });

    socket.on('join_mqtt', () => {
        if (socket.joinedMqtt) return;
        socket.joinedMqtt = true;
        activeMqttClients++;
        console.log(`👤 Client joined MQTT page. Active clients: ${activeMqttClients}`);

        if (!client || !client.connected) {
            console.log('🔌 Initializing MQTT connection for new session...');
            if (client) client.end(true); // Ensure old client is closed
            client = mqtt.connect(currentConfig.url, currentConfig.options);
            setupClientEvents(client);
        } else {
            socket.emit('status', { connected: true, broker: currentConfig.url, topics: subscribedTopics });
        }
    });

    socket.on('connect_broker', (brokerId) => {
        console.log(`🔌 Manual connect to Broker ${brokerId}...`);
        client.end(true, () => {
            currentConfig = getBrokerConfig(brokerId);
            client = mqtt.connect(currentConfig.url, currentConfig.options);
            setupClientEvents(client);
        });
    });

    socket.on('disconnect_broker', () => {
        console.log('🔌 Manual disconnect requested');
        if (client) {
            client.end(true);
            io.emit('status', { connected: false, broker: currentConfig.url, topics: subscribedTopics });
        }
    });

    socket.on('switch_broker', (brokerId) => {
        console.log(`🔄 Switching to Broker ${brokerId}...`);
        client.end(true, () => {
            currentConfig = getBrokerConfig(brokerId);
            client = mqtt.connect(currentConfig.url, currentConfig.options);
            setupClientEvents(client);
        });
    });

    socket.on('clear_topic_cache', async () => {
        if (isUpdating) return;
        isUpdating = true;
        console.log('🚀 Login trigger received. Preparing sheet and flushing buffer...');

        io.emit('error_notification', '🔄 Memulai Update Massal... Harap Tunggu.');

        const GAS_URL = process.env.GAS_WEB_APP_URL;
        if (GAS_URL) {
            try {
                await gasFetch(GAS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'prepareSheet' })
                });
            } catch (e) {
                console.error('❌ Gagal mempersiapkan sheet:', e.message);
            }
        }

        if (fs.existsSync(BUFFER_FILE)) {
            const data = fs.readFileSync(BUFFER_FILE, 'utf8');
            const lines = data.trim().split('\n');

            for (let i = 0; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                try {
                    const entry = JSON.parse(lines[i]);
                    // Kirim progress ke UI
                    io.emit('error_notification', `📤 Mengirim data (${i + 1}/${lines.length})...`);
                    await sendToGas(entry.topic, entry.message, entry.timestamp);
                } catch (e) {
                    console.error('❌ Gagal memproses baris buffer:', e.message);
                }
            }

            fs.unlinkSync(BUFFER_FILE);
            console.log('🗑️ Buffer flushed and deleted.');
            loggedTopics.clear();
            io.emit('error_notification', '✅ Update Selesai! Sistem kembali normal.');
        } else {
            io.emit('error_notification', 'ℹ️ Tidak ada data baru.');
        }

        isUpdating = false;
    });

    socket.on('add_topic', (newTopic) => {
        if (newTopic && !subscribedTopics.includes(newTopic)) {
            subscribedTopics.push(newTopic);
            client.subscribe(newTopic, () => {
                console.log(`📡 Subscribe ke topik baru: '${newTopic}'`);
                io.emit('status', { connected: client.connected, broker: currentConfig.url, topics: subscribedTopics });
            });
        }
    });

    socket.on('remove_topic', (topic) => {
        subscribedTopics = subscribedTopics.filter(t => t !== topic);
        client.unsubscribe(topic, () => {
            console.log(`🗑️ Unsubscribe dari topik: '${topic}'`);
            io.emit('status', { connected: client.connected, broker: currentConfig.url, topics: subscribedTopics });
        });
    });

    socket.on('publish_message', (data) => {
        const { topic, message } = data;
        if (client && client.connected) {
            client.publish(topic, message, { qos: 1 }, (err) => {
                if (err) {
                    console.error('❌ Gagal publish:', err.message);
                    socket.emit('error_notification', 'Gagal mempublikasikan pesan: ' + err.message);
                } else {
                    console.log(`📤 Publish ke '${topic}': ${message}`);
                }
            });
        } else {
            socket.emit('error_notification', 'Browser tidak terhubung ke broker!');
        }
    });

    socket.on('disconnect', () => {
        if (socket.joinedMqtt) {
            activeMqttClients--;
            console.log(`👤 Client left MQTT page. Active clients: ${activeMqttClients}`);

            if (activeMqttClients <= 0 && client) {
                activeMqttClients = 0; // Guard against negative
                console.log('🔌 No active MQTT clients. Closing connection...');
                if (subscribedTopics.length > 0) {
                    client.unsubscribe(subscribedTopics);
                }
                client.end(true);
                client = null;
            }
        }
        console.log('🖥️ Dashboard disconnected');
    });
});

// Endpoint to get the GAS URL safely from .env to frontend
app.get('/api/config', (req, res) => {
    res.json({
        gasUrl: process.env.GAS_WEB_APP_URL
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});


// Chatbot Endpoint
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper function to parse AI response and extract actions
function parseAIResponse(aiText, context) {
    // Try to extract JSON from response (AI might wrap it in ```json or just return JSON)
    let jsonMatch = aiText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (!jsonMatch) {
        // Try to find raw JSON object
        jsonMatch = aiText.match(/(\{[\s\S]*"action"[\s\S]*?\})/);
    }

    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            console.log('📦 Parsed Action:', JSON.stringify(parsed.action, null, 2));

            // If action has a name/id, try to find the file/folder ID from context
            if (parsed.action && (parsed.action.name || parsed.action.id) && context) {
                // If ID is already provided by AI, verify it exists or just use it
                if (parsed.action.id) {
                    console.log(`✅ AI provided ID: ${parsed.action.id}`);
                } else {
                    const cleanName = (name) => name.toLowerCase().replace(/^(file|folder)\s+/, '').trim();
                    const targetName = cleanName(parsed.action.name);

                    // Combine all known files for searching
                    const allKnownFiles = [
                        ...(context.files || []),
                        ...(context.allFiles || [])
                    ];

                    // Strategy 1: Exact Match
                    let targetFile = allKnownFiles.find(f =>
                        f.name.toLowerCase() === targetName
                    );

                    // Strategy 2: Contains Match (if exact fails)
                    if (!targetFile) {
                        targetFile = allKnownFiles.find(f =>
                            f.name.toLowerCase().includes(targetName) || targetName.includes(f.name.toLowerCase())
                        );
                    }

                    if (targetFile) {
                        parsed.action.id = targetFile.id;
                        parsed.action.type = parsed.action.type || (targetFile.type === 'folder' ? 'openFolder' : 'deleteFile');
                        console.log(`✅ Found file: ${targetFile.name} (ID: ${targetFile.id})`);
                    } else {
                        console.log(`⚠️  File "${parsed.action.name}" not found in context`);
                    }
                }
            }
            return parsed;
        } catch (e) {
            console.warn('⚠️  Failed to parse JSON from AI:', e.message);
        }
    }


    // If no JSON found or parsing failed, return plain text response
    return { reply: aiText };
}

app.post('/api/chat', async (req, res) => {
    const { message, context, history } = req.body;
    console.log('📩 User Message:', message);
    if (history && history.length > 1) {
        console.log(`💬 History included: ${history.length} messages`);
    }
    if (context) {
        console.log('📂 Drive Context:', JSON.stringify(context, null, 2));
    }

    if (!process.env.GEMINI_API_KEY) {
        return res.json({ reply: "Error: API Key is missing on the server." });
    }

    // System prompt dengan kemampuan eksekusi langsung
    const systemInstruction = `
KAMU ADALAH AI FILE MANAGER GOOGLE DRIVE.

PRIORITAS UTAMA:
1. Jika user meminta AKSI (delete, create, open, move, search), WAJIB return JSON.
2. Jika user hanya bertanya informasi, jawab TEXT biasa (BUKAN JSON).
3. JANGAN pernah mencampur JSON dan text.
4. Jika return JSON, output HARUS JSON SAJA tanpa penjelasan tambahan di luar JSON tersebut.
5. Jika user melakukan aksi konfirmasi (ya, ok, setuju, dll) terhadap tawaran aksi sebelumnya, Kamu WAJIB LANGSUNG mengembalikan JSON aksi yang sesuai.
6. Jika user melakukan aksi delete folder, cek dulu apakah didalam folder tersebut ada file atau folder lainnya. Jika ada, tampilkan pesan konfirmasi "Apakah Anda yakin ingin menghapus folder ini? terdapat beberapa file didalam folder tersebut". Jika user mengkonfirmasi, lakukan aksi delete.
7. Jika user mencari suatu folder atau file, dan kamu menemukan satu yang cocok, tanyakan: "Saya menemukan '[nama]'. Apakah Anda ingin saya mengarahkan Anda ke file ini?". 
8. PENTING: Jika di riwayat percakapan terakhir Kamu baru saja menanyakan poin (7) di atas, dan user menjawab "ya" (atau sinonimnya), Kamu WAJIB return JSON aksi "openFolder" dengan ID file/folder yang tadi dibahas. JANGAN jawab dengan text biasa atau bertanya lagi.
9. Gunakan riwayat percakapan untuk melacak file/folder mana yang sedang dibahas.
10. Jika tidak terdapat nama file atau folder yang dicari user, maka jawab dengan format "saya tidak menemukan file/folder dengan nama '[nama]'.".

====================================
KEMAMPUAN PENGLIHATAN:
- Kamu memiliki akses ke "FOLDER SAAT INI" dan "SEMUA FILE DI DRIVE" (Global).
- Setiap item di daftar Global memiliki "parentId".
- Jika user bertanya "apa isi folder X?", cari folder X di daftar Global, lalu cari semua item yang memiliki "parentId" sama dengan ID folder X tersebut.
- Kamu bisa memberikan informasi isi folder manapun.
- Gunakan "SEMUA FILE DI DRIVE" untuk mencari file yang tidak ada di folder saat ini.
- Jika user ingin menghapus file yang tidak ada di folder saat ini tapi ada di Global, gunakan ID dari daftar Global.

====================================
FORMAT WAJIB UNTUK AKSI
====================================

DELETE:
{
  "reply": "✅ File/folder [nama] berhasil dihapus!",
  "action": {
    "type": "deleteFile",
    "id": "[ID_DARI_CONTEXT]",
    "name": "[nama]"
  }
}

CREATE FOLDER:
{
  "reply": "✅ Folder [nama] berhasil dibuat!",
  "action": {
    "type": "createFolder",
    "name": "[nama]"
  }
}

OPEN / PINDAH FOLDER:
{
  "reply": "✅ Membuka folder [nama]...",
  "action": {
    "type": "openFolder",
    "id": "[ID_DARI_CONTEXT]",
    "name": "[nama]"
  }
}

====================================
ATURAN VALIDASI
====================================
- Selalu prioritaskan ID yang ada di context.
- Jika nama mirip, pilih yang paling relevan.
- Jangan mengarang file yang tidak ada di context (baik folder saat ini maupun global).

====================================
MODE JAWABAN
====================================
- Ada kata kerja aksi? → JSON
- Hanya bertanya? → TEXT
- Ragu? → TEXT untuk klarifikasi
`;


    // Build context string if available
    let contextString = '';
    if (context) {
        contextString = `\n\n=== INFORMASI DRIVE SAAT INI ===\n`;
        contextString += `Folder Aktif: ${context.currentFolder}\n`;

        if (context.files && context.files.length > 0) {
            contextString += `\nItem di Folder Ini:\n${context.files.map((f, i) => `- ${f.type === 'folder' ? '📁' : '📄'} ${f.name} (ID: ${f.id})`).join('\n')}\n`;
        } else {
            contextString += `(Folder ini kosong)\n`;
        }

        if (context.allFiles && context.allFiles.length > 0) {
            contextString += `\n=== SEMUA FILE DI DRIVE (GLOBAL) ===\n`;
            contextString += `${context.allFiles.map(f => `- ${f.type === 'folder' ? '📁' : '📄'} ${f.name} (ID: ${f.id}, ParentID: ${f.parentId || 'Root'})`).join('\n')}\n`;
        }
        contextString += `===================================\n`;
    }

    // Build history string
    let historyString = '';
    if (history && history.length > 1) {
        historyString = `\n\n=== RIWAYAT PERCAKAPAN (KONTEKS) ===\n`;
        // Exclude the last message because it's already in the 'User' part of the prompt
        const previousHistory = history.slice(0, -1);
        historyString += previousHistory.map(h => `${h.role === 'user' ? 'USER' : 'ASSISTANT'}: ${h.content}`).join('\n');
        historyString += `\n====================================\n`;
    }

    // Gabungkan system instruction dengan context, history, dan user message
    const fullPrompt = `${systemInstruction}${contextString}${historyString}\n\nUSER SAAT INI: ${message}\nASSISTANT:`;

    console.log('--- DEBUG PROMPT ---');
    console.log(historyString);
    console.log(`USER: ${message}`);
    console.log('--------------------');

    try {
        // PRIORITY 1: Try gemini-1.5-flash
        console.log('🤖 Trying model: gemini-1.5-flash...');
        const modelFlash = genAI.getGenerativeModel({
            model: "gemini-1.5-flash"
        });
        const resultFlash = await modelFlash.generateContent(fullPrompt);
        const responseFlash = await resultFlash.response;

        let aiText = '';
        if (responseFlash.candidates && responseFlash.candidates.length > 0) {
            if (responseFlash.candidates[0].finishReason !== 'STOP') {
                console.warn('⚠️ AI Finish Reason:', responseFlash.candidates[0].finishReason);
            }
            try {
                aiText = responseFlash.text();
            } catch (textError) {
                console.error('❌ Error extracting text (Safety/Block):', textError.message);
                return res.json({ reply: "Maaf, respons AI diblokir karena alasan keamanan atau konten." });
            }
        } else {
            console.warn('⚠️ No candidates returned');
            return res.json({ reply: "Maaf, tidak ada respons dari AI." });
        }

        console.log('✅ SUCCESS with gemini-1.5-flash');
        console.log('🤖 AI Response:', aiText);

        // Try to parse JSON response for actions
        let parsedResponse = parseAIResponse(aiText, context);
        return res.json(parsedResponse);

    } catch (errorFlash) {
        console.warn('⚠️ gemini-1.5-flash failed:', errorFlash.message);

        try {
            // PRIORITY 2: Fallback to gemini-2.0-flash
            console.log("🔄 Retrying with gemini-2.0-flash...");
            const modelPro = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const resultPro = await modelPro.generateContent(fullPrompt);
            const responsePro = await resultPro.response;

            let aiText = '';
            // Safe extraction for fallback
            try {
                if (responsePro.candidates && responsePro.candidates.length > 0) {
                    aiText = responsePro.text();
                }
            } catch (e) {
                console.error('❌ Fallback model error:', e.message);
                return res.json({ reply: "Maaf, terjadi kesalahan pada model AI." });
            }

            console.log('✅ SUCCESS with gemini-2.0-flash');

            let parsedResponse = parseAIResponse(aiText, context);
            return res.json(parsedResponse);

        } catch (errorPro) {
            console.error('❌ All Gemini Models Failed:', errorPro);

            // Check for specific 404/Quota errors
            let msg = "Maaf, server AI sedang sibuk atau tidak dapat diakses.";
            if (errorPro.message.includes('404')) {
                msg += " (Model Not Found - Cek Region/API Key)";
            } else if (errorPro.message.includes('429')) {
                msg += " (Quota Exceeded)";
            }

            res.json({ reply: msg });
        }
    }
});


// ============================================================
// INVENTORY ASET  (tambahan - tidak mengubah route yang sudah ada)
// ============================================================
// Semua request ke Apps Script di-proxy lewat server supaya:
//  - URL GAS tetap tersembunyi di .env
//  - tidak kena CORS preflight dari browser
// ------------------------------------------------------------

app.get('/api/inventory/config', (req, res) => {
    res.json({
        configured: Boolean(process.env.GAS_INVENTORY_URL && !process.env.GAS_INVENTORY_URL.includes('GANTI_DENGAN')),
        sheetUrl: process.env.INVENTORY_SHEET_URL || null,
        sheetId: process.env.INVENTORY_SHEET_ID || null
    });
});

async function callInventoryGas(payload) {
    const url = process.env.GAS_INVENTORY_URL;

    if (!url || url.includes('GANTI_DENGAN')) {
        throw new Error('GAS_INVENTORY_URL belum diisi di file .env. Deploy GAS_Inventory.js lalu tempel URL-nya.');
    }

    const response = await gasFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow'
    });

    const text = await response.text();

    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('Respon Apps Script bukan JSON. Pastikan deployment "Who has access" = Anyone.');
    }
}

// Folder Drive tempat foto dokumen peminjaman disimpan.
const PEMINJAMAN_FOLDER_ID = process.env.PEMINJAMAN_FOLDER_ID || '1EXK0tqLjjH1qUugdGuG04GZnS1trcDaJ';

// Folder Drive tempat foto bukti pengembalian disimpan.
const PENGEMBALIAN_FOLDER_ID = process.env.PENGEMBALIAN_FOLDER_ID || '1iFXpuLIqqMt2-XgCcBB7WOcCiBnW7GXM';

// Folder Drive tempat foto aset baru disimpan.
// https://drive.google.com/drive/folders/1PmsCpqVZ2041apP-hf_25MSeCvAIvk-V
const ASET_FOLDER_ID = process.env.ASET_FOLDER_ID || '1PmsCpqVZ2041apP-hf_25MSeCvAIvk-V';

// Link foto yang belum berhasil ditulis ke kolom Document (Apps Script versi lama
// belum punya action setDocument). Disimpan lokal, lalu ditambal otomatis
// begitu deployment Apps Script diperbarui.
// Dua jenis: peminjaman (kolom Document) dan pengembalian (kolom Foto Pengembalian).
const DOC_JENIS = {
    peminjaman: {
        file: path.join(__dirname, 'data', 'peminjaman-doc.json'),
        action: 'setDocument',
        label: 'dokumen peminjaman'
    },
    pengembalian: {
        file: path.join(__dirname, 'data', 'pengembalian-foto.json'),
        action: 'setFotoPengembalian',
        label: 'foto pengembalian'
    }
};

function docConfig(jenis) {
    return DOC_JENIS[jenis] || DOC_JENIS.peminjaman;
}

function readPendingDocs(jenis) {
    try {
        return JSON.parse(fs.readFileSync(docConfig(jenis).file, 'utf8'));
    } catch (e) {
        return [];
    }
}

function writePendingDocs(jenis, list) {
    const cfg = docConfig(jenis);

    try {
        fs.mkdirSync(path.dirname(cfg.file), { recursive: true });
        fs.writeFileSync(cfg.file, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error(`⚠️  Gagal menyimpan catatan link ${cfg.label}:`, e.message);
    }
}

function rememberPendingDoc(jenis, entry) {
    const list = readPendingDocs(jenis).filter(d => !(d.id === entry.id && d.tanggal === entry.tanggal));
    list.push(entry);
    writePendingDocs(jenis, list);
}

/** Coba tulis link ke kolom tujuan di sheet. true = berhasil masuk sheet. */
async function writeDocumentToSheet(jenis, entry) {
    try {
        const res = await callInventoryGas({
            action: docConfig(jenis).action,
            id: entry.id,
            tanggal: entry.tanggal,
            url: entry.url
        });
        return Boolean(res && res.status === 'success');
    } catch (e) {
        return false;
    }
}

/** Tambal semua link tertunda. Berhenti diam-diam kalau Apps Script belum mendukung. */
async function flushPendingDocs(jenis) {
    const list = readPendingDocs(jenis);
    if (!list.length) return;

    const sisa = [];
    for (const entry of list) {
        const ok = await writeDocumentToSheet(jenis, entry);
        if (!ok) sisa.push(entry);
    }

    if (sisa.length !== list.length) {
        console.log(`📝 ${list.length - sisa.length} link ${docConfig(jenis).label} berhasil ditulis ke sheet.`);
        writePendingDocs(jenis, sisa);
    }
}

/**
 * Upload foto dokumen peminjaman / pengembalian.
 * Jalur utama  : GAS Inventory (action uploadDocument).
 * Jalur cadang : GAS Drive Connector (action upload) - dipakai kalau deployment
 *                inventory masih versi lama sehingga belum kenal uploadDocument.
 */
async function uploadFotoDokumen(body) {
    // Tiap jenis foto punya folder Drive sendiri; dipakai jalur cadangan di bawah.
    const jenis = String(body.jenis || '').toLowerCase();
    const folderId = jenis === 'pengembalian' ? PENGEMBALIAN_FOLDER_ID
        : (jenis === 'aset' ? ASET_FOLDER_ID : PEMINJAMAN_FOLDER_ID);
    const prefix = jenis === 'pengembalian' ? 'PGB' : (jenis === 'aset' ? 'AST' : 'PJM');

    let primaryError = null;

    try {
        const result = await callInventoryGas(body);
        if (result && result.status === 'success' && result.url) return result;
        primaryError = (result && result.message) || 'Respon upload tidak dikenali.';
    } catch (err) {
        primaryError = err.message;
    }

    const driveUrl = process.env.GAS_WEB_APP_URL;
    if (!driveUrl) {
        throw new Error(primaryError);
    }

    console.warn(`⚠️  uploadDocument gagal di GAS Inventory (${primaryError}). Coba lewat Drive Connector...`);

    const payload = JSON.stringify({
        action: 'upload',
        folderId,
        name: body.fileName || `${prefix}_${body.id || 'aset'}_${Date.now()}.jpg`,
        mimeType: body.mimeType || 'image/jpeg',
        content: body.data
    });

    // Apps Script kadang membalas halaman HTML saat cold start - coba beberapa kali.
    let lastError = 'respon kosong';

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await gasFetch(driveUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                redirect: 'follow'
            });

            const json = JSON.parse(await response.text());

            if (json && json.status === 'success' && json.file && json.file.url) {
                return {
                    status: 'success',
                    message: 'Foto terupload lewat Drive Connector.',
                    url: json.file.url,
                    fileId: json.file.id,
                    fileName: json.file.name,
                    via: 'drive-connector'
                };
            }

            lastError = (json && json.message) || 'respon tidak dikenali';
        } catch (e) {
            lastError = 'respon bukan JSON (kemungkinan cold start)';
        }

        console.warn(`   percobaan ${attempt}/3 gagal: ${lastError}`);
    }

    throw new Error(`Upload gagal. GAS Inventory: ${primaryError}. Drive Connector: ${lastError}`);
}

// Kolom Umur di spreadsheet disegarkan maksimal sekali sehari.
let umurRefreshedOn = null;

async function refreshUmurSekaliSehari() {
    const hariIni = new Date().toISOString().slice(0, 10);
    if (umurRefreshedOn === hariIni) return;

    umurRefreshedOn = hariIni;

    try {
        const res = await callInventoryGas({ action: 'refreshUmur' });
        if (res && res.status === 'success' && res.updated) {
            console.log(`🗓️  Kolom Umur diperbarui: ${res.updated} baris.`);
        }
    } catch (e) {
        // Apps Script versi lama belum punya action ini - abaikan saja.
    }
}

app.post('/api/inventory', async (req, res) => {
    const action = req.body && req.body.action;

    if (!action) {
        return res.status(400).json({ status: 'error', message: 'Parameter "action" wajib diisi.' });
    }

    try {
        console.log(`📦 Inventory action: ${action}`);

        let result;

        if (action === 'uploadDocument') {
            result = await uploadFotoDokumen(req.body);
        } else {
            result = await callInventoryGas(req.body);

            // Baris baru peminjaman / pengembalian: pastikan link fotonya benar-benar
            // masuk kolom tujuan (Document / Foto Pengembalian).
            const jenisDoc = action === 'checkOut' ? 'peminjaman'
                : (action === 'checkIn' ? 'pengembalian' : null);

            if (jenisDoc && result && result.status === 'success' && req.body.dokumen) {
                const entry = {
                    id: req.body.id,
                    tanggal: req.body.tanggal,
                    url: req.body.dokumen,
                    savedAt: new Date().toISOString()
                };

                if (!(await writeDocumentToSheet(jenisDoc, entry))) {
                    rememberPendingDoc(jenisDoc, entry);
                    result.documentPending = true;
                    console.warn(`⚠️  Link ${docConfig(jenisDoc).label} belum bisa ditulis ke sheet, disimpan sementara.`);
                }
            }

            // Buka daftar aset: sekalian segarkan kolom Umur di spreadsheet (sekali sehari).
            if (action === 'getInventory' && result && result.status === 'success') {
                refreshUmurSekaliSehari();
            }

            // Saat riwayat dibuka: coba tambal yang tertunda, lalu tampilkan link yang ada.
            if (action === 'getKeluar' && result && result.status === 'success') {
                await flushPendingDocs('peminjaman');
                await flushPendingDocs('pengembalian');

                const pending = readPendingDocs('peminjaman');
                if (pending.length) {
                    result.items = (result.items || []).map(item => {
                        if (item.dokumen) return item;
                        const match = pending.find(d => d.id === item.id && d.tanggal === item.tanggal);
                        return match ? { ...item, dokumen: match.url, dokumenPending: true } : item;
                    });
                    result.pendingDocs = pending.length;
                }
            }

            if (action === 'getPengembalian' && result && result.status === 'success') {
                await flushPendingDocs('pengembalian');

                const pending = readPendingDocs('pengembalian');
                if (pending.length) {
                    result.items = (result.items || []).map(item => {
                        if (item.foto) return item;
                        const match = pending.find(d => d.id === item.id && d.tanggal === item.tanggal);
                        return match ? { ...item, foto: match.url, fotoPending: true } : item;
                    });
                    result.pendingFoto = pending.length;
                }
            }
        }

        res.json(result);
    } catch (error) {
        console.error('❌ Inventory error:', error.message);
        res.status(502).json({ status: 'error', message: error.message });
    }
});
