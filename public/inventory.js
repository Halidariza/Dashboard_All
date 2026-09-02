/**
 * Inventory Aset - frontend logic
 * Semua panggilan lewat proxy Node: POST /api/inventory  ->  Apps Script (GAS_Inventory.js)
 */

(function () {
    'use strict';

    // ---------- State ----------
    var assets = [];
    var keluar = [];
    var options = {};
    var editingId = null;
    var confirmCallback = null;
    var sheetUrl = '';        // alamat spreadsheet, hanya dibuka setelah login admin

    // Foto dokumen (belum diupload sampai form disimpan) - satu picker per form
    var MAX_PHOTO_PX = 1600;
    var photoOut = null;      // form peminjaman
    var photoReturn = null;   // form pengembalian

    // ---------- DOM ----------
    var $ = function (id) { return document.getElementById(id); };

    // ============================================================
    // API
    // ============================================================
    function api(action, payload) {
        var body = Object.assign({ action: action }, payload || {});

        return fetch('/api/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (res) { return res.json(); })
            .then(function (json) {
                if (!json || json.status !== 'success') {
                    throw new Error((json && json.message) || 'Permintaan gagal.');
                }
                return json;
            });
    }

    // ============================================================
    // UI helper
    // ============================================================
    function toast(message, type) {
        var el = document.createElement('div');
        el.className = 'toast ' + (type || '');

        var icon = type === 'error' ? 'alert-circle' : (type === 'success' ? 'check-circle-2' : 'info');
        el.innerHTML = '<i data-lucide="' + icon + '"></i><span></span>';
        el.querySelector('span').textContent = message;

        $('toast-area').appendChild(el);
        if (window.lucide) lucide.createIcons();

        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(function () { el.remove(); }, 300);
        }, 3600);
    }

    function openModal(id) {
        $(id).classList.add('show');
    }

    function closeModal(id) {
        $(id).classList.remove('show');
        if (id === 'outModal' && photoOut) photoOut.stop();
        if (id === 'returnModal' && photoReturn) photoReturn.stop();
    }

    function busy(btn, isBusy, label) {
        if (!btn) return;
        if (isBusy) {
            btn.dataset.html = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> ' + (label || 'Memproses...');
        } else {
            btn.disabled = false;
            if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
            if (window.lucide) lucide.createIcons();
        }
    }

    function askConfirm(title, text, onOk) {
        $('confirmTitle').textContent = title;
        $('confirmText').textContent = text;
        confirmCallback = onOk;
        openModal('confirmModal');
    }

    /** Parse 'yyyy-MM-dd' atau 'dd-MM-yyyy' / 'dd/MM/yyyy' jadi {y, m, d}. */
    function parseTanggal(v) {
        var s = String(v || '').trim();
        if (!s) return null;

        var iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };

        var lokal = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (lokal) return { y: +lokal[3], m: +lokal[2], d: +lokal[1] };

        return null;
    }

    /**
     * Umur aset: selisih Tgl Masuk sampai hari ini.
     * Dihitung ulang setiap render, jadi otomatis bertambah tiap hari.
     */
    function hitungUmur(tglMasuk) {
        var s = parseTanggal(tglMasuk);
        if (!s) return '';

        var now = new Date();
        var t = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };

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

    function todayISO() {
        var d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function statusBadge(status) {
        var s = String(status || '').toLowerCase();
        var cls = 'badge-gray';

        if (s.indexOf('tersedia') > -1) cls = 'badge-green';
        else if (s.indexOf('pinjam') > -1 || s.indexOf('keluar') > -1) cls = 'badge-orange';
        else if (s.indexOf('perbaikan') > -1 || s.indexOf('rusak') > -1) cls = 'badge-red';
        else if (s.indexOf('kembali') > -1) cls = 'badge-blue';

        return '<span class="badge ' + cls + '">' + escapeHtml(status || '-') + '</span>';
    }

    function kondisiBadge(kondisi) {
        var k = String(kondisi || '').toLowerCase();
        var cls = 'badge-gray';

        if (k.indexOf('baru') > -1 || k.indexOf('baik') > -1) cls = 'badge-green';
        else if (k.indexOf('rusak') > -1) cls = 'badge-red';
        else if (k.indexOf('bekas') > -1 || k.indexOf('cukup') > -1) cls = 'badge-orange';

        return '<span class="badge ' + cls + '">' + escapeHtml(kondisi || '-') + '</span>';
    }

    function docLink(url, pending) {
        var v = String(url || '').trim();
        if (!v) return '<span class="mono">-</span>';
        if (!/^https?:\/\//i.test(v)) return escapeHtml(v);

        return '<a href="' + escapeHtml(v) + '" target="_blank" rel="noopener" ' +
            'style="color:var(--accent-blue); text-decoration:none;">Lihat dokumen</a>' +
            (pending
                ? ' <span class="badge badge-orange" title="Foto sudah di Drive, tapi sel Document di ' +
                  'sheet belum terisi karena Apps Script masih versi lama.">belum di sheet</span>'
                : '');
    }

    function escapeHtml(str) {
        return String(str === null || str === undefined ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ============================================================
    // RENDER
    // ============================================================
    function renderAssets() {
        var q = $('searchInput').value.trim().toLowerCase();
        var fKat = $('filterKategori').value;
        var fStat = $('filterStatus').value;

        var list = assets.filter(function (a) {
            if (fKat && a.kategori !== fKat) return false;
            if (fStat && a.status !== fStat) return false;
            if (!q) return true;

            return [a.id, a.nama, a.kategori, a.merk, a.kondisi, a.lokasi, a.status]
                .join(' ').toLowerCase().indexOf(q) > -1;
        });

        var body = $('assetBody');
        body.innerHTML = '';

        if (!list.length) {
            $('assetEmpty').style.display = 'block';
            $('assetEmptyText').textContent = assets.length
                ? 'Tidak ada aset yang cocok dengan filter.'
                : 'Belum ada data aset. Klik "Tambah Aset" untuk memulai.';
            if (window.lucide) lucide.createIcons();
            return;
        }

        $('assetEmpty').style.display = 'none';

        var admin = window.Auth ? Auth.isLoggedIn() : true;
        var kunci = admin ? '' : ' locked';
        var labelAdmin = admin ? '' : ' (khusus admin)';

        list.forEach(function (a) {
            var isOut = String(a.status || '').toLowerCase().indexOf('tersedia') === -1 && a.status;

            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td class="mono">' + escapeHtml(a.id) + '</td>' +
                '<td style="font-weight:500">' + escapeHtml(a.nama) + '</td>' +
                '<td>' + escapeHtml(a.kategori || '-') + '</td>' +
                '<td>' + escapeHtml(a.merk || '-') + '</td>' +
                '<td>' + kondisiBadge(a.kondisi) + '</td>' +
                '<td>' + escapeHtml(a.lokasi || '-') + '</td>' +
                '<td>' + statusBadge(a.status) + '</td>' +
                '<td class="mono">' + escapeHtml(a.tglMasuk || '-') + '</td>' +
                '<td class="mono">' + escapeHtml(hitungUmur(a.tglMasuk) || a.umur || '-') + '</td>' +
                '<td>' +
                '<div class="row-actions">' +
                '<button class="icon-btn' + kunci + '" data-act="edit" title="Edit' + labelAdmin +
                '"><i data-lucide="pencil"></i></button>' +
                (isOut
                    ? '<button class="icon-btn" data-act="in" title="Kembalikan"><i data-lucide="log-in"></i></button>'
                    : '') +
                '</div>' +
                '</td>';

            tr.querySelectorAll('[data-act]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var act = btn.dataset.act;

                    // Edit mengubah data master -> khusus admin.
                    if (act === 'edit') Auth.require(function () { openEdit(a); });
                    // Pengembalian boleh dilakukan siapa saja.
                    else if (act === 'in') openReturn(a);
                });
            });

            body.appendChild(tr);
        });

        if (window.lucide) lucide.createIcons();
    }

    function renderKeluar() {
        var q = $('searchKeluar').value.trim().toLowerCase();

        var list = keluar.filter(function (k) {
            if (!q) return true;
            return [k.tanggal, k.id, k.nama, k.kategori, k.merk, k.lokasi, k.status, k.dokumen]
                .join(' ').toLowerCase().indexOf(q) > -1;
        });

        var body = $('keluarBody');
        body.innerHTML = '';

        if (!list.length) {
            $('keluarEmpty').style.display = 'block';
            if (window.lucide) lucide.createIcons();
            return;
        }

        $('keluarEmpty').style.display = 'none';

        list.forEach(function (k) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td class="mono">' + escapeHtml(k.tanggal || '-') + '</td>' +
                '<td class="mono">' + escapeHtml(k.id) + '</td>' +
                '<td style="font-weight:500">' + escapeHtml(k.nama) + '</td>' +
                '<td>' + escapeHtml(k.kategori || '-') + '</td>' +
                '<td>' + escapeHtml(k.merk || '-') + '</td>' +
                '<td>' + kondisiBadge(k.kondisiKeluar) + '</td>' +
                '<td>' + escapeHtml(k.lokasi || '-') + '</td>' +
                '<td>' + statusBadge(k.status) + '</td>' +
                '<td class="mono">' + escapeHtml(k.tglKembali || '-') + '</td>' +
                '<td>' + docLink(k.dokumen, k.dokumenPending) + '</td>';
            body.appendChild(tr);
        });
    }

    function renderStats() {
        var tersedia = 0;
        var out = 0;
        var kategori = {};

        assets.forEach(function (a) {
            var s = String(a.status || '').toLowerCase();
            if (s.indexOf('tersedia') > -1) tersedia++;
            else if (s) out++;
            if (a.kategori) kategori[a.kategori] = true;
        });

        $('stat-total').textContent = assets.length;
        $('stat-tersedia').textContent = tersedia;
        $('stat-keluar').textContent = out;
        $('stat-kategori').textContent = Object.keys(kategori).length;
    }

    function renderFilters() {
        fillSelect($('filterKategori'), 'Semua Kategori', uniqueOf('kategori'));
        fillSelect($('filterStatus'), 'Semua Status', uniqueOf('status'));
    }

    function uniqueOf(field) {
        var seen = {};
        var list = [];
        assets.forEach(function (a) {
            var v = a[field];
            if (v && !seen[v]) { seen[v] = true; list.push(v); }
        });
        return list.sort();
    }

    function fillSelect(select, placeholder, values) {
        var current = select.value;
        select.innerHTML = '<option value="">' + placeholder + '</option>';

        values.forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        });

        if (values.indexOf(current) > -1) select.value = current;
    }

    function fillDatalists() {
        // Field bebas ketik -> saran lewat datalist
        var map = {
            'dl-nama': options.nama,
            'dl-merk': options.merk,
            'dl-lokasi': options.lokasi
        };

        Object.keys(map).forEach(function (id) {
            var dl = $(id);
            if (!dl) return;
            dl.innerHTML = '';
            (map[id] || []).forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = v;
                dl.appendChild(opt);
            });
        });

        // Field berdaftar tetap -> dropdown sungguhan, isinya dari spreadsheet
        fillOptionSelect($('f-kategori'), options.kategori);
        fillOptionSelect($('f-kondisi'), options.kondisi);
        fillOptionSelect($('f-status'), options.status);
        fillOptionSelect($('o-kondisi'), options.kondisi);

        // Status peminjaman: pakai daftar khusus sheet peminjaman kalau ada,
        // kalau tidak pakai daftar Status yang sama dengan form aset.
        fillOptionSelect($('o-status'),
            (options.statusKeluar && options.statusKeluar.length) ? options.statusKeluar : options.status);

        fillOptionSelect($('r-kondisi'), options.kondisi);
        fillOptionSelect($('r-status'), options.status);
    }

    /** Isi <select> dengan daftar pilihan, nilai terpilih dipertahankan. */
    function fillOptionSelect(select, values) {
        if (!select) return;

        var current = select.value;
        select.innerHTML = '';

        var kosong = document.createElement('option');
        kosong.value = '';
        kosong.textContent = '-- pilih --';
        select.appendChild(kosong);

        (values || []).forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        });

        if (current) setSelectValue(select, current);
    }

    /**
     * Pilih sebuah nilai. Nilai lama yang tidak ada di daftar spreadsheet
     * tetap ditambahkan supaya tidak hilang saat aset diedit.
     */
    function setSelectValue(select, value) {
        if (!select) return;

        var v = String(value || '').trim();
        if (!v) {
            select.value = '';
            return;
        }

        var ada = false;
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === v) { ada = true; break; }
        }

        if (!ada) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v + ' (di luar daftar)';
            select.appendChild(opt);
        }

        select.value = v;
    }

    /** Pilih nilai default hanya kalau tersedia di daftar. */
    function setSelectDefault(select, prefer) {
        if (!select) return;

        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === prefer) {
                select.value = prefer;
                return;
            }
        }
        select.value = '';
    }

    // ============================================================
    // LOAD
    // ============================================================
    function loadAll(silent) {
        if (!silent) $('conn-status').textContent = 'Memuat data...';

        return Promise.all([
            api('getInventory'),
            api('getKeluar'),
            api('getMaster')
        ])
            .then(function (res) {
                assets = res[0].items || [];
                keluar = res[1].items || [];
                options = res[2].options || {};

                renderStats();
                renderFilters();
                fillDatalists();
                renderAssets();
                renderKeluar();

                $('setupAlert').classList.remove('show');
                $('conn-status').textContent = 'Terhubung - ' + assets.length + ' aset tersinkron dengan Spreadsheet';
            })
            .catch(function (err) {
                $('conn-status').textContent = 'Gagal terhubung ke Apps Script';
                $('setupAlert').classList.add('show');
                toast(err.message, 'error');
            });
    }

    // ============================================================
    // AKSI: Tambah / Edit
    // ============================================================
    function openAdd() {
        editingId = null;
        $('assetModalTitle').textContent = 'Tambah Aset';
        $('f-id').value = '';
        $('f-nama').value = '';
        $('f-merk').value = '';
        $('f-lokasi').value = '';
        setSelectDefault($('f-kategori'), '');
        setSelectDefault($('f-kondisi'), 'Baru');
        setSelectDefault($('f-status'), 'Tersedia');
        $('f-tglMasuk').value = todayISO();
        $('f-jumlah').value = '1';
        $('jumlahField').style.display = 'flex';
        openModal('assetModal');
        $('f-nama').focus();
    }

    function openEdit(a) {
        editingId = a.id;
        $('assetModalTitle').textContent = 'Edit Aset - ' + a.id;
        $('f-id').value = a.id;
        $('f-nama').value = a.nama || '';
        $('f-merk').value = a.merk || '';
        $('f-lokasi').value = a.lokasi || '';
        setSelectValue($('f-kategori'), a.kategori);
        setSelectValue($('f-kondisi'), a.kondisi);
        setSelectValue($('f-status'), a.status);
        $('f-tglMasuk').value = a.tglMasuk || '';
        $('jumlahField').style.display = 'none';
        openModal('assetModal');
        $('f-nama').focus();
    }

    function saveAsset() {
        var nama = $('f-nama').value.trim();
        if (!nama) {
            toast('Nama Aset wajib diisi.', 'error');
            $('f-nama').focus();
            return;
        }

        var payload = {
            nama: nama,
            kategori: $('f-kategori').value,
            merk: $('f-merk').value.trim(),
            kondisi: $('f-kondisi').value,
            lokasi: $('f-lokasi').value.trim(),
            status: $('f-status').value,
            tglMasuk: $('f-tglMasuk').value
        };

        var btn = $('saveAssetBtn');
        var action;

        if (editingId) {
            action = 'updateAsset';
            payload.id = editingId;
        } else {
            action = 'addAsset';
            payload.jumlah = parseInt($('f-jumlah').value, 10) || 1;
        }

        busy(btn, true, 'Menyimpan...');

        api(action, payload)
            .then(function (res) {
                closeModal('assetModal');
                toast(res.message || 'Tersimpan.', 'success');
                return loadAll(true);
            })
            .catch(function (err) {
                toast(err.message, 'error');
            })
            .finally(function () {
                busy(btn, false);
            });
    }

    // ============================================================
    // FOTO DOKUMEN  (kamera -> Drive -> link ke spreadsheet)
    // ============================================================
    /**
     * Satu set kontrol foto (kamera / galeri / preview) untuk satu form.
     * @param {string} p  Prefix id elemen - 'o-' untuk peminjaman, 'r-' untuk pengembalian.
     */
    function createPhotoPicker(p) {
        var dataUrl = null;
        var camStream = null;

        function el(nama) { return $(p + nama); }

        function showStage(stage) {
            ['stageEmpty', 'stageCam', 'stagePreview'].forEach(function (nama) {
                el(nama).classList.toggle('show', nama === stage);
            });
        }

        function stopCamera() {
            if (camStream) {
                camStream.getTracks().forEach(function (t) { t.stop(); });
                camStream = null;
            }
            el('video').srcObject = null;
        }

        function reset() {
            stopCamera();
            dataUrl = null;
            el('preview').removeAttribute('src');
            el('photoStatus').textContent = '';
            showStage('stageEmpty');
        }

        function setPhoto(url) {
            dataUrl = url;
            el('preview').src = url;

            var kb = Math.round((url.length * 3 / 4) / 1024);
            el('photoStatus').textContent = 'Foto siap (~' + kb + ' KB). Akan diupload ke Drive saat disimpan.';
            showStage('stagePreview');
            if (window.lucide) lucide.createIcons();
        }

        /**
         * HP punya aplikasi kamera bawaan, jadi input[capture] di camInput membuka
         * kamera sungguhan tanpa perlu secure context - foto diambil oleh sistem
         * operasi, bukan oleh halaman. Di desktop atribut itu diabaikan dan yang
         * terbuka hanya file picker.
         */
        function punyaKameraBawaan() {
            return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        }

        function startCamera() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                // Browser hanya menyediakan API kamera di secure context (HTTPS atau
                // localhost). Di halaman http:// biasa objeknya tidak ada sama sekali,
                // jadi jelaskan sebabnya alih-alih diam-diam membuka file picker.
                // Di HP peringatan ini tidak relevan: kameranya tetap terbuka.
                if (!window.isSecureContext && !punyaKameraBawaan()) {
                    toast('Kamera hanya bisa dipakai lewat HTTPS. Buka alamat https:// lalu coba lagi.', 'error');
                }

                el('camInput').click();   // fallback: kamera bawaan HP lewat input file
                return;
            }

            navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false
            })
                .then(function (stream) {
                    camStream = stream;
                    el('video').srcObject = stream;
                    showStage('stageCam');
                    if (window.lucide) lucide.createIcons();
                })
                .catch(function (err) {
                    // NotFoundError: tidak ada kamera. NotAllowedError: izin ditolak.
                    // NotReadableError: kamera dipakai aplikasi lain.
                    toast('Kamera tidak bisa diakses (' + (err && err.name ? err.name : 'error') + '), silakan pilih file foto.', 'error');
                    el('camInput').click();
                });
        }

        /** Ambil frame dari video jadi JPEG terkompres. */
        function capturePhoto() {
            var video = el('video');
            if (!video.videoWidth) {
                toast('Kamera belum siap, coba lagi sebentar.', 'error');
                return;
            }

            setPhoto(drawToJpeg(video, video.videoWidth, video.videoHeight));
            stopCamera();
        }

        /** Kompres file gambar dari galeri / kamera HP. */
        function loadPhotoFile(file) {
            if (!file) return;

            if (file.type.indexOf('image/') !== 0) {
                toast('File harus berupa gambar.', 'error');
                return;
            }

            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () { setPhoto(drawToJpeg(img, img.width, img.height)); };
                img.onerror = function () { toast('Gambar tidak bisa dibaca.', 'error'); };
                img.src = reader.result;
            };
            reader.onerror = function () { toast('Gagal membaca file.', 'error'); };
            reader.readAsDataURL(file);
        }

        /** Gambar source ke canvas dengan sisi terpanjang maks MAX_PHOTO_PX, hasil data URL JPEG. */
        function drawToJpeg(source, w, h) {
            var scale = Math.min(1, MAX_PHOTO_PX / Math.max(w, h));
            var canvas = el('canvas');

            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);

            return canvas.toDataURL('image/jpeg', 0.85);
        }

        function bind() {
            el('camBtn').addEventListener('click', startCamera);
            el('fileBtn').addEventListener('click', function () { el('fileInput').click(); });
            el('shotBtn').addEventListener('click', capturePhoto);
            el('camCancelBtn').addEventListener('click', function () {
                stopCamera();
                showStage(dataUrl ? 'stagePreview' : 'stageEmpty');
            });
            el('retakeBtn').addEventListener('click', startCamera);
            el('removeBtn').addEventListener('click', reset);

            ['fileInput', 'camInput'].forEach(function (nama) {
                el(nama).addEventListener('change', function (e) {
                    loadPhotoFile(e.target.files[0]);
                    e.target.value = '';   // supaya file yang sama bisa dipilih lagi
                });
            });
        }

        return {
            bind: bind,
            reset: reset,
            stop: stopCamera,
            value: function () { return dataUrl; }
        };
    }

    /**
     * Upload foto ke folder Drive lewat Apps Script, resolve dengan URL file.
     * @param {string} assetId
     * @param {string} jenis    'peminjaman' atau 'pengembalian' - menentukan folder tujuan.
     * @param {string} dataUrl  hasil canvas.toDataURL()
     */
    function uploadPhoto(assetId, jenis, dataUrl) {
        return api('uploadDocument', {
            id: assetId,
            jenis: jenis,
            mimeType: 'image/jpeg',
            data: dataUrl.split(',')[1]
        }).then(function (res) {
            if (!res.url) throw new Error('Upload berhasil tapi link file tidak diterima.');

            // Foto naik lewat konektor cadangan -> GAS inventory masih versi lama,
            // artinya kolom link di spreadsheet belum akan terisi otomatis.
            if (res.via === 'drive-connector') {
                toast('Foto terupload, tapi kolom link belum terisi otomatis - ' +
                    'deploy ulang GAS_Inventory.js dulu.', 'error');
            }

            return res.url;
        }).catch(function (err) {
            // Penyebab paling umum: Apps Script masih deployment versi lama.
            if (/tidak dikenali/i.test(err.message)) {
                throw new Error('Apps Script belum diperbarui. Paste ulang GAS_Inventory.js di ' +
                    'script.google.com, lalu Deploy > Manage deployments > Edit > New version.');
            }
            throw err;
        });
    }

    // ============================================================
    // AKSI: Keluar / Kembali / Hapus
    // ============================================================
    /**
     * Form peminjaman.
     * @param {object|null} a  Aset yang dipilih dari tabel. Null = pilih aset lewat dropdown.
     */
    function openOut(a) {
        $('o-tanggal').value = todayISO();
        $('o-tglKembali').value = '';
        setSelectDefault($('o-status'), 'Dipinjam');
        photoOut.reset();

        var pickMode = !a;
        $('o-pickField').style.display = pickMode ? 'flex' : 'none';
        $('o-namaField').style.display = pickMode ? 'none' : 'flex';
        $('outModalTitle').textContent = pickMode ? 'Form Peminjaman Aset' : 'Peminjaman - ' + a.id;

        if (pickMode) {
            fillAssetPicker();
            $('o-id').value = '';
            $('o-nama').value = '';
            applyAssetToForm(null);
            openModal('outModal');
            $('o-asset').focus();
            return;
        }

        $('o-id').value = a.id;
        $('o-nama').value = a.id + ' - ' + a.nama;
        applyAssetToForm(a);
        openModal('outModal');
        $('o-tglKembali').focus();
    }

    /** Isi dropdown aset dengan aset yang masih Tersedia. */
    function fillAssetPicker() {
        var sel = $('o-asset');
        sel.innerHTML = '<option value="">-- Pilih aset --</option>';

        var available = assets.filter(function (a) {
            return String(a.status || '').toLowerCase().indexOf('tersedia') > -1;
        });

        available.forEach(function (a) {
            var opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.id + ' - ' + a.nama +
                (a.kategori ? ' (' + a.kategori + ')' : '');
            sel.appendChild(opt);
        });

        if (!available.length) {
            sel.innerHTML = '<option value="">Tidak ada aset berstatus Tersedia</option>';
        }

        sel.value = '';
    }

    /** Sinkronkan field turunan (kategori, merk, kondisi, lokasi) dari aset terpilih. */
    function applyAssetToForm(a) {
        $('o-kategori').value = a ? (a.kategori || '') : '';
        $('o-merk').value = a ? (a.merk || '') : '';
        setSelectValue($('o-kondisi'), a ? a.kondisi : '');
        $('o-lokasi').value = a ? (a.lokasi || '') : '';
    }

    function findAsset(id) {
        for (var i = 0; i < assets.length; i++) {
            if (assets[i].id === id) return assets[i];
        }
        return null;
    }

    function saveOut() {
        var btn = $('saveOutBtn');
        var id = $('o-id').value || $('o-asset').value;

        if (!id) {
            toast('Pilih aset yang akan dipinjam.', 'error');
            $('o-asset').focus();
            return;
        }

        if (!$('o-tanggal').value) {
            toast('Tanggal pinjam wajib diisi.', 'error');
            $('o-tanggal').focus();
            return;
        }

        if (!$('o-tglKembali').value) {
            toast('Tgl rencana kembali wajib diisi.', 'error');
            $('o-tglKembali').focus();
            return;
        }

        if ($('o-tglKembali').value < $('o-tanggal').value) {
            toast('Tgl rencana kembali tidak boleh sebelum tanggal pinjam.', 'error');
            $('o-tglKembali').focus();
            return;
        }

        var payload = {
            id: id,
            tanggal: $('o-tanggal').value,
            tglKembali: $('o-tglKembali').value,
            kondisiKeluar: $('o-kondisi').value,
            status: $('o-status').value,
            lokasi: $('o-lokasi').value.trim(),
            dokumen: ''
        };

        // Foto diupload lebih dulu; link Drive-nya yang masuk ke kolom Document.
        var foto = photoOut.value();
        busy(btn, true, foto ? 'Mengupload foto...' : 'Menyimpan...');

        var prepare = foto ? uploadPhoto(id, 'peminjaman', foto) : Promise.resolve('');

        prepare
            .then(function (url) {
                payload.dokumen = url || '';
                if (url) {
                    busy(btn, false);
                    busy(btn, true, 'Menyimpan...');
                }
                return api('checkOut', payload);
            })
            .then(function (res) {
                closeModal('outModal');
                toast(res.message || 'Peminjaman tercatat.', 'success');
                return loadAll(true);
            })
            .catch(function (err) {
                toast(err.message, 'error');
            })
            .finally(function () {
                busy(btn, false);
            });
    }

    /**
     * Form pengembalian.
     * @param {object|null} a  Aset dari tabel. Null = pilih aset lewat dropdown.
     */
    function openReturn(a) {
        $('r-tanggal').value = todayISO();
        setSelectDefault($('r-status'), 'Tersedia');
        photoReturn.reset();

        var pickMode = !a;
        $('r-pickField').style.display = pickMode ? 'flex' : 'none';
        $('r-namaField').style.display = pickMode ? 'none' : 'flex';
        $('returnModalTitle').textContent = pickMode ? 'Form Pengembalian Aset' : 'Pengembalian - ' + a.id;

        if (pickMode) {
            fillReturnPicker();
            $('r-id').value = '';
            $('r-nama').value = '';
            applyAssetToReturn(null);
            openModal('returnModal');
            $('r-asset').focus();
            return;
        }

        $('r-id').value = a.id;
        $('r-nama').value = a.id + ' - ' + a.nama;
        applyAssetToReturn(a);
        openModal('returnModal');
        $('r-tanggal').focus();
    }

    /** Dropdown aset yang sedang dipinjam / keluar. */
    function fillReturnPicker() {
        var sel = $('r-asset');
        sel.innerHTML = '<option value="">-- Pilih aset --</option>';

        var keluarList = assets.filter(function (a) {
            var s = String(a.status || '').toLowerCase();
            return s && s.indexOf('tersedia') === -1;
        });

        keluarList.forEach(function (a) {
            var opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.id + ' - ' + a.nama + ' (' + (a.status || '-') + ')';
            sel.appendChild(opt);
        });

        if (!keluarList.length) {
            sel.innerHTML = '<option value="">Tidak ada aset yang sedang dipinjam</option>';
        }

        sel.value = '';
    }

    /** Isi kondisi, lokasi, dan catatan peminjaman dari aset terpilih. */
    function applyAssetToReturn(a) {
        setSelectValue($('r-kondisi'), a ? a.kondisi : '');
        $('r-lokasi').value = a ? (a.lokasi || '') : '';
        $('r-info').value = a ? catatanPinjaman(a.id) : '';
    }

    /** Ringkasan baris peminjaman yang masih terbuka untuk sebuah aset. */
    function catatanPinjaman(id) {
        for (var i = 0; i < keluar.length; i++) {
            var k = keluar[i];
            if (k.id !== id) continue;
            if (String(k.status || '').toLowerCase().indexOf('kembali') > -1) continue;

            return 'Dipinjam ' + (k.tanggal || '-') +
                ' | rencana kembali ' + (k.tglKembali || '-') +
                ' | tujuan ' + (k.lokasi || '-');
        }
        return 'Tidak ada catatan peminjaman terbuka untuk aset ini.';
    }

    function saveReturn() {
        var btn = $('saveReturnBtn');
        var id = $('r-id').value || $('r-asset').value;

        if (!id) {
            toast('Pilih aset yang akan dikembalikan.', 'error');
            $('r-asset').focus();
            return;
        }

        if (!$('r-tanggal').value) {
            toast('Tanggal kembali wajib diisi.', 'error');
            $('r-tanggal').focus();
            return;
        }

        var payload = {
            id: id,
            tanggal: $('r-tanggal').value,
            kondisi: $('r-kondisi').value,
            status: $('r-status').value || 'Tersedia',
            lokasi: $('r-lokasi').value.trim(),
            dokumen: ''
        };

        // Foto diupload lebih dulu; link Drive-nya yang masuk ke kolom Foto Pengembalian.
        var foto = photoReturn.value();
        busy(btn, true, foto ? 'Mengupload foto...' : 'Menyimpan...');

        var prepare = foto ? uploadPhoto(id, 'pengembalian', foto) : Promise.resolve('');

        prepare
            .then(function (url) {
                payload.dokumen = url || '';
                if (url) {
                    busy(btn, false);
                    busy(btn, true, 'Menyimpan...');
                }
                return api('checkIn', payload);
            })
            .then(function (res) {
                closeModal('returnModal');
                toast(res.message || 'Aset dikembalikan.', 'success');
                return loadAll(true);
            })
            .catch(function (err) {
                toast(err.message, 'error');
            })
            .finally(function () {
                busy(btn, false);
            });
    }

    // ============================================================
    // SPIN PETUGAS
    // Nama diambil dari tab "Petugas" kolom Kandidat. Pemenang ditentukan di
    // Apps Script (sekalian dihapus dari kolom itu), roda di sini hanya
    // memperagakan hasil yang sudah dikunci - jadi layar dan sheet selalu sama.
    // ============================================================
    var TAU = Math.PI * 2;
    var WHEEL_COLORS = ['#425C6D', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#14b8a6'];

    var petugas = [];        // kandidat yang sedang digambar di roda
    var calonPetugas = [];   // daftar induk, dipakai saat kandidat habis
    var akanDiisiUlang = false;
    var wheelRot = 0;        // rotasi roda saat ini (radian)
    var spinning = false;

    function drawWheel(list, rot, highlight) {
        var canvas = $('spinCanvas');
        if (!canvas || !canvas.getContext) return;

        var ctx = canvas.getContext('2d');
        var size = canvas.width;
        var cx = size / 2;
        var cy = size / 2;
        var r = size / 2 - 12;

        ctx.clearRect(0, 0, size, size);

        if (!list.length) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, TAU);
            ctx.fillStyle = '#e2e8f0';
            ctx.fill();

            ctx.fillStyle = '#64748b';
            ctx.font = '600 34px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Kandidat habis', cx, cy - 70);
            return;
        }

        var seg = TAU / list.length;

        for (var i = 0; i < list.length; i++) {
            var mulai = i * seg + rot;
            var akhir = mulai + seg;

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, mulai, akhir);
            ctx.closePath();
            ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
            ctx.fill();

            ctx.lineWidth = highlight === i ? 8 : 3;
            ctx.strokeStyle = highlight === i ? '#facc15' : '#ffffff';
            ctx.stroke();

            // Label ditulis mengikuti arah jari-jari segmen.
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(mulai + seg / 2);
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.font = '600 ' + (list.length > 12 ? 22 : 28) + 'px Inter, sans-serif';

            var teks = list[i];
            if (teks.length > 16) teks = teks.slice(0, 15) + '…';
            ctx.fillText(teks, r - 24, 0);
            ctx.restore();
        }

        // Lingkaran luar biar tepinya rapi
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
    }

    /** Rotasi supaya bagian tengah segmen ke-index berhenti tepat di jarum (sudut 0). */
    function rotasiUntuk(index, jumlah) {
        var seg = TAU / jumlah;
        return ((-(index + 0.5) * seg) % TAU + TAU) % TAU;
    }

    function renderSisaPetugas(list) {
        var wrap = $('spinRemaining');
        wrap.innerHTML = '';

        list.forEach(function (nama) {
            var chip = document.createElement('span');
            chip.className = 'badge badge-gray';
            chip.textContent = nama;
            wrap.appendChild(chip);
        });
    }

    function tampilkanInfoSpin() {
        var box = $('spinResult');

        if (!petugas.length) {
            box.innerHTML = '<div class="spin-empty">Kolom Kandidat dan Calon Kandidat sama-sama kosong.</div>';
        } else if (akanDiisiUlang) {
            box.innerHTML = '<div class="spin-empty">Kandidat habis - sekali diputar, daftar diisi ulang '
                + 'otomatis dari <strong>' + petugas.length + '</strong> calon kandidat.</div>';
        } else {
            box.innerHTML = '<div class="spin-empty">' + petugas.length + ' kandidat siap diundi.</div>';
        }

        $('spinGoBtn').disabled = !petugas.length;
    }

    /**
     * Pasang daftar kandidat ke roda. Kalau kolom Kandidat sudah habis, roda
     * langsung menampilkan Calon Kandidat - itulah yang akan diundi karena
     * server mengisi ulang sendiri begitu tombol Putar ditekan.
     */
    function terapkanKandidat(kandidat, calon) {
        calonPetugas = calon || calonPetugas;
        akanDiisiUlang = !kandidat.length && calonPetugas.length > 0;
        petugas = akanDiisiUlang ? calonPetugas.slice() : kandidat;

        wheelRot = 0;
        drawWheel(petugas, wheelRot);
        renderSisaPetugas(petugas);
        tampilkanInfoSpin();
    }

    function loadPetugas() {
        $('spinResult').innerHTML = '<div class="spin-empty">Memuat kandidat...</div>';
        $('spinGoBtn').disabled = true;

        return api('getPetugas')
            .then(function (res) {
                terapkanKandidat(res.kandidat || [], res.calon || []);
            })
            .catch(function (err) {
                petugas = [];
                calonPetugas = [];
                akanDiisiUlang = false;
                drawWheel(petugas, 0);
                renderSisaPetugas([]);
                $('spinResult').innerHTML = '<div class="spin-empty"></div>';
                $('spinResult').querySelector('.spin-empty').textContent = err.message;
                $('spinGoBtn').disabled = true;
            });
    }

    /** Putar roda dari posisi sekarang sampai segmen pemenang berhenti di jarum. */
    function animasiSpin(list, index) {
        return new Promise(function (resolve) {
            var mulai = ((wheelRot % TAU) + TAU) % TAU;
            var tujuan = rotasiUntuk(index, list.length);
            var delta = tujuan - mulai;
            if (delta < 0) delta += TAU;

            var total = delta + TAU * 6;          // enam putaran penuh sebelum berhenti
            var durasi = 4200;
            var t0 = null;

            function langkah(ts) {
                if (t0 === null) t0 = ts;

                var p = Math.min((ts - t0) / durasi, 1);
                var ease = 1 - Math.pow(1 - p, 3);   // cepat di awal, melambat di akhir

                wheelRot = mulai + total * ease;
                drawWheel(list, wheelRot);

                if (p < 1) {
                    requestAnimationFrame(langkah);
                } else {
                    wheelRot = tujuan;
                    drawWheel(list, wheelRot, index);
                    resolve();
                }
            }

            requestAnimationFrame(langkah);
        });
    }

    function doSpin() {
        if (spinning) return;

        var btn = $('spinGoBtn');
        spinning = true;
        busy(btn, true, 'Mengundi...');
        $('spinResetBtn').disabled = true;

        api('spinPetugas')
            .then(function (res) {
                // Pakai daftar versi server: bisa saja ada yang menambah/menghapus
                // kandidat di spreadsheet sejak modal ini dibuka.
                var daftar = res.kandidat || petugas;
                var index = typeof res.index === 'number' ? res.index : daftar.indexOf(res.terpilih);
                if (index < 0) index = 0;

                if (daftar.join('|') !== petugas.join('|')) {
                    petugas = daftar;
                    wheelRot = 0;
                    drawWheel(petugas, wheelRot);
                }

                busy(btn, false);
                btn.disabled = true;
                $('spinResult').innerHTML = '<div class="spin-empty">Sedang memutar...</div>';

                return animasiSpin(daftar, index).then(function () {
                    $('spinResult').innerHTML =
                        '<div class="label">Petugas terpilih</div><div class="name"></div>';
                    $('spinResult').querySelector('.name').textContent = res.terpilih;

                    toast((res.diisiUlang ? 'Kandidat diisi ulang. ' : '')
                        + res.terpilih + ' terpilih dan sudah dihapus dari kandidat.', 'success');

                    // Beri jeda supaya pemenangnya sempat terbaca, baru roda digambar
                    // ulang tanpa nama tersebut.
                    setTimeout(function () {
                        terapkanKandidat(res.sisa || [], calonPetugas);
                    }, 1600);
                });
            })
            .catch(function (err) {
                busy(btn, false);
                btn.disabled = !petugas.length;
                toast(err.message, 'error');
            })
            .finally(function () {
                spinning = false;
                $('spinResetBtn').disabled = false;
            });
    }

    function resetKandidat() {
        var btn = $('spinResetBtn');
        busy(btn, true, 'Mengisi...');

        api('resetPetugas')
            .then(function (res) {
                terapkanKandidat(res.kandidat || [], res.kandidat || []);
                toast(res.message || 'Kandidat diisi ulang.', 'success');
            })
            .catch(function (err) { toast(err.message, 'error'); })
            .finally(function () { busy(btn, false); });
    }

    function openSpin() {
        openModal('spinModal');
        loadPetugas();
    }

    /**
     * Spreadsheet memuat data master, jadi diperlakukan sama seperti tambah,
     * edit, dan hapus: khusus admin. Saat masih Guest tautannya ditampilkan
     * terkunci - href sengaja dikosongkan supaya tidak bisa dibuka lewat
     * "buka di tab baru" atau salin alamat tautan.
     */
    function perbaruiSheetLink() {
        var link = $('sheetLink');
        if (!link) return;

        var admin = window.Auth ? Auth.isLoggedIn() : true;

        if (admin && sheetUrl) {
            link.href = sheetUrl;
            link.classList.remove('locked');
            link.title = 'Spreadsheet';
        } else {
            link.removeAttribute('href');
            link.classList.add('locked');
            link.title = 'Spreadsheet (khusus admin)';
        }
    }

    // ============================================================
    // INIT
    // ============================================================
    function init() {
        if (window.lucide) lucide.createIcons();

        // Link ke spreadsheet
        fetch('/api/inventory/config')
            .then(function (r) { return r.json(); })
            .then(function (cfg) {
                if (cfg.sheetUrl) {
                    sheetUrl = cfg.sheetUrl;
                    $('sheetLink').style.display = 'inline-flex';
                    perbaruiSheetLink();
                }
                if (!cfg.configured) {
                    $('setupAlert').classList.add('show');
                    $('conn-status').textContent = 'GAS_INVENTORY_URL belum dikonfigurasi';
                }
            })
            .catch(function () { /* abaikan */ });

        // Tabs
        document.querySelectorAll('.tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                $('tab-aset').style.display = tab.dataset.tab === 'aset' ? 'block' : 'none';
                $('tab-keluar').style.display = tab.dataset.tab === 'keluar' ? 'block' : 'none';
            });
        });

        // Tombol utama
        Auth.init({
            onChange: function (masuk) {
                var status = $('auth-status');
                if (status) {
                    status.textContent = masuk ? 'Admin' : 'Guest';
                    status.className = 'badge ' + (masuk ? 'badge-green' : 'badge-gray');
                }

                perbaruiSheetLink();

                if (assets.length) renderAssets();
            }
        });

        // Guest yang menekan tautan spreadsheet diarahkan ke login dulu.
        $('sheetLink').addEventListener('click', function (e) {
            if (window.Auth && Auth.isLoggedIn() && sheetUrl) return;   // biarkan terbuka normal

            e.preventDefault();

            Auth.require(function () {
                perbaruiSheetLink();

                // Popup setelah modal login kadang diblokir browser karena bukan
                // hasil klik langsung; kalau begitu tautannya sudah aktif dan
                // tinggal diklik sekali lagi.
                if (!window.open(sheetUrl, '_blank', 'noopener')) {
                    toast('Login berhasil. Klik Spreadsheet sekali lagi untuk membukanya.', 'success');
                }
            });
        });

        // Tambah aset mengubah data master -> khusus admin, sejalan dengan edit & hapus.
        $('addBtn').addEventListener('click', function () { Auth.require(openAdd); });

        // Form peminjaman & pengembalian terbuka untuk semua pengguna.
        $('pinjamBtn').addEventListener('click', function () { openOut(null); });
        $('kembaliBtn').addEventListener('click', function () { openReturn(null); });

        // Undian petugas terbuka untuk semua; isi ulang kandidat mengubah data
        // secara borongan, jadi itu dikunci untuk admin.
        $('spinBtn').addEventListener('click', openSpin);
        $('spinGoBtn').addEventListener('click', doSpin);
        $('spinResetBtn').addEventListener('click', function () {
            Auth.require(function () {
                askConfirm('Isi Ulang Kandidat',
                    'Kolom Kandidat akan ditimpa dengan seluruh isi Calon Kandidat. Lanjutkan?',
                    resetKandidat);
            });
        });
        $('o-asset').addEventListener('change', function () {
            applyAssetToForm(findAsset($('o-asset').value));
        });

        // Foto dokumen: peminjaman & pengembalian punya kontrol sendiri-sendiri
        photoOut = createPhotoPicker('o-');
        photoReturn = createPhotoPicker('r-');
        photoOut.bind();
        photoReturn.bind();
        $('saveAssetBtn').addEventListener('click', saveAsset);
        $('saveOutBtn').addEventListener('click', saveOut);
        $('saveReturnBtn').addEventListener('click', saveReturn);
        $('r-asset').addEventListener('change', function () {
            applyAssetToReturn(findAsset($('r-asset').value));
        });

        // Filter & pencarian
        $('searchInput').addEventListener('input', renderAssets);
        $('filterKategori').addEventListener('change', renderAssets);
        $('filterStatus').addEventListener('change', renderAssets);
        $('searchKeluar').addEventListener('input', renderKeluar);

        // Modal close
        document.querySelectorAll('[data-close]').forEach(function (btn) {
            btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
        });

        document.querySelectorAll('.modal-overlay').forEach(function (ov) {
            ov.addEventListener('click', function (e) {
                if (e.target === ov) ov.classList.remove('show');
            });
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.show').forEach(function (m) {
                    m.classList.remove('show');
                });
            }
        });

        $('confirmOkBtn').addEventListener('click', function () {
            closeModal('confirmModal');
            if (confirmCallback) confirmCallback();
            confirmCallback = null;
        });

        loadAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
