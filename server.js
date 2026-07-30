require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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
async function sendToGas(topic, message, timestamp) {
    const GAS_URL = process.env.GAS_WEB_APP_URL;
    if (!GAS_URL) return;

    try {
        console.log(`📡 Sending buffered data: [${topic}]`);
        const response = await fetch(GAS_URL, {
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
                await fetch(GAS_URL, {
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

server.listen(PORT, () => {
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
