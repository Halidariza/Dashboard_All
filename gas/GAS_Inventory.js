/**
 * ============================================================
 * GAS INVENTORY ASET - Chickin Enterprise Portal
 * ============================================================
 * File ini TERPISAH dari GAS_Code.js (Drive/MQTT Connector).
 * Deploy sebagai Web App tersendiri, lalu simpan URL-nya di .env
 * pada variabel GAS_INVENTORY_URL.
 *
 * CARA DEPLOY:
 * 1. Buka https://script.google.com -> New Project
 * 2. Paste seluruh isi file ini
 * 3. Deploy > New deployment > Type: Web app
 *    - Execute as        : Me
 *    - Who has access    : Anyone
 * 4. Copy URL /exec, paste ke .env -> GAS_INVENTORY_URL=...
 * ============================================================
 */

// ---------- KONFIGURASI ----------
var SPREADSHEET_ID = '1IbKZWf9sOLyADxx2Et-ZKZy1Y6CF6FdA8m1oLoFPw8Q';

// Sheet dipetakan lewat GID (bukan nama) supaya aman kalau tab di-rename.
var GID_INVENTORY = 0;          // Id, Nama Aset, Kategori, Merk, Kondisi, Lokasi, Status, Tgl Masuk, Umur
var GID_KELUAR = 415162369;     // Peminjaman: Tanggal, Id, Nama Aset, Kategori, Merk, Kondisi Keluar, Lokasi, Status, Tgl Rencana Kembali, Document
var GID_MASTER = 631641782;     // Nama Aset, Kategori, Merk, Kondisi, Lokasi, Status

var SCRIPT_VERSION = '2026-09-02-b-id-urut';

// Sheet berisi daftar pilihan form. Tiap kolom = satu field (Kategori, Kondisi,
// Status, dst), isi di bawah header = pilihannya. Dicari berdasarkan nama tab.
var NAMA_SHEET_DROPDOWN = 'dropdown';

// Sheet catatan pengembalian. Dibuat otomatis kalau belum ada.
var NAMA_SHEET_PENGEMBALIAN = 'Pengembalian';   // dikembalikan oleh action ping, untuk cek versi mana yang live

// Sheet undian petugas. Kolom "Calon Kandidat" = daftar induk (tidak pernah diubah),
// kolom "Kandidat" = kumpulan yang masih boleh keluar; yang sudah terpilih dicoret dari sini.
var NAMA_SHEET_PETUGAS = 'Petugas';
var KOL_CALON_KANDIDAT = 'Calon Kandidat';
var KOL_KANDIDAT = 'Kandidat';

// Catatan hasil undian. Dibuat otomatis kalau tabnya belum ada.
var NAMA_SHEET_HISTORY_PETUGAS = 'History Petugas';
var HEADER_HISTORY_PETUGAS = ['Tanggal', 'Nama Petugas'];

// Judul kolom tab history dicocokkan longgar: tab ini sering dibuat manual dengan
// judul karangan sendiri ("Nama", "PETUGAS", "Tgl"), dan pencocokan persis
// membuat datanya diam-diam masuk ke kolom yang salah / tidak masuk sama sekali.
var KUNCI_KOL_TANGGAL = ['tanggal', 'tgl', 'waktu', 'date'];
var KUNCI_KOL_NAMA = ['nama petugas', 'petugas', 'nama'];

var ID_PREFIX = 'CHP';

// Kode tetap di tengah Id aset. Ini BUKAN tanggal - semua aset memakai kode yang
// sama, hanya 5 digit terakhir yang berjalan. Sebelumnya bagian ini diisi tanggal
// pembuatan sehingga Id tidak bisa diurutkan.
var ID_KODE_TETAP = '20200729';

// Urutan terakhir disimpan terpisah supaya nomor tidak terpakai ulang setelah
// baris dihapus - memindai sheet saja membuat nomor bekas aset yang dihapus
// diberikan lagi ke aset baru.
var PROP_URUTAN_ASET = 'urutanAsetTerakhir';
var TZ = 'Asia/Jakarta';

// Folder Drive tujuan upload foto dokumen peminjaman.
// https://drive.google.com/drive/folders/1EXK0tqLjjH1qUugdGuG04GZnS1trcDaJ
var DRIVE_FOLDER_ID = '1EXK0tqLjjH1qUugdGuG04GZnS1trcDaJ';

// Folder Drive tujuan upload foto bukti pengembalian.
// https://drive.google.com/drive/folders/1iFXpuLIqqMt2-XgCcBB7WOcCiBnW7GXM
var DRIVE_FOLDER_PENGEMBALIAN_ID = '1iFXpuLIqqMt2-XgCcBB7WOcCiBnW7GXM';

// Folder Drive tujuan upload foto aset (dipakai saat menambah aset baru).
// https://drive.google.com/drive/folders/1PmsCpqVZ2041apP-hf_25MSeCvAIvk-V
var DRIVE_FOLDER_ASET_ID = '1PmsCpqVZ2041apP-hf_25MSeCvAIvk-V';

// Header baku tiap sheet (dipakai saat sheet masih kosong)
var HEADER_INVENTORY = ['Id', 'Nama Aset', 'Kategori', 'Merk', 'Kondisi', 'Lokasi', 'Status', 'Tgl Masuk', 'Umur', 'Dokumen'];
var HEADER_KELUAR = ['Tanggal', 'Id', 'Nama Aset', 'Kategori', 'Merk', 'Kondisi Keluar', 'Lokasi', 'Status', 'Tgl Rencana Kembali', 'Document'];
var HEADER_MASTER = ['Nama Aset', 'Kategori', 'Merk', 'Kondisi', 'Lokasi', 'Status'];
var HEADER_PENGEMBALIAN = ['Tanggal Kembali', 'Id', 'Nama Aset', 'Kategori', 'Merk', 'Kondisi Kembali',
    'Lokasi', 'Status', 'Tanggal Pinjam', 'Tgl Rencana Kembali', 'Terlambat (hari)', 'Document',
    'Foto Pengembalian'];


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
        var action = 'getInventory';

        if (e && e.postData && e.postData.contents) {
            data = JSON.parse(e.postData.contents);
            action = data.action || 'getInventory';
        } else if (e && e.parameter && e.parameter.action) {
            action = e.parameter.action;
            data = e.parameter;
        }

        switch (action) {
            case 'ping': output = { status: 'success', message: 'Inventory API aktif', version: SCRIPT_VERSION, time: nowString() }; break;
            case 'bootstrap': output = bootstrap(); break;
            case 'getInventory': output = getInventory(); break;
            case 'getMaster': output = getMaster(); break;
            case 'getKeluar': output = getKeluar(); break;
            case 'getStats': output = getStats(); break;
            case 'addAsset': output = addAsset(data); break;
            case 'updateAsset': output = updateAsset(data); break;
            case 'deleteAsset': output = deleteAsset(data); break;
            case 'checkOut': output = checkOut(data); break;
            case 'checkIn': output = checkIn(data); break;
            case 'addMaster': output = addMaster(data); break;
            case 'uploadDocument': output = uploadDocument(data); break;
            case 'checkDrive': output = checkDrive(); break;
            case 'setDocument': output = setDocument(data); break;
            case 'setFotoPengembalian': output = setFotoPengembalian(data); break;
            case 'refreshUmur': output = refreshUmur(); break;
            case 'getPengembalian': output = getPengembalian(); break;
            case 'getPetugas': output = getPetugas(); break;
            case 'spinPetugas': output = spinPetugas(data); break;
            case 'resetPetugas': output = resetPetugas(); break;
            case 'getHistoryPetugas': output = getHistoryPetugas(); break;
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
// HELPER SHEET
// ============================================================
function getSS() {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/** Ambil sheet berdasarkan GID. */
function sheetByGid(gid) {
    var sheets = getSS().getSheets();
    for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].getSheetId() === gid) return sheets[i];
    }
    throw new Error('Sheet dengan gid ' + gid + ' tidak ditemukan.');
}

/** Pastikan baris header ada. Tidak menimpa header yang sudah terisi. */
function ensureHeader(sheet, header) {
    if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, header.length).setValues([header]);
        sheet.getRange(1, 1, 1, header.length)
            .setFontWeight('bold')
            .setBackground('#425C6D')
            .setFontColor('#FFFFFF')
            .setHorizontalAlignment('center');
        sheet.setFrozenRows(1);
    }
    return sheet;
}

/**
 * Pastikan satu kolom ada di sheet yang sudah berisi data.
 * ensureHeader hanya menulis header saat sheet masih kosong, jadi kolom yang
 * ditambahkan belakangan (mis. Dokumen) tidak akan pernah muncul di sheet lama.
 * Mengembalikan nomor kolomnya.
 */
function pastikanKolom(sheet, nama) {
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var col = colIndex(header, nama);
    if (col) return col;

    col = lastCol + 1;
    sheet.getRange(1, col)
        .setValue(nama)
        .setFontWeight('bold')
        .setBackground('#425C6D')
        .setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');

    return col;
}

/** Tulis satu baris mengikuti urutan header aktual di sheet (kolom tak dikenal dibiarkan kosong). */
function appendByHeader(sheet, map) {
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var row = [];

    for (var i = 0; i < header.length; i++) {
        var key = String(header[i]).trim();
        row.push(map.hasOwnProperty(key) ? map[key] : '');
    }

    sheet.appendRow(row);
}

/** Baca sheet jadi array of object memakai baris 1 sebagai key. */
function readRows(sheet) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return { header: [], rows: [] };

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var header = values[0];
    var rows = [];

    for (var r = 1; r < values.length; r++) {
        var obj = { _row: r + 1 };
        var isEmpty = true;
        for (var c = 0; c < header.length; c++) {
            var key = String(header[c]).trim();
            if (!key) continue;
            var val = values[r][c];
            if (val !== '' && val !== null) isEmpty = false;
            obj[key] = normalizeValue(val);
        }
        if (!isEmpty) rows.push(obj);
    }

    return { header: header, rows: rows };
}

function normalizeValue(val) {
    if (val instanceof Date) return Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
    return val === null ? '' : val;
}

function nowString() {
    return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function todayString() {
    return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/**
 * Sheet Master, hanya kalau headernya benar-benar layout master.
 * Tab master lama bisa saja sudah di-rename/dipakai ulang untuk keperluan lain
 * (mis. jadi tab Pengembalian) - dalam kondisi itu jangan disentuh sama sekali.
 */
function sheetMasterAman() {
    try {
        var sheet = sheetByGid(GID_MASTER);
        if (sheet.getLastRow() === 0) return sheet;    // masih kosong -> aman dipakai

        var header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
        var wajib = ['Nama Aset', 'Kategori', 'Merk', 'Kondisi', 'Lokasi', 'Status'];

        for (var i = 0; i < wajib.length; i++) {
            if (!colIndex(header, wajib[i])) return null;
        }

        // Header khas sheet lain -> bukan master
        if (colIndex(header, 'Tanggal') || colIndex(header, 'Kondisi Keluar') || colIndex(header, 'Id')) {
            return null;
        }

        return sheet;
    } catch (e) {
        return null;
    }
}

/** Sheet catatan pengembalian - dibuat beserta headernya kalau belum ada. */
function sheetPengembalian() {
    var sheet = sheetByName(NAMA_SHEET_PENGEMBALIAN);

    if (!sheet) {
        sheet = getSS().insertSheet(NAMA_SHEET_PENGEMBALIAN);
    }

    ensureHeader(sheet, HEADER_PENGEMBALIAN);

    // Sheet lama dibuat tanpa kolom foto - tambahkan di ujung kanan supaya
    // data yang sudah ada tidak bergeser.
    return ensureExtraColumn(sheet, 'Foto Pengembalian');
}

/** Tambahkan satu kolom di ujung kanan sheet kalau headernya belum ada. */
function ensureExtraColumn(sheet, name) {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return sheet;

    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (colIndex(header, name)) return sheet;

    var kolomBaru = lastCol + 1;
    sheet.getRange(1, kolomBaru)
        .setValue(name)
        .setFontWeight('bold')
        .setBackground('#425C6D')
        .setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');

    return sheet;
}

/** Selisih hari b - a. '' kalau salah satu tanggal tidak terbaca. */
function selisihHari(a, b) {
    var x = parseTanggal(a);
    var y = parseTanggal(b);
    if (!x || !y) return '';

    return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
}

/** Cari sheet berdasarkan nama tab (tidak peduli besar kecil huruf). null kalau tidak ada. */
function sheetByName(nama) {
    var sheets = getSS().getSheets();
    var target = String(nama).trim().toLowerCase();

    for (var i = 0; i < sheets.length; i++) {
        if (String(sheets[i].getName()).trim().toLowerCase() === target) return sheets[i];
    }
    return null;
}

/**
 * Baca sheet daftar pilihan (NAMA_SHEET_DROPDOWN).
 * Tiap kolom jadi satu daftar: baris 1 = nama field, baris berikutnya = pilihannya.
 * Sel kosong dilewati, jadi kolom boleh beda-beda panjangnya.
 */
function dropdownSheetOptions() {
    var out = {};

    try {
        var sheet = sheetByName(NAMA_SHEET_DROPDOWN);
        if (!sheet) return out;

        var lastRow = sheet.getLastRow();
        var lastCol = sheet.getLastColumn();
        if (lastRow < 2 || lastCol < 1) return out;

        var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
        var header = values[0];

        for (var c = 0; c < header.length; c++) {
            var key = String(header[c] || '').trim();
            if (!key) continue;

            var list = [];
            var seen = {};

            for (var r = 1; r < values.length; r++) {
                var raw = values[r][c];
                var v = String(raw === null || raw === undefined ? '' : raw).trim();
                if (v && !seen[v.toLowerCase()]) {
                    seen[v.toLowerCase()] = true;
                    list.push(v);
                }
            }

            if (list.length) out[key] = list;
        }
    } catch (e) {
        // Sheet daftar pilihan bersifat opsional
    }

    return out;
}

/**
 * Ambil pilihan dropdown (data validation) sebuah kolom di sheet.
 * Mendukung dua bentuk aturan: daftar diketik langsung (VALUE_IN_LIST)
 * maupun daftar yang menunjuk ke rentang sel lain (VALUE_IN_RANGE).
 * Mengembalikan [] kalau kolomnya tidak punya dropdown.
 */
function validationOptions(sheet, colName) {
    try {
        var lastCol = Math.max(sheet.getLastColumn(), 1);
        var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        var col = colIndex(header, colName);
        if (!col) return [];

        // Periksa sebagian baris saja - aturan validasi biasanya seragam sekolom.
        var jumlah = Math.min(Math.max(sheet.getLastRow() - 1, 1), 200);
        var rules = sheet.getRange(2, col, jumlah, 1).getDataValidations();

        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i][0];
            if (!rule) continue;

            var tipe = rule.getCriteriaType();
            var nilai = rule.getCriteriaValues();
            var daftar = [];

            if (tipe === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
                daftar = nilai[0] || [];
            } else if (tipe === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
                daftar = (nilai[0] ? nilai[0].getValues() : []).map(function (r) { return r[0]; });
            } else {
                continue;
            }

            var hasil = [];
            var seen = {};
            daftar.forEach(function (v) {
                var t = String(v === null || v === undefined ? '' : v).trim();
                if (t && !seen[t.toLowerCase()]) {
                    seen[t.toLowerCase()] = true;
                    hasil.push(t);
                }
            });

            if (hasil.length) return hasil;   // aturan pertama yang ketemu sudah mewakili
        }

        return [];
    } catch (e) {
        return [];   // validasi bersifat opsional - jangan sampai menggagalkan getMaster
    }
}

/** Cari index kolom (1-based) berdasarkan nama header. 0 kalau tidak ada. */
function colIndex(header, name) {
    for (var i = 0; i < header.length; i++) {
        if (String(header[i]).trim().toLowerCase() === String(name).trim().toLowerCase()) return i + 1;
    }
    return 0;
}


// ============================================================
// ID GENERATOR  ->  CHP + ddMMyyyy + urut 5 digit
// ============================================================
function generateAssetId(sheet) {
    var props = PropertiesService.getScriptProperties();
    var tersimpan = parseInt(props.getProperty(PROP_URUTAN_ASET) || '0', 10) || 0;

    // Sheet tetap dipindai sebagai jaring pengaman: kalau properti belum ada
    // (script baru dipasang) penomoran tidak mengulang dari nol dan menabrak
    // Id yang sudah dipakai.
    var maxSheet = 0;
    var lastRow = sheet.getLastRow();

    if (lastRow > 1) {
        var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
            var id = String(ids[i][0] || '');
            if (id.indexOf(ID_PREFIX) !== 0 || id.length < 5) continue;

            var seq = parseInt(id.slice(-5), 10);
            if (!isNaN(seq) && seq > maxSheet) maxSheet = seq;
        }
    }

    var next = Math.max(tersimpan, maxSheet) + 1;
    props.setProperty(PROP_URUTAN_ASET, String(next));

    return ID_PREFIX + ID_KODE_TETAP + ('00000' + next).slice(-5);
}

/** Pecah tanggal jadi {y, m, d}. Menerima Date, 'yyyy-MM-dd', atau 'dd-MM-yyyy'. */
function parseTanggal(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
        return {
            y: Number(Utilities.formatDate(v, TZ, 'yyyy')),
            m: Number(Utilities.formatDate(v, TZ, 'MM')),
            d: Number(Utilities.formatDate(v, TZ, 'dd'))
        };
    }

    var s = String(v || '').trim();
    if (!s) return null;

    var iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };

    var lokal = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (lokal) return { y: Number(lokal[3]), m: Number(lokal[2]), d: Number(lokal[1]) };

    return null;
}

/**
 * Umur aset: selisih Tgl Masuk sampai hari ini, memakai kalender sungguhan
 * (bukan asumsi 30 hari per bulan). Selalu dihitung ulang, tidak disimpan permanen.
 */
function hitungUmur(tglMasuk) {
    var s = parseTanggal(tglMasuk);
    if (!s) return '';

    var t = parseTanggal(new Date());

    var hari = Math.floor((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(s.y, s.m - 1, s.d)) / 86400000);
    if (hari < 0) return '';
    if (hari < 30) return hari + ' hari';

    var bulan = (t.y - s.y) * 12 + (t.m - s.m);
    if (t.d < s.d) bulan--;
    if (bulan < 1) return hari + ' hari';       // mis. 30 hari tapi belum genap sebulan
    if (bulan < 12) return bulan + ' bulan';

    var tahun = Math.floor(bulan / 12);
    var sisa = bulan % 12;
    return sisa > 0 ? tahun + ' thn ' + sisa + ' bln' : tahun + ' tahun';
}


// ============================================================
// ACTIONS - READ
// ============================================================
function bootstrap() {
    ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    ensureHeader(sheetByGid(GID_KELUAR), HEADER_KELUAR);
    var m = sheetMasterAman();
    if (m) ensureHeader(m, HEADER_MASTER);
    sheetPengembalian();       // dibuat kalau tabnya belum ada
    sheetHistoryPetugas();     // idem

    return {
        status: 'success',
        message: 'Struktur sheet siap digunakan (termasuk tab Pengembalian & History Petugas).'
    };
}

function getInventory() {
    var sheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var data = readRows(sheet);

    var items = data.rows.map(function (r) {
        return {
            id: r['Id'] || '',
            nama: r['Nama Aset'] || '',
            kategori: r['Kategori'] || '',
            merk: r['Merk'] || '',
            kondisi: r['Kondisi'] || '',
            lokasi: r['Lokasi'] || '',
            status: r['Status'] || '',
            tglMasuk: r['Tgl Masuk'] || '',
            umur: hitungUmur(r['Tgl Masuk']) || r['Umur'] || '',
            dokumen: r['Dokumen'] || '',
            row: r._row
        };
    });

    return { status: 'success', items: items, total: items.length };
}

function getKeluar() {
    var sheet = ensureHeader(sheetByGid(GID_KELUAR), HEADER_KELUAR);
    var data = readRows(sheet);

    var items = data.rows.map(function (r) {
        return {
            tanggal: r['Tanggal'] || '',
            id: r['Id'] || '',
            nama: r['Nama Aset'] || '',
            kategori: r['Kategori'] || '',
            merk: r['Merk'] || '',
            kondisiKeluar: r['Kondisi Keluar'] || '',
            lokasi: r['Lokasi'] || '',
            status: r['Status'] || '',
            tglKembali: r['Tgl Rencana Kembali'] || '',
            dokumen: r['Document'] || '',
            row: r._row
        };
    });

    // Terbaru di atas
    items.reverse();

    return { status: 'success', items: items, total: items.length };
}

/**
 * Opsi dropdown untuk form di dashboard.
 *
 * Urutan sumber:
 *   1. Sheet daftar pilihan (tab "dropdown") - kolomnya dicocokkan dengan nama field.
 *   2. Dropdown (data validation) kolom terkait di sheet Inventory, lalu sheet Master.
 *   3. Nilai yang sudah terpakai di sheet Master & Inventory (diurutkan A-Z),
 *      supaya data lama tetap muncul walau tidak ada di daftar pilihan.
 *
 * Urutan dari sumber 1 & 2 dipertahankan persis seperti di spreadsheet.
 */
function getMaster() {
    var invSheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var masterSheet = sheetMasterAman();
    var keluarSheet = ensureHeader(sheetByGid(GID_KELUAR), HEADER_KELUAR);

    var master = masterSheet ? readRows(masterSheet) : { header: [], rows: [] };
    var inv = readRows(invSheet);

    var fields = ['Nama Aset', 'Kategori', 'Merk', 'Kondisi', 'Lokasi', 'Status'];
    var out = {};
    var fromValidation = {};
    var sumber = {};

    var daftarSheet = dropdownSheetOptions();

    /** Cocokkan nama field dengan header kolom di sheet daftar pilihan. */
    function dariSheetDropdown(f) {
        var target = f.toLowerCase();

        for (var key in daftarSheet) {
            var k = key.trim().toLowerCase();
            if (k === target) return daftarSheet[key];
            if (target === 'nama aset' && (k === 'nama' || k === 'aset')) return daftarSheet[key];
        }
        return [];
    }

    fields.forEach(function (f) {
        var seen = {};
        var list = [];

        function tambah(v) {
            var t = String(v === null || v === undefined ? '' : v).trim();
            if (!t || seen[t.toLowerCase()]) return false;
            seen[t.toLowerCase()] = true;
            list.push(t);
            return true;
        }

        // 1. Sheet daftar pilihan
        var dropdown = dariSheetDropdown(f);
        sumber[f] = dropdown.length ? 'sheet-dropdown' : '';

        // 2. Data validation kolomnya
        if (!dropdown.length) {
            dropdown = validationOptions(invSheet, f);
            if (!dropdown.length && masterSheet) dropdown = validationOptions(masterSheet, f);
            if (dropdown.length) sumber[f] = 'validasi-kolom';
        }

        dropdown.forEach(tambah);
        fromValidation[f] = dropdown.length;

        // 3. Nilai yang sudah dipakai, ditambahkan di belakang
        var tambahan = [];
        [master.rows, inv.rows].forEach(function (rows) {
            rows.forEach(function (r) {
                var t = String(r[f] || '').trim();
                if (t && !seen[t.toLowerCase()]) {
                    seen[t.toLowerCase()] = true;
                    tambahan.push(t);
                }
            });
        });

        tambahan.sort();
        list = list.concat(tambahan);

        if (!sumber[f]) sumber[f] = tambahan.length ? 'nilai-terpakai' : 'kosong';

        out[f] = list;
    });

    // Status khusus form peminjaman: kolom "Status Peminjaman" di sheet daftar
    // pilihan, atau dropdown kolom Status di sheet peminjaman itu sendiri.
    var statusKeluar = [];
    ['Status Peminjaman', 'Status Keluar'].forEach(function (nama) {
        if (statusKeluar.length) return;
        Object.keys(daftarSheet).forEach(function (key) {
            if (key.trim().toLowerCase() === nama.toLowerCase()) statusKeluar = daftarSheet[key];
        });
    });
    if (!statusKeluar.length) statusKeluar = validationOptions(keluarSheet, 'Status');

    return {
        status: 'success',
        options: {
            nama: out['Nama Aset'],
            kategori: out['Kategori'],
            merk: out['Merk'],
            kondisi: out['Kondisi'],
            lokasi: out['Lokasi'],
            status: out['Status'],
            statusKeluar: statusKeluar
        },
        // Dari mana daftar tiap field diambil - memudahkan mengecek konfigurasi spreadsheet
        sumber: {
            nama: sumber['Nama Aset'],
            kategori: sumber['Kategori'],
            merk: sumber['Merk'],
            kondisi: sumber['Kondisi'],
            lokasi: sumber['Lokasi'],
            status: sumber['Status']
        },
        // Berapa opsi yang berasal dari daftar pilihan (0 = tidak ada dropdown untuk kolom itu)
        dropdownCount: {
            nama: fromValidation['Nama Aset'],
            kategori: fromValidation['Kategori'],
            merk: fromValidation['Merk'],
            kondisi: fromValidation['Kondisi'],
            lokasi: fromValidation['Lokasi'],
            status: fromValidation['Status']
        }
    };
}

function getStats() {
    var inv = getInventory();
    var keluar = getKeluar();

    var perKategori = {};
    var perStatus = {};
    var perKondisi = {};

    inv.items.forEach(function (it) {
        var k = it.kategori || 'Lainnya';
        var s = it.status || 'Tidak Diketahui';
        var c = it.kondisi || 'Tidak Diketahui';
        perKategori[k] = (perKategori[k] || 0) + 1;
        perStatus[s] = (perStatus[s] || 0) + 1;
        perKondisi[c] = (perKondisi[c] || 0) + 1;
    });

    var tersedia = 0;
    var dipinjam = 0;
    inv.items.forEach(function (it) {
        var s = String(it.status || '').toLowerCase();
        if (s.indexOf('tersedia') > -1) tersedia++;
        else if (s) dipinjam++;
    });

    return {
        status: 'success',
        stats: {
            totalAset: inv.total,
            tersedia: tersedia,
            keluar: dipinjam,
            totalKeluar: keluar.total,
            perKategori: perKategori,
            perStatus: perStatus,
            perKondisi: perKondisi
        }
    };
}


// ============================================================
// ACTIONS - WRITE
// ============================================================
function addAsset(data) {
    if (!data.nama) return { status: 'error', message: 'Nama Aset wajib diisi.' };

    var sheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);

    try {
        var jumlah = Math.max(1, parseInt(data.jumlah || 1, 10) || 1);
        var tglMasuk = data.tglMasuk || todayString();
        var created = [];

        // Sheet lama belum punya kolom Dokumen; tambahkan sebelum menulis baris.
        pastikanKolom(sheet, 'Dokumen');

        for (var i = 0; i < jumlah; i++) {
            var newId = generateAssetId(sheet);

            // appendByHeader mengikuti urutan kolom yang benar-benar ada di sheet,
            // jadi aman walau ada kolom tambahan buatan pengguna di tengah.
            appendByHeader(sheet, {
                'Id': newId,
                'Nama Aset': data.nama,
                'Kategori': data.kategori || '',
                'Merk': data.merk || '',
                'Kondisi': data.kondisi || 'Baru',
                'Lokasi': data.lokasi || '',
                'Status': data.status || 'Tersedia',
                'Tgl Masuk': tglMasuk,
                'Umur': hitungUmur(tglMasuk),
                'Dokumen': data.dokumen || ''
            });

            created.push(newId);
        }

        // Simpan nilai baru ke sheet Master supaya jadi opsi dropdown berikutnya
        syncMaster(data);

        return {
            status: 'success',
            message: jumlah > 1 ? jumlah + ' aset berhasil ditambahkan.' : 'Aset berhasil ditambahkan.',
            ids: created
        };

    } finally {
        lock.releaseLock();
    }
}

function updateAsset(data) {
    if (!data.id) return { status: 'error', message: 'Id aset wajib diisi.' };

    var sheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var found = findRowById(sheet, data.id);
    if (!found) return { status: 'error', message: 'Aset dengan Id ' + data.id + ' tidak ditemukan.' };

    // Sheet lama belum punya kolom Dokumen - tanpa ini link foto akan hilang diam-diam.
    if (data.dokumen) pastikanKolom(sheet, 'Dokumen');

    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    var mapping = {
        'Nama Aset': data.nama,
        'Kategori': data.kategori,
        'Merk': data.merk,
        'Kondisi': data.kondisi,
        'Lokasi': data.lokasi,
        'Status': data.status,
        'Tgl Masuk': data.tglMasuk,
        'Dokumen': data.dokumen
    };

    Object.keys(mapping).forEach(function (key) {
        var val = mapping[key];
        if (val === undefined || val === null) return;   // field tidak dikirim -> jangan disentuh
        var col = colIndex(header, key);
        if (col) sheet.getRange(found, col).setValue(val);
    });

    // Refresh kolom Umur
    var colMasuk = colIndex(header, 'Tgl Masuk');
    var colUmur = colIndex(header, 'Umur');
    if (colMasuk && colUmur) {
        sheet.getRange(found, colUmur).setValue(hitungUmur(sheet.getRange(found, colMasuk).getValue()));
    }

    syncMaster(data);

    return { status: 'success', message: 'Aset ' + data.id + ' berhasil diperbarui.' };
}

function deleteAsset(data) {
    if (!data.id) return { status: 'error', message: 'Id aset wajib diisi.' };

    var sheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var found = findRowById(sheet, data.id);
    if (!found) return { status: 'error', message: 'Aset dengan Id ' + data.id + ' tidak ditemukan.' };

    sheet.deleteRow(found);

    return { status: 'success', message: 'Aset ' + data.id + ' berhasil dihapus.' };
}

/** Catat aset keluar / dipinjam. */
function checkOut(data) {
    if (!data.id) return { status: 'error', message: 'Id aset wajib diisi.' };

    var invSheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var row = findRowById(invSheet, data.id);
    if (!row) return { status: 'error', message: 'Aset dengan Id ' + data.id + ' tidak ditemukan.' };

    var header = invSheet.getRange(1, 1, 1, invSheet.getLastColumn()).getValues()[0];
    var values = invSheet.getRange(row, 1, 1, invSheet.getLastColumn()).getValues()[0];

    function get(name) {
        var c = colIndex(header, name);
        return c ? normalizeValue(values[c - 1]) : '';
    }

    var statusBaru = data.status || 'Dipinjam';

    // Aset yang sedang dipinjam / keluar tidak boleh dipinjam lagi
    var statusLama = String(get('Status') || '').toLowerCase();
    if (statusLama && statusLama.indexOf('tersedia') === -1 && !data.force) {
        return {
            status: 'error',
            message: 'Aset ' + data.id + ' sedang berstatus "' + get('Status') + '" dan belum dikembalikan.'
        };
    }

    // Catat ke sheet Peminjaman
    var outSheet = ensureHeader(sheetByGid(GID_KELUAR), HEADER_KELUAR);
    appendByHeader(outSheet, {
        'Tanggal': data.tanggal || todayString(),
        'Id': data.id,
        'Nama Aset': get('Nama Aset'),
        'Kategori': get('Kategori'),
        'Merk': get('Merk'),
        'Kondisi Keluar': data.kondisiKeluar || get('Kondisi'),
        'Lokasi': data.lokasi || get('Lokasi'),
        'Status': statusBaru,
        'Tgl Rencana Kembali': data.tglKembali || '',
        'Document': data.dokumen || ''
    });

    // Update status di sheet Inventory
    var colStatus = colIndex(header, 'Status');
    if (colStatus) invSheet.getRange(row, colStatus).setValue(statusBaru);

    if (data.lokasi) {
        var colLokasi = colIndex(header, 'Lokasi');
        if (colLokasi) invSheet.getRange(row, colLokasi).setValue(data.lokasi);
    }

    return { status: 'success', message: 'Peminjaman aset ' + data.id + ' tercatat (' + statusBaru + ').' };
}

/** Kembalikan aset: status jadi Tersedia + tandai baris keluar sebagai Kembali. */
function checkIn(data) {
    if (!data.id) return { status: 'error', message: 'Id aset wajib diisi.' };

    var invSheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var row = findRowById(invSheet, data.id);
    if (!row) return { status: 'error', message: 'Aset dengan Id ' + data.id + ' tidak ditemukan.' };

    var header = invSheet.getRange(1, 1, 1, invSheet.getLastColumn()).getValues()[0];
    var nilaiAset = invSheet.getRange(row, 1, 1, invSheet.getLastColumn()).getValues()[0];

    function aset(nama) {
        var c = colIndex(header, nama);
        return c ? normalizeValue(nilaiAset[c - 1]) : '';
    }

    var tglKembali = data.tanggal || todayString();
    var statusBaru = data.status || 'Tersedia';
    var kondisiKembali = data.kondisi || aset('Kondisi');
    var lokasiKembali = data.lokasi || aset('Lokasi');

    // --- Perbarui sheet Inventory ---
    var colStatus = colIndex(header, 'Status');
    if (colStatus) invSheet.getRange(row, colStatus).setValue(statusBaru);

    if (data.kondisi) {
        var colKondisi = colIndex(header, 'Kondisi');
        if (colKondisi) invSheet.getRange(row, colKondisi).setValue(data.kondisi);
    }

    if (data.lokasi) {
        var colLokasi = colIndex(header, 'Lokasi');
        if (colLokasi) invSheet.getRange(row, colLokasi).setValue(data.lokasi);
    }

    // --- Tandai baris peminjaman yang masih terbuka, sambil ambil datanya ---
    var pinjaman = { tanggal: '', rencana: '', dokumen: '' };

    var outSheet = ensureHeader(sheetByGid(GID_KELUAR), HEADER_KELUAR);
    var outLastRow = outSheet.getLastRow();
    var outLastCol = outSheet.getLastColumn();

    if (outLastRow > 1) {
        var outHeader = outSheet.getRange(1, 1, 1, outLastCol).getValues()[0];
        var colOutId = colIndex(outHeader, 'Id');
        var colOutStatus = colIndex(outHeader, 'Status');
        var colOutTanggal = colIndex(outHeader, 'Tanggal');
        var colOutRencana = colIndex(outHeader, 'Tgl Rencana Kembali');
        var colOutDoc = colIndex(outHeader, 'Document');

        if (colOutId && colOutStatus) {
            var outValues = outSheet.getRange(2, 1, outLastRow - 1, outLastCol).getValues();

            for (var i = outValues.length - 1; i >= 0; i--) {
                if (String(outValues[i][colOutId - 1]).trim() !== String(data.id).trim()) continue;

                var st = String(outValues[i][colOutStatus - 1]).toLowerCase();
                if (st.indexOf('kembali') > -1) continue;

                if (colOutTanggal) pinjaman.tanggal = normalizeValue(outValues[i][colOutTanggal - 1]);
                if (colOutRencana) pinjaman.rencana = normalizeValue(outValues[i][colOutRencana - 1]);
                if (colOutDoc) pinjaman.dokumen = normalizeValue(outValues[i][colOutDoc - 1]);

                outSheet.getRange(i + 2, colOutStatus).setValue('Kembali ' + tglKembali);
                break;
            }
        }
    }

    // --- Catat ke sheet Pengembalian ---
    var telat = pinjaman.rencana ? selisihHari(pinjaman.rencana, tglKembali) : '';
    if (telat !== '' && telat < 0) telat = 0;   // kembali lebih awal bukan keterlambatan

    // Nama kolom sengaja disediakan dalam beberapa variasi supaya cocok dengan
    // header apa pun yang dipakai di sheet Pengembalian (kolom yang tidak ada diabaikan).
    var retSheet = sheetPengembalian();

    appendByHeader(retSheet, {
        'Tanggal': tglKembali,
        'Tanggal Kembali': tglKembali,
        'Tgl Kembali': tglKembali,
        'Id': data.id,
        'Nama Aset': aset('Nama Aset'),
        'Kategori': aset('Kategori'),
        'Merk': aset('Merk'),
        'Kondisi': kondisiKembali,
        'Kondisi Kembali': kondisiKembali,
        'Kondisi Keluar': kondisiKembali,
        'Lokasi': lokasiKembali,
        'Status': statusBaru,
        'Tanggal Pinjam': pinjaman.tanggal,
        'Tgl Pinjam': pinjaman.tanggal,
        'Tgl Rencana Kembali': pinjaman.rencana,
        'Terlambat (hari)': telat,
        'Terlambat': telat,
        'Document': pinjaman.dokumen,
        'Foto Pengembalian': data.dokumen || '',
        'Foto Kembali': data.dokumen || '',
        'Foto': data.dokumen || ''
    });

    return {
        status: 'success',
        message: 'Pengembalian aset ' + data.id + ' tercatat (' + statusBaru + ').',
        terlambat: telat,
        row: retSheet.getLastRow()
    };
}

/** Riwayat pengembalian, terbaru di atas. */
function getPengembalian() {
    var data = readRows(sheetPengembalian());

    function ambil(r, daftarNama) {
        for (var i = 0; i < daftarNama.length; i++) {
            var v = r[daftarNama[i]];
            if (v !== undefined && v !== null && String(v) !== '') return v;
        }
        return '';
    }

    var items = data.rows.map(function (r) {
        return {
            tanggal: ambil(r, ['Tanggal Kembali', 'Tgl Kembali', 'Tanggal']),
            id: r['Id'] || '',
            nama: r['Nama Aset'] || '',
            kategori: r['Kategori'] || '',
            merk: r['Merk'] || '',
            kondisi: ambil(r, ['Kondisi Kembali', 'Kondisi Keluar', 'Kondisi']),
            lokasi: r['Lokasi'] || '',
            status: r['Status'] || '',
            tglPinjam: ambil(r, ['Tanggal Pinjam', 'Tgl Pinjam']),
            tglRencana: r['Tgl Rencana Kembali'] || '',
            terlambat: ambil(r, ['Terlambat (hari)', 'Terlambat']),
            dokumen: r['Document'] || '',
            foto: ambil(r, ['Foto Pengembalian', 'Foto Kembali', 'Foto']),
            row: r._row
        };
    });

    items.reverse();

    return { status: 'success', items: items, total: items.length };
}

/**
 * Upload foto dokumen ke folder Drive, lalu kembalikan link-nya.
 * data.data     = isi file base64 (tanpa prefix "data:image/jpeg;base64,")
 * data.mimeType = mis. image/jpeg
 * data.fileName = nama file (opsional)
 * data.jenis    = 'pengembalian' -> masuk folder pengembalian, selain itu folder peminjaman
 */
function uploadDocument(data) {
    if (!data.data) return { status: 'error', message: 'Data foto kosong.' };

    var jenis = String(data.jenis || '').toLowerCase();

    // Tiap jenis foto punya folder Drive sendiri supaya isinya tidak tercampur.
    var folderId = DRIVE_FOLDER_ID;
    var prefix = 'PJM_';

    if (jenis === 'pengembalian') {
        folderId = DRIVE_FOLDER_PENGEMBALIAN_ID;
        prefix = 'PGB_';
    } else if (jenis === 'aset') {
        folderId = DRIVE_FOLDER_ASET_ID;
        prefix = 'AST_';
    }

    var mime = data.mimeType || 'image/jpeg';
    var ext = mime.indexOf('png') > -1 ? '.png' : (mime.indexOf('webp') > -1 ? '.webp' : '.jpg');
    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
    var name = data.fileName || (prefix + (data.id || 'aset') + '_' + stamp + ext);

    var folder;
    try {
        folder = DriveApp.getFolderById(folderId);
    } catch (e) {
        return {
            status: 'error',
            message: 'Folder Drive tujuan tidak bisa diakses. Pastikan akun pemilik script punya akses ke folder ' +
                folderId + '.'
        };
    }

    var blob = Utilities.newBlob(Utilities.base64Decode(data.data), mime, name);
    var file = folder.createFile(blob);

    // Supaya link bisa dibuka dari dashboard tanpa minta akses.
    try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
        // Domain bisa saja melarang sharing publik - link tetap dikembalikan.
    }

    return {
        status: 'success',
        message: 'Foto dokumen terupload.',
        url: file.getUrl(),
        fileId: file.getId(),
        fileName: file.getName(),
        folderId: folderId
    };
}

/**
 * Isi kolom Document pada baris peminjaman.
 * Dipakai server untuk menambal baris yang linknya belum sempat tertulis.
 * data.id      = Id aset
 * data.url     = link file Drive
 * data.tanggal = tanggal peminjaman (opsional, untuk mempersempit pencarian baris)
 */
function setDocument(data) {
    if (!data.id) return { status: 'error', message: 'Id aset wajib diisi.' };
    if (!data.url) return { status: 'error', message: 'Url dokumen wajib diisi.' };

    var sheet = ensureHeader(sheetByGid(GID_KELUAR), HEADER_KELUAR);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { status: 'error', message: 'Sheet peminjaman masih kosong.' };

    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colId = colIndex(header, 'Id');
    var colDoc = colIndex(header, 'Document');
    var colTgl = colIndex(header, 'Tanggal');

    if (!colDoc) return { status: 'error', message: 'Kolom Document tidak ada di sheet peminjaman.' };

    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    // Telusuri dari baris terbaru: cocokkan Id (dan Tanggal kalau dikirim), ambil yang Document-nya kosong.
    for (var i = values.length - 1; i >= 0; i--) {
        if (String(values[i][colId - 1]).trim() !== String(data.id).trim()) continue;

        if (data.tanggal && colTgl) {
            if (normalizeValue(values[i][colTgl - 1]) !== data.tanggal) continue;
        }

        if (String(values[i][colDoc - 1]).trim()) {
            return { status: 'success', message: 'Kolom Document sudah terisi.', row: i + 2, skipped: true };
        }

        sheet.getRange(i + 2, colDoc).setValue(data.url);
        return { status: 'success', message: 'Link dokumen ditulis ke baris ' + (i + 2) + '.', row: i + 2 };
    }

    return { status: 'error', message: 'Baris peminjaman untuk Id ' + data.id + ' tidak ditemukan.' };
}

/**
 * Isi kolom Foto Pengembalian pada baris pengembalian.
 * Dipakai server untuk menambal baris yang linknya belum sempat tertulis.
 * data.id      = Id aset
 * data.url     = link file Drive
 * data.tanggal = tanggal kembali (opsional, untuk mempersempit pencarian baris)
 */
function setFotoPengembalian(data) {
    if (!data.id) return { status: 'error', message: 'Id aset wajib diisi.' };
    if (!data.url) return { status: 'error', message: 'Url foto wajib diisi.' };

    var sheet = sheetPengembalian();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { status: 'error', message: 'Sheet pengembalian masih kosong.' };

    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colId = colIndex(header, 'Id');
    var colFoto = colIndex(header, 'Foto Pengembalian') ||
        colIndex(header, 'Foto Kembali') || colIndex(header, 'Foto');
    var colTgl = colIndex(header, 'Tanggal Kembali') ||
        colIndex(header, 'Tgl Kembali') || colIndex(header, 'Tanggal');

    if (!colFoto) return { status: 'error', message: 'Kolom Foto Pengembalian tidak ada di sheet pengembalian.' };
    if (!colId) return { status: 'error', message: 'Kolom Id tidak ada di sheet pengembalian.' };

    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    // Telusuri dari baris terbaru: cocokkan Id (dan Tanggal kalau dikirim).
    for (var i = values.length - 1; i >= 0; i--) {
        if (String(values[i][colId - 1]).trim() !== String(data.id).trim()) continue;

        if (data.tanggal && colTgl) {
            if (normalizeValue(values[i][colTgl - 1]) !== data.tanggal) continue;
        }

        if (String(values[i][colFoto - 1]).trim()) {
            return { status: 'success', message: 'Kolom Foto Pengembalian sudah terisi.', row: i + 2, skipped: true };
        }

        sheet.getRange(i + 2, colFoto).setValue(data.url);
        return { status: 'success', message: 'Link foto ditulis ke baris ' + (i + 2) + '.', row: i + 2 };
    }

    return { status: 'error', message: 'Baris pengembalian untuk Id ' + data.id + ' tidak ditemukan.' };
}

/**
 * Segarkan kolom Umur di sheet Inventory supaya ikut bertambah tiap hari.
 * Dipanggil server sekali sehari, dan bisa juga dijadwalkan lewat trigger
 * harian dengan menjalankan installDailyUmurTrigger() sekali dari editor.
 */
function refreshUmur() {
    var sheet = ensureHeader(sheetByGid(GID_INVENTORY), HEADER_INVENTORY);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { status: 'success', message: 'Belum ada aset.', updated: 0 };

    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMasuk = colIndex(header, 'Tgl Masuk');
    var colUmur = colIndex(header, 'Umur');

    if (!colMasuk || !colUmur) {
        return { status: 'error', message: 'Kolom Tgl Masuk / Umur tidak ditemukan.' };
    }

    var jumlah = lastRow - 1;
    var masuk = sheet.getRange(2, colMasuk, jumlah, 1).getValues();
    var umurLama = sheet.getRange(2, colUmur, jumlah, 1).getValues();
    var umurBaru = [];
    var berubah = 0;

    for (var i = 0; i < jumlah; i++) {
        var nilai = hitungUmur(masuk[i][0]);
        if (nilai === '') nilai = umurLama[i][0];          // tanggal tidak terbaca -> biarkan
        if (String(nilai) !== String(umurLama[i][0])) berubah++;
        umurBaru.push([nilai]);
    }

    if (berubah) sheet.getRange(2, colUmur, jumlah, 1).setValues(umurBaru);

    return { status: 'success', message: berubah + ' baris umur diperbarui.', updated: berubah };
}

/**
 * JALANKAN SEKALI DARI EDITOR (opsional).
 * Membuat trigger harian jam 1 pagi supaya kolom Umur tetap ikut bertambah
 * walaupun dashboard tidak pernah dibuka.
 */
function installDailyUmurTrigger() {
    ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'refreshUmur') ScriptApp.deleteTrigger(t);
    });

    ScriptApp.newTrigger('refreshUmur').timeBased().atHour(1).everyDays(1).create();

    return { status: 'success', message: 'Trigger harian refreshUmur dipasang.' };
}

/**
 * Cek apakah folder Drive tujuan bisa diakses script ini.
 * Dipakai dashboard untuk memastikan deployment sudah versi terbaru + sudah diotorisasi.
 */
function checkDrive() {
    function cek(id) {
        try {
            var folder = DriveApp.getFolderById(id);
            return { folderId: id, folderName: folder.getName(), ok: true };
        } catch (e) {
            return { folderId: id, ok: false, error: e.toString() };
        }
    }

    var peminjaman = cek(DRIVE_FOLDER_ID);
    var pengembalian = cek(DRIVE_FOLDER_PENGEMBALIAN_ID);

    if (!peminjaman.ok || !pengembalian.ok) {
        var gagal = peminjaman.ok ? pengembalian : peminjaman;
        return {
            status: 'error',
            message: 'Folder Drive ' + gagal.folderId + ' tidak bisa diakses: ' + gagal.error,
            peminjaman: peminjaman,
            pengembalian: pengembalian
        };
    }

    return {
        status: 'success',
        message: 'Folder Drive siap: ' + peminjaman.folderName + ' & ' + pengembalian.folderName,
        folderId: DRIVE_FOLDER_ID,
        folderName: peminjaman.folderName,
        peminjaman: peminjaman,
        pengembalian: pengembalian
    };
}

/**
 * JALANKAN SEKALI DARI EDITOR APPS SCRIPT (tombol Run) setelah paste kode ini.
 * Fungsinya memunculkan layar otorisasi Drive dan memastikan folder tujuan bisa ditulis.
 * Lihat hasilnya di menu View > Logs / Execution log.
 */
function testUploadSetup() {
    var hasil = checkDrive();
    Logger.log(hasil.message);

    if (hasil.status !== 'success') return hasil;

    // Tulis file kecil lalu hapus lagi, untuk memastikan izin tulis benar-benar ada.
    [DRIVE_FOLDER_ID, DRIVE_FOLDER_PENGEMBALIAN_ID].forEach(function (id) {
        var folder = DriveApp.getFolderById(id);
        var file = folder.createFile(Utilities.newBlob('test upload', 'text/plain', 'TEST_HAPUS_SAJA.txt'));
        Logger.log('File uji dibuat di ' + folder.getName() + ': ' + file.getUrl());
        file.setTrashed(true);
    });

    Logger.log('File uji dihapus. Setup upload OK - lanjut Deploy > Manage deployments > New version.');

    return { status: 'success', message: 'Setup upload OK.' };
}

/** Tambah entri referensi ke sheet Master secara manual. */
function addMaster(data) {
    var sheet = sheetMasterAman();
    if (!sheet) return { status: 'error', message: 'Sheet Master tidak tersedia (tabnya dipakai untuk data lain).' };
    ensureHeader(sheet, HEADER_MASTER);

    sheet.appendRow([
        data.nama || '',
        data.kategori || '',
        data.merk || '',
        data.kondisi || '',
        data.lokasi || '',
        data.status || ''
    ]);

    return { status: 'success', message: 'Data master ditambahkan.' };
}


// ============================================================
// UTIL
// ============================================================
function findRowById(sheet, id) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;

    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colId = colIndex(header, 'Id') || 1;
    var ids = sheet.getRange(2, colId, lastRow - 1, 1).getValues();

    for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(id).trim()) return i + 2;
    }

    return 0;
}

/** Tambahkan kombinasi nilai baru ke sheet Master kalau belum ada. */
function syncMaster(data) {
    try {
        var sheet = sheetMasterAman();
        if (!sheet) return;                       // tab master dipakai untuk hal lain
        ensureHeader(sheet, HEADER_MASTER);

        var existing = readRows(sheet).rows;

        var candidate = [
            data.nama || '',
            data.kategori || '',
            data.merk || '',
            data.kondisi || '',
            data.lokasi || '',
            data.status || ''
        ];

        if (!candidate.join('').trim()) return;

        var key = candidate.join('|').toLowerCase();
        for (var i = 0; i < existing.length; i++) {
            var rowKey = [
                existing[i]['Nama Aset'] || '',
                existing[i]['Kategori'] || '',
                existing[i]['Merk'] || '',
                existing[i]['Kondisi'] || '',
                existing[i]['Lokasi'] || '',
                existing[i]['Status'] || ''
            ].join('|').toLowerCase();
            if (rowKey === key) return;
        }

        sheet.appendRow(candidate);
    } catch (e) {
        // Master bersifat opsional - jangan gagalkan transaksi utama
    }
}


// ============================================================
// SPIN PETUGAS  ->  tab "Petugas"
// Kolom "Calon Kandidat" = daftar induk, tidak pernah disentuh.
// Kolom "Kandidat"       = kumpulan yang masih boleh keluar; yang terpilih dicoret.
// ============================================================

/** Tab Petugas. Tab ini dibuat manual, jadi ketiadaannya dianggap salah konfigurasi. */
function sheetPetugas() {
    var sheet = sheetByName(NAMA_SHEET_PETUGAS);
    if (!sheet) throw new Error('Tab "' + NAMA_SHEET_PETUGAS + '" tidak ditemukan di spreadsheet.');
    return sheet;
}

/** Nomor kolom (1-based) berdasarkan judul di baris 1. */
function kolomPetugas(sheet, judul) {
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var col = colIndex(header, judul);

    if (!col) throw new Error('Kolom "' + judul + '" tidak ada di tab ' + NAMA_SHEET_PETUGAS + '.');
    return col;
}

/** Isi satu kolom mulai baris 2. Sel kosong dilewati, jadi lubang di tengah tidak masalah. */
function bacaKolomPetugas(sheet, col) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
    var out = [];

    for (var i = 0; i < values.length; i++) {
        var raw = values[i][0];
        var v = String(raw === null || raw === undefined ? '' : raw).trim();
        if (v) out.push(v);
    }

    return out;
}

/**
 * Tulis ulang satu kolom mulai baris 2, sisa sel di bawahnya dikosongkan.
 * Sengaja tidak memakai deleteRow: kolom sebelahnya (Calon Kandidat) harus tetap
 * di tempatnya, yang bergeser hanya kolom ini.
 */
function tulisKolomPetugas(sheet, col, list) {
    var tinggi = Math.max(sheet.getLastRow() - 1, list.length);
    if (tinggi < 1) return;

    // Daftar baru bisa lebih panjang dari sheet yang ada (mis. saat reset).
    var kurang = (tinggi + 1) - sheet.getMaxRows();
    if (kurang > 0) sheet.insertRowsAfter(sheet.getMaxRows(), kurang);

    var isi = [];
    for (var i = 0; i < tinggi; i++) isi.push([i < list.length ? list[i] : '']);

    sheet.getRange(2, col, tinggi, 1).setValues(isi);
}

/** Tab catatan undian - dibuat beserta headernya kalau belum ada. */
function sheetHistoryPetugas() {
    var sheet = sheetByName(NAMA_SHEET_HISTORY_PETUGAS);

    if (!sheet) {
        sheet = getSS().insertSheet(NAMA_SHEET_HISTORY_PETUGAS);
    }

    ensureHeader(sheet, HEADER_HISTORY_PETUGAS);
    SpreadsheetApp.flush();   // header harus sudah terbaca sebelum kolomnya dicari

    return sheet;
}

/**
 * Nomor kolom (1-based) yang judulnya cocok salah satu kata kunci.
 * Cocok persis didahulukan, baru cocok sebagian - jadi "Nama Petugas",
 * "nama", maupun "NAMA PETUGAS" sama-sama terbaca. 0 kalau tidak ketemu.
 */
function cariKolomHistory(header, kunci) {
    var i, j, judul;

    for (i = 0; i < header.length; i++) {
        judul = String(header[i] === null || header[i] === undefined ? '' : header[i]).trim().toLowerCase();
        for (j = 0; j < kunci.length; j++) {
            if (judul === kunci[j]) return i + 1;
        }
    }

    for (i = 0; i < header.length; i++) {
        judul = String(header[i] === null || header[i] === undefined ? '' : header[i]).trim().toLowerCase();
        if (!judul) continue;
        for (j = 0; j < kunci.length; j++) {
            if (judul.indexOf(kunci[j]) >= 0) return i + 1;
        }
    }

    return 0;
}

/** Tambah satu kolom berjudul `judul` di ujung kanan, kembalikan nomor kolomnya. */
function tambahKolomHistory(sheet, judul) {
    var kolom = Math.max(sheet.getLastColumn(), 0) + 1;

    sheet.getRange(1, kolom)
        .setValue(judul)
        .setFontWeight('bold')
        .setBackground('#425C6D')
        .setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');

    SpreadsheetApp.flush();   // supaya kolom berikutnya tidak menimpa yang ini

    return kolom;
}

/**
 * Catat satu hasil undian: tanggal + nama petugas.
 * Kolom dicari berdasarkan judulnya, bukan urutannya, dan kalau kolom yang
 * dibutuhkan memang belum ada barulah dibuat di ujung kanan - data lama
 * di tab yang sudah terlanjur dipakai tidak ikut bergeser.
 */
function catatHistoryPetugas(nama) {
    var sheet = sheetHistoryPetugas();
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    var kolTanggal = cariKolomHistory(header, KUNCI_KOL_TANGGAL);
    var kolNama = cariKolomHistory(header, KUNCI_KOL_NAMA);

    if (!kolTanggal) kolTanggal = tambahKolomHistory(sheet, HEADER_HISTORY_PETUGAS[0]);

    // Judul seperti "Tanggal Petugas" bisa cocok untuk keduanya - jangan sampai
    // nama menimpa tanggal di sel yang sama.
    if (!kolNama || kolNama === kolTanggal) kolNama = tambahKolomHistory(sheet, HEADER_HISTORY_PETUGAS[1]);

    var baris = sheet.getLastRow() + 1;
    sheet.getRange(baris, kolTanggal).setValue(todayString());
    sheet.getRange(baris, kolNama).setValue(nama);

    return { baris: baris, kolomTanggal: kolTanggal, kolomNama: kolNama };
}

/** Isi tab History Petugas, terbaru di atas. */
function getHistoryPetugas() {
    var sheet = sheetHistoryPetugas();
    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(sheet.getLastColumn(), 1);

    if (lastRow < 2) return { status: 'success', items: [], total: 0 };

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var header = values[0];

    var kolTanggal = cariKolomHistory(header, KUNCI_KOL_TANGGAL);
    var kolNama = cariKolomHistory(header, KUNCI_KOL_NAMA);
    var items = [];

    for (var r = values.length - 1; r >= 1; r--) {
        var tanggal = kolTanggal ? normalizeValue(values[r][kolTanggal - 1]) : '';
        var petugas = kolNama ? normalizeValue(values[r][kolNama - 1]) : '';

        if (String(tanggal).trim() === '' && String(petugas).trim() === '') continue;

        items.push({ tanggal: String(tanggal), nama: String(petugas) });
    }

    return {
        status: 'success',
        items: items,
        total: items.length,
        kolomTanggal: kolTanggal,
        kolomNama: kolNama
    };
}

/** Daftar kandidat yang masih tersisa, plus daftar induknya. */
function getPetugas() {
    var sheet = sheetPetugas();

    var kandidat = bacaKolomPetugas(sheet, kolomPetugas(sheet, KOL_KANDIDAT));
    var calon = bacaKolomPetugas(sheet, kolomPetugas(sheet, KOL_CALON_KANDIDAT));

    return {
        status: 'success',
        kandidat: kandidat,
        calon: calon,
        // Sekadar pemberitahuan - pengisian ulang baru benar-benar terjadi saat spinPetugas.
        akanDiisiUlang: !kandidat.length && calon.length > 0
    };
}

/**
 * Undi satu nama dari kolom Kandidat, lalu hapus yang terpilih dari kolom itu.
 * Pengundian dikerjakan di sini - bukan di browser - supaya hasil yang tampil di
 * layar dan isi sheet tidak mungkin berbeda kalau dua orang menekan spin bersamaan.
 */
function spinPetugas(data) {
    var lock = LockService.getScriptLock();

    try {
        lock.waitLock(20000);
    } catch (e) {
        return { status: 'error', message: 'Undian lain sedang berjalan, coba lagi sebentar.' };
    }

    try {
        var sheet = sheetPetugas();
        var col = kolomPetugas(sheet, KOL_KANDIDAT);
        var kandidat = bacaKolomPetugas(sheet, col);

        // Kandidat habis -> muat ulang seluruh Calon Kandidat, lalu undian lanjut
        // seperti biasa. Dikerjakan di dalam lock yang sama supaya dua orang yang
        // menekan Putar bersamaan tidak mengisi ulang dua kali.
        var diisiUlang = false;

        if (!kandidat.length) {
            var calon = bacaKolomPetugas(sheet, kolomPetugas(sheet, KOL_CALON_KANDIDAT));

            if (!calon.length) {
                return {
                    status: 'error',
                    message: 'Kolom "' + KOL_KANDIDAT + '" dan "' + KOL_CALON_KANDIDAT + '" sama-sama kosong.'
                };
            }

            tulisKolomPetugas(sheet, col, calon);
            kandidat = calon;
            diisiUlang = true;
        }

        // data.nama dipakai kalau pemenangnya sudah ditentukan di luar (mis. undian manual).
        var paksa = String((data && data.nama) || '').trim();
        var index = -1;

        if (paksa) {
            for (var i = 0; i < kandidat.length; i++) {
                if (kandidat[i].toLowerCase() === paksa.toLowerCase()) { index = i; break; }
            }
            if (index < 0) {
                return { status: 'error', message: 'Nama "' + paksa + '" tidak ada di daftar kandidat.' };
            }
        } else {
            index = Math.floor(Math.random() * kandidat.length);
        }

        var terpilih = kandidat[index];
        var sisa = kandidat.slice(0, index).concat(kandidat.slice(index + 1));

        tulisKolomPetugas(sheet, col, sisa);

        // Apps Script tidak punya transaksi: kalau pencatatan gagal, kembalikan
        // kolom Kandidat seperti semula supaya tidak ada nama yang hilang diam-diam.
        var catatan;
        try {
            catatan = catatHistoryPetugas(terpilih);
        } catch (e) {
            tulisKolomPetugas(sheet, col, diisiUlang ? [] : kandidat);
            SpreadsheetApp.flush();
            return {
                status: 'error',
                message: 'Gagal mencatat ke tab ' + NAMA_SHEET_HISTORY_PETUGAS
                    + ', undian dibatalkan. ' + e.toString()
            };
        }

        SpreadsheetApp.flush();

        return {
            status: 'success',
            message: (diisiUlang ? 'Kandidat diisi ulang otomatis. ' : '') + 'Petugas terpilih: ' + terpilih,
            diisiUlang: diisiUlang,
            terpilih: terpilih,
            index: index,
            kandidat: kandidat,   // daftar sebelum penghapusan - dipakai menggambar roda
            sisa: sisa,
            waktu: nowString(),
            history: catatan      // baris & kolom yang dipakai di tab History Petugas
        };
    } finally {
        lock.releaseLock();
    }
}

/** Isi ulang kolom Kandidat dari Calon Kandidat, untuk memulai putaran baru. */
function resetPetugas() {
    var sheet = sheetPetugas();
    var calon = bacaKolomPetugas(sheet, kolomPetugas(sheet, KOL_CALON_KANDIDAT));

    if (!calon.length) {
        return { status: 'error', message: 'Kolom "' + KOL_CALON_KANDIDAT + '" masih kosong.' };
    }

    tulisKolomPetugas(sheet, kolomPetugas(sheet, KOL_KANDIDAT), calon);
    SpreadsheetApp.flush();

    return {
        status: 'success',
        message: 'Kandidat diisi ulang: ' + calon.length + ' nama.',
        kandidat: calon
    };
}
