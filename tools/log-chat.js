#!/usr/bin/env node
/**
 * ============================================================
 * CATATAN PERCAKAPAN CLAUDE CODE  ->  GOOGLE DOC
 * ============================================================
 * Claude Code sudah menyimpan tiap sesi sebagai JSONL di
 *   ~/.claude/projects/<slug-proyek>/<sessionId>.jsonl
 * Skrip ini membaca berkas itu, mengambil HANYA ucapan manusia dan
 * jawaban teks Claude, lalu mengirimnya ke Apps Script (GAS_ChatLog.js)
 * untuk ditulis ke Google Doc.
 *
 * Isi tool (hasil cat, grep, diff, dsb) sengaja TIDAK dikirim: di
 * dalamnya bisa ada isi .env, kunci API, dan id spreadsheet.
 *
 * ------------------------------------------------------------
 * DOC = SUMBER KEBENARAN
 * ------------------------------------------------------------
 * Skrip ini tidak menyimpan catatan kemajuan sendiri. Sebelum mengirim,
 * ia menanyakan ke Apps Script (action getProgress) percakapan sudah
 * tercatat sampai baris ke berapa - jawabannya dibaca dari penanda yang
 * ditinggalkan di dalam Doc.
 *
 * Konsekuensinya persis seperti yang diharapkan: hapus isi Doc, penandanya
 * ikut hilang, dan pengiriman berikutnya mencatat ulang dari baris pertama.
 * Tidak ada state di sisi klien yang bisa berbeda dari isi Doc.
 *
 * PEMAKAIAN
 *   node tools/log-chat.js              kirim entri baru sesi berjalan
 *                                       (dipanggil otomatis oleh hook Stop)
 *   node tools/log-chat.js --import     kirim SEMUA sesi, abaikan kemajuan di Doc
 *   node tools/log-chat.js --dry-run    tampilkan di layar, jangan kirim
 * ============================================================
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ARGS = process.argv.slice(2);
const IMPORT_SEMUA = ARGS.includes('--import');
const DRY_RUN = ARGS.includes('--dry-run');

const DIR_DATA = path.join(__dirname, '..', 'data');
const FILE_PAYLOAD = path.join(DIR_DATA, 'chatlog-hook-payload.json');

// Nama folder transkrip = path proyek dengan karakter non-alfanumerik jadi '-'.
const DIR_TRANSKRIP = path.join(
    os.homedir(), '.claude', 'projects',
    path.resolve(__dirname, '..').replace(/[^a-zA-Z0-9]/g, '-')
);

// Pembungkus yang disuntikkan harness, bukan ucapan pengguna.
const TAG_BUANG = [
    'system-reminder', 'ide_opened_file', 'ide_selection', 'ide_diagnostics',
    'local-command-stdout', 'local-command-stderr', 'command-name',
    'command-message', 'command-args', 'task-notification'
];

// Penjaga terakhir kalau rahasia sempat terkutip di dalam teks percakapan.
const POLA_SENSOR = [
    [/AIza[0-9A-Za-z\-_]{15,}/g, 'AIza...<disensor>'],
    [/\b(PASSWORD|API_KEY|APIKEY|SECRET|TOKEN|CREDENTIAL)\s*=\s*\S+/gi, '$1=<disensor>']
];


// ============================================================
// HELPER
// ============================================================
function waktuLokal(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function bersihkan(teks) {
    let t = String(teks || '');

    TAG_BUANG.forEach(function (tag) {
        t = t.replace(new RegExp('<' + tag + '>[\\s\\S]*?</' + tag + '>', 'g'), '');
        t = t.replace(new RegExp('<' + tag + '[^>]*/>', 'g'), '');
    });

    POLA_SENSOR.forEach(function (pair) {
        t = t.replace(pair[0], pair[1]);
    });

    return t.trim();
}

/** Gabungkan blok teks dari satu entri transkrip. */
function ambilTeks(message) {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) return '';

    return message.content
        .filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
        .map(function (b) { return b.text; })
        .join('\n');
}


// ============================================================
// PAYLOAD HOOK
// ============================================================
/**
 * Hook Claude Code mengirim JSON lewat stdin. Bentuk payloadnya tidak
 * diasumsikan: beberapa nama kunci yang mungkin dicoba satu per satu, dan
 * kalau tidak ada yang cocok skrip jatuh ke transkrip termuda di folder
 * proyek. Payload mentah disimpan ke data/chatlog-hook-payload.json supaya
 * bentuk sebenarnya bisa diperiksa sekali.
 */
function bacaPayloadHook() {
    if (process.stdin.isTTY) return null;

    let mentah = '';
    try {
        mentah = fs.readFileSync(0, 'utf8');
    } catch (e) {
        return null;
    }

    if (!mentah.trim()) return null;

    try {
        fs.mkdirSync(DIR_DATA, { recursive: true });
        fs.writeFileSync(FILE_PAYLOAD, mentah, 'utf8');
    } catch (e) { /* tidak penting */ }

    try {
        return JSON.parse(mentah);
    } catch (e) {
        return null;
    }
}

function pilihTranskrip(payload) {
    const kandidat = [
        payload && payload.transcript_path,
        payload && payload.transcriptPath,
        payload && payload.session && payload.session.transcript_path
    ].filter(Boolean);

    for (const p of kandidat) {
        if (fs.existsSync(p)) return p;
    }

    const sessionId = (payload && (payload.session_id || payload.sessionId)) || null;
    if (sessionId) {
        const p = path.join(DIR_TRANSKRIP, sessionId + '.jsonl');
        if (fs.existsSync(p)) return p;
    }

    // Jatuh ke transkrip yang paling baru disentuh.
    if (!fs.existsSync(DIR_TRANSKRIP)) return null;

    const semua = fs.readdirSync(DIR_TRANSKRIP)
        .filter(function (f) { return f.endsWith('.jsonl'); })
        .map(function (f) { return path.join(DIR_TRANSKRIP, f); })
        .sort(function (a, b) { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; });

    return semua[0] || null;
}


// ============================================================
// PILAH TRANSKRIP
// ============================================================
/**
 * Ambil percakapan dari baris ke-`mulai` sampai akhir.
 * Jawaban Claude yang terpecah beberapa entri (karena diselingi tool)
 * digabung jadi satu entri per giliran, supaya Doc tidak penuh potongan.
 */
function pilahTranskrip(file, mulai) {
    const baris = fs.readFileSync(file, 'utf8').split('\n');
    const entries = [];

    let bufferClaude = [];
    let waktuClaude = '';

    function flushClaude() {
        const teks = bersihkan(bufferClaude.join('\n\n'));
        if (teks) entries.push({ role: 'assistant', time: waktuClaude, text: teks });
        bufferClaude = [];
        waktuClaude = '';
    }

    for (let i = mulai; i < baris.length; i++) {
        if (!baris[i].trim()) continue;

        let j;
        try { j = JSON.parse(baris[i]); } catch (e) { continue; }

        if (j.isSidechain) continue;   // percakapan subagen, bukan percakapan kita

        if (j.type === 'user' && j.origin && j.origin.kind === 'human') {
            flushClaude();
            const teks = bersihkan(ambilTeks(j.message));
            if (teks) entries.push({ role: 'user', time: waktuLokal(j.timestamp), text: teks });

        } else if (j.type === 'assistant') {
            const teks = ambilTeks(j.message);
            if (teks && teks.trim()) {
                if (!waktuClaude) waktuClaude = waktuLokal(j.timestamp);
                bufferClaude.push(teks);
            }
        }
    }

    flushClaude();

    return { entries: entries, totalBaris: baris.length };
}


// ============================================================
// APPS SCRIPT
// ============================================================
function urlGas() {
    const url = process.env.GAS_CHATLOG_URL;

    if (!url || url.indexOf('GANTI_DENGAN') > -1) {
        throw new Error('GAS_CHATLOG_URL belum diisi di .env. Deploy gas/GAS_ChatLog.js lalu tempel URL /exec-nya.');
    }

    return url;
}

async function panggilGas(url, opsi) {
    const response = await fetch(url, Object.assign({
        redirect: 'follow',
        signal: AbortSignal.timeout(45000)
    }, opsi));

    const text = await response.text();

    let hasil;
    try {
        hasil = JSON.parse(text);
    } catch (e) {
        throw new Error('Respon Apps Script bukan JSON. Pastikan deployment "Who has access" = Anyone.');
    }

    if (hasil.status !== 'success') throw new Error(hasil.message || 'Permintaan gagal.');

    return hasil;
}

/** Kemajuan dibaca dari penanda di dalam Doc, bukan dari catatan lokal. */
async function ambilProgress() {
    return panggilGas(urlGas() + '?action=getProgress', { method: 'GET' });
}

async function kirim(sessionId, entries, sampaiBaris) {
    return panggilGas(urlGas(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'appendChat',
            sessionId: sessionId,
            entries: entries,
            sampaiBaris: sampaiBaris
        })
    });
}


// ============================================================
// MAIN
// ============================================================
async function main() {
    const payload = bacaPayloadHook();

    // Kemajuan selalu ditanyakan ke Doc. Saat --dry-run, kegagalan jaringan /
    // konfigurasi tidak dianggap fatal supaya pratinjau tetap bisa dilihat.
    let progress = { sesi: {}, karakter: null };

    if (IMPORT_SEMUA) {
        console.log('--import: kemajuan di Doc diabaikan, semua sesi dikirim dari awal.');
    } else {
        try {
            progress = await ambilProgress();
            console.log('Doc "' + progress.docName + '": ' + progress.karakter + ' karakter, '
                + Object.keys(progress.sesi).length + ' sesi tercatat.');
        } catch (e) {
            if (!DRY_RUN) throw e;
            console.log('(kemajuan Doc tidak terbaca: ' + e.message + ')');
        }
    }

    let daftar;

    if (IMPORT_SEMUA) {
        if (!fs.existsSync(DIR_TRANSKRIP)) {
            console.error('Folder transkrip tidak ditemukan: ' + DIR_TRANSKRIP);
            return;
        }
        daftar = fs.readdirSync(DIR_TRANSKRIP)
            .filter(function (f) { return f.endsWith('.jsonl'); })
            .map(function (f) { return path.join(DIR_TRANSKRIP, f); })
            .sort(function (a, b) { return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs; });
    } else {
        const file = pilihTranskrip(payload);
        if (!file) {
            console.error('Transkrip sesi tidak ditemukan di ' + DIR_TRANSKRIP);
            return;                 // jangan bikin hook gagal
        }
        daftar = [file];
    }

    for (const file of daftar) {
        const sessionId = path.basename(file, '.jsonl');
        const mulai = IMPORT_SEMUA ? 0 : (progress.sesi[sessionId] || 0);

        const hasilPilah = pilahTranskrip(file, mulai);
        const entries = hasilPilah.entries;

        console.log(sessionId.slice(0, 8) + ': baris ' + mulai + ' -> ' + hasilPilah.totalBaris
            + ', ' + entries.length + ' entri percakapan');

        if (!entries.length) continue;

        if (DRY_RUN) {
            console.log('\n=== ' + sessionId + '  (baris ' + mulai + ' -> ' + hasilPilah.totalBaris + ') ===');
            entries.forEach(function (en) {
                const potong = en.text.length > 300 ? en.text.slice(0, 300) + ' ...' : en.text;
                console.log('\n[' + (en.role === 'user' ? 'ANDA' : 'CLAUDE') + ' ' + en.time + ']\n' + potong);
            });
            console.log('\n(' + entries.length + ' entri - dry run, tidak dikirim)');
            continue;
        }

        const hasil = await kirim(sessionId, entries, hasilPilah.totalBaris);
        console.log('  -> Apps Script: ' + hasil.message);

        // Kalau Doc tidak menerima sebanyak yang dikirim, penandanya tidak boleh
        // dipercaya: laporkan keras supaya tidak ada percakapan yang hilang diam-diam.
        if (hasil.ditulis !== entries.length) {
            throw new Error('Doc hanya menerima ' + hasil.ditulis + ' dari ' + entries.length
                + ' entri. Jalankan lagi setelah sebabnya diperbaiki.');
        }

        console.log('  -> ' + entries.length + ' entri tercatat di Doc'
            + (typeof hasil.karakter === 'number' ? ' (' + hasil.karakter + ' karakter).' : '.'));
    }
}

main().catch(function (err) {
    console.error('Gagal mencatat percakapan: ' + err.message);
    // process.exit() bisa memotong tulisan stdout yang belum sempat keluar di
    // Windows - pakai exitCode supaya pesannya dijamin terbaca.
    process.exitCode = 1;          // hook melaporkan error, sesi tetap jalan
});
