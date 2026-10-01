/**
 * ============================================================
 * GAS CHAT LOG - Chickin Enterprise Portal
 * ============================================================
 * Menerima potongan percakapan Claude Code dari tools/log-chat.js
 * lalu menuliskannya ke satu Google Doc.
 *
 * File ini TERPISAH dari GAS_Code.js dan GAS_Inventory.js.
 * Deploy sebagai Web App tersendiri, URL /exec disimpan di .env
 * pada variabel GAS_CHATLOG_URL.
 *
 * CARA DEPLOY:
 * 1. Buka https://script.google.com -> New Project
 * 2. Paste seluruh isi file ini
 * 3. Deploy > New deployment > Type: Web app
 *    - Execute as        : Me
 *    - Who has access    : Anyone
 * 4. Copy URL /exec, paste ke .env -> GAS_CHATLOG_URL=...
 *
 * Jalankan testTulis() sekali dari editor untuk memicu dialog izin
 * akses Google Docs sebelum dipakai dari luar.
 *
 * ------------------------------------------------------------
 * KEMAJUAN DISIMPAN DI DALAM DOC ITU SENDIRI
 * ------------------------------------------------------------
 * Tiap selesai menulis, satu paragraf penanda ditinggalkan di akhir
 * Doc:  [[chatlog sesi=<sessionId> baris=<n>]]
 *
 * Penanda itulah yang dibaca action getProgress untuk tahu percakapan
 * sudah tercatat sampai mana. Akibatnya Doc menjadi satu-satunya sumber
 * kebenaran: kalau isinya Anda hapus, penandanya ikut hilang dan
 * percakapan otomatis dicatat ulang dari awal - tanpa catatan apa pun
 * di sisi klien yang perlu disamakan.
 * ============================================================
 */

// Doc tujuan: https://docs.google.com/document/d/<ID>/edit
var DOC_ID = '1Fejxe0DJVn6StO0sHK9mXZYRjNfTTLwirxGrtafdSm0';

var TZ = 'Asia/Jakarta';

// Google Doc mentok di sekitar 1.000.000 karakter. Di atas ambang ini
// penulisan ditolak dengan pesan jelas, bukan error mentah dari DocumentApp.
var BATAS_KARAKTER = 900000;

var BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Penanda kemajuan. Sengaja berupa teks biasa supaya ikut terhapus kalau
// isi Doc dibersihkan manual - itu justru yang membuat pencatatan ulang
// berjalan sendiri.
var AWALAN_PENANDA = '[[chatlog sesi=';

function polaPenanda() {
    // Dibuat baru tiap dipakai: RegExp global menyimpan lastIndex, dan
    // satu objek yang dipakai ulang akan melewatkan hasil pada panggilan kedua.
    return /\[\[chatlog sesi=([^\s\]]+) baris=(\d+)\]\]/g;
}


// ============================================================
// ROUTER
// ============================================================
function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    var output;

    try {
        var data = {};
        var action = 'ping';

        if (e && e.postData && e.postData.contents) {
            data = JSON.parse(e.postData.contents);
            action = data.action || 'appendChat';
        } else if (e && e.parameter && e.parameter.action) {
            action = e.parameter.action;
            data = e.parameter;
        }

        switch (action) {
            case 'ping': output = ping(); break;
            case 'getProgress': output = getProgress(); break;
            case 'appendChat': output = appendChat(data); break;
            default:
                output = { status: 'error', message: 'Aksi tidak dikenali: ' + action };
        }

    } catch (err) {
        output = { status: 'error', message: err.toString() };
    }

    return ContentService.createTextOutput(JSON.stringify(output))
        .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// ACTIONS
// ============================================================
function ping() {
    var doc = DocumentApp.openById(DOC_ID);

    return {
        status: 'success',
        message: 'Chat log API aktif',
        docName: doc.getName(),
        karakter: doc.getBody().getText().length,
        time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')
    };
}

/**
 * Baca kemajuan langsung dari isi Doc.
 *
 * Mengembalikan { sesi: { "<sessionId>": <baris terakhir>, ... } }.
 * Sesi yang penandanya tidak ada (Doc baru, atau isinya sudah dihapus)
 * otomatis tidak muncul - klien akan menganggapnya mulai dari nol.
 */
function getProgress() {
    var doc = DocumentApp.openById(DOC_ID);
    var teks = doc.getBody().getText();

    var sesi = {};
    var pola = polaPenanda();
    var m;

    while ((m = pola.exec(teks)) !== null) {
        var baris = Number(m[2]);
        // Penanda lama bisa saja tertinggal; yang dipakai selalu yang terbesar.
        if (!sesi[m[1]] || baris > sesi[m[1]]) sesi[m[1]] = baris;
    }

    return {
        status: 'success',
        docName: doc.getName(),
        karakter: teks.length,
        sesi: sesi
    };
}

/**
 * Tulis entri percakapan ke Doc, lalu perbarui penanda kemajuan.
 *
 * data.entries     = [{ role: 'user'|'assistant', time: '01/10/2026 11.45', text: '...' }]
 * data.sessionId   = id sesi Claude Code
 * data.sampaiBaris = nomor baris transkrip terakhir yang termuat di entries
 *
 * Dibungkus LockService: dua sesi Claude Code yang jalan bersamaan bisa
 * mengirim di saat yang sama, dan DocumentApp tidak aman dari penulisan
 * paralel - entri bisa saling menimpa.
 */
function appendChat(data) {
    var entries = data.entries || [];
    if (!entries.length) return { status: 'success', message: 'Tidak ada entri baru.', ditulis: 0 };

    var lock = LockService.getScriptLock();

    try {
        lock.waitLock(30000);
    } catch (e) {
        return { status: 'error', message: 'Penulisan lain sedang berjalan, coba lagi sebentar.' };
    }

    try {
        var doc = DocumentApp.openById(DOC_ID);
        var body = doc.getBody();
        var teksAwal = body.getText();

        if (teksAwal.length > BATAS_KARAKTER) {
            return {
                status: 'error',
                message: 'Doc sudah melewati ' + BATAS_KARAKTER + ' karakter. '
                    + 'Buat Doc baru dan perbarui DOC_ID di GAS_ChatLog.js.'
            };
        }

        // Judul ditentukan dari isi Doc, bukan dari catatan tersembunyi: begitu
        // isi Doc dihapus, judulnya ikut ditulis ulang dengan sendirinya.
        tulisJudulBulan(body, teksAwal);
        tulisJudulSesi(body, teksAwal, data.sessionId);

        entries.forEach(function (en) {
            var judul = (en.role === 'user' ? 'Anda' : 'Claude') + '  -  ' + (en.time || '');

            body.appendParagraph(judul)
                .setHeading(DocumentApp.ParagraphHeading.HEADING4);

            // Tiap baris jadi paragraf sendiri supaya teks panjang tetap terbaca
            // di Doc (appendParagraph tidak memecah "\n" sendiri).
            String(en.text || '').split('\n').forEach(function (baris) {
                body.appendParagraph(baris).setHeading(DocumentApp.ParagraphHeading.NORMAL);
            });
        });

        perbaruiPenanda(body, data.sessionId, data.sampaiBaris);

        var karakter = body.getText().length;
        doc.saveAndClose();

        return {
            status: 'success',
            message: entries.length + ' entri ditulis ke Doc.',
            ditulis: entries.length,
            karakter: karakter,
            sampaiBaris: Number(data.sampaiBaris) || null
        };

    } finally {
        lock.releaseLock();
    }
}


// ============================================================
// HELPER
// ============================================================
function labelBulan() {
    var now = new Date();
    return BULAN_ID[Number(Utilities.formatDate(now, TZ, 'MM')) - 1]
        + ' ' + Utilities.formatDate(now, TZ, 'yyyy');
}

/** Judul bulan ditulis sekali per bulan - dicek dari isi Doc. */
function tulisJudulBulan(body, teksDoc) {
    var label = labelBulan();
    if (teksDoc.indexOf(label) > -1) return;

    body.appendParagraph(label).setHeading(DocumentApp.ParagraphHeading.HEADING1);
}

/** Judul sesi ditulis sekali per sessionId - ditandai ada/tidaknya penanda sesi itu. */
function tulisJudulSesi(body, teksDoc, sessionId) {
    if (!sessionId) return;
    if (teksDoc.indexOf(AWALAN_PENANDA + sessionId + ' ') > -1) return;

    body.appendParagraph('Sesi ' + String(sessionId).slice(0, 8)
        + '  -  dimulai ' + Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'))
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
}

/**
 * Buang penanda lama sesi ini, lalu tulis penanda baru di akhir Doc.
 * Dibuang supaya Doc tidak menumpuk satu baris penanda tiap kali hook jalan.
 */
function perbaruiPenanda(body, sessionId, sampaiBaris) {
    if (!sessionId || !sampaiBaris) return;

    var awalan = AWALAN_PENANDA + sessionId + ' ';
    var paragraf = body.getParagraphs();
    var buang = [];

    for (var i = 0; i < paragraf.length; i++) {
        if (paragraf[i].getText().indexOf(awalan) === 0) buang.push(paragraf[i]);
    }

    // Body wajib menyisakan minimal satu paragraf; DocumentApp melempar error
    // kalau paragraf terakhir dibuang.
    for (var j = 0; j < buang.length; j++) {
        if (body.getParagraphs().length <= 1) break;
        buang[j].removeFromParent();
    }

    var penanda = body.appendParagraph(awalan + 'baris=' + sampaiBaris + ']]');
    penanda.setHeading(DocumentApp.ParagraphHeading.NORMAL);

    // Dibuat kecil dan abu-abu supaya tidak mengganggu saat Doc dibaca orang.
    penanda.editAsText().setFontSize(6).setForegroundColor('#b0b0b0');
}


/** Jalankan sekali dari editor Apps Script untuk memicu dialog izin akses Docs. */
function testTulis() {
    var hasil = appendChat({
        sessionId: 'uji-coba',
        sampaiBaris: 1,
        entries: [
            { role: 'user', time: 'uji coba', text: 'Ini baris uji dari editor Apps Script.' },
            { role: 'assistant', time: 'uji coba', text: 'Kalau baris ini muncul di Doc, izin akses sudah benar.' }
        ]
    });

    Logger.log(JSON.stringify(hasil));
    Logger.log(JSON.stringify(getProgress()));
}
