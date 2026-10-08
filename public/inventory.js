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
    var assetMode = null;     // 'individu' | 'group' - dipilih sebelum form dibuka
    var groups = [];          // daftar kelompok beserta isinya, dari tab Group
    var editingGroup = null;  // nama group yang sedang diubah isinya (null = group baru)
    var confirmCallback = null;
    var sheetUrl = '';        // alamat spreadsheet, hanya dibuka setelah login admin

    // Foto dokumen (belum diupload sampai form disimpan) - satu picker per form
    var MAX_PHOTO_PX = 1600;
    var photoOut = null;      // form peminjaman
    var photoReturn = null;   // form pengembalian
    var photoAsset = null;    // form tambah / edit aset

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
        if (id === 'assetModal') {
            if (photoAsset) photoAsset.stop();
            hapusFormAset();   // ditutup dengan sengaja -> titipan tidak perlu lagi
        }
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
    /** Penanda isi group di kolom Nama Aset - kosong untuk aset individu. */
    function jumlahItemBadge(a) {
        if (!a.group) return '';

        var n = isiGroup(a.group).length;
        if (!n) return '';

        return ' <span class="hint" style="font-weight:400">(' + n + ' item)</span>';
    }

    function renderAssets() {
        var q = $('searchInput').value.trim().toLowerCase();
        var fKat = $('filterKategori').value;
        var fStat = $('filterStatus').value;

        var list = assets.filter(function (a) {
            if (fKat && a.kategori !== fKat) return false;
            if (fStat && a.status !== fStat) return false;
            if (!q) return true;

            return [a.id, a.nama, a.group, a.kategori, a.merk, a.kondisi, a.lokasi, a.status]
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
                '<td style="font-weight:500">' + escapeHtml(a.nama) + jumlahItemBadge(a) + '</td>' +
                '<td>' + escapeHtml(a.kategori || '-') + '</td>' +
                '<td>' + escapeHtml(a.merk || '-') + '</td>' +
                '<td>' + kondisiBadge(a.kondisi) + '</td>' +
                '<td>' + escapeHtml(a.lokasi || '-') + '</td>' +
                '<td>' + statusBadge(a.status) + '</td>' +
                '<td class="mono">' + escapeHtml(a.tglMasuk || '-') + '</td>' +
                '<td class="mono">' + escapeHtml(hitungUmur(a.tglMasuk) || a.umur || '-') + '</td>' +
                '<td>' +
                '<div class="row-actions">' +
                // Group diurus di tab "Group & Isinya" - menyuntingnya sebagai aset
                // biasa di sini akan memutus hubungan nama baris dengan groupnya.
                (a.group
                    ? '<button class="icon-btn" data-act="group" title="Kelola di tab Group &amp; Isinya">' +
                      '<i data-lucide="layers"></i></button>'
                    : '<button class="icon-btn' + kunci + '" data-act="edit" title="Edit' + labelAdmin +
                      '"><i data-lucide="pencil"></i></button>') +
                (isOut
                    ? '<button class="icon-btn" data-act="in" title="Kembalikan"><i data-lucide="log-in"></i></button>'
                    : '') +
                '</div>' +
                '</td>';

            tr.querySelectorAll('[data-act]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var act = btn.dataset.act;

                    if (act === 'group') { bukaTabGroup(a.group); return; }

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

    // ============================================================
    // TAB: GROUP & ISINYA
    // ============================================================
    var groupTerbuka = {};   // nama group -> sedang dibentangkan atau tidak

    /** Tandai bagian yang cocok dengan kata pencarian. */
    function sorot(teks, q) {
        var aman = escapeHtml(teks);
        if (!q) return aman;

        var pos = teks.toLowerCase().indexOf(q);
        if (pos < 0) return aman;

        return escapeHtml(teks.slice(0, pos))
            + '<mark>' + escapeHtml(teks.slice(pos, pos + q.length)) + '</mark>'
            + escapeHtml(teks.slice(pos + q.length));
    }

    /** Pindah ke tab Group, bentangkan satu group, lalu bawa ke layarnya. */
    function bukaTabGroup(nama) {
        var tab = document.querySelector('.tab[data-tab="group"]');
        if (tab) tab.click();

        // Disaring ke groupnya sendiri supaya yang dituju pasti yang terlihat,
        // berapa pun banyaknya group lain.
        groupTerbuka[nama] = true;
        $('searchGroup').value = nama;
        renderGroups();

        var kartu = $('groupCards').querySelector('.group-card');
        if (kartu && kartu.scrollIntoView) kartu.scrollIntoView({ block: 'center' });
    }

    function renderGroups() {
        var q = $('searchGroup').value.trim().toLowerCase();
        var box = $('groupCards');
        box.innerHTML = '';

        // Group yang namanya cocok tampil utuh; kalau yang cocok itemnya, hanya
        // item itu yang ditampilkan - supaya jelas kenapa groupnya muncul.
        var list = [];

        groups.forEach(function (g) {
            var items = g.items || [];
            var namaCocok = !q || g.nama.toLowerCase().indexOf(q) > -1;

            var itemCocok = q
                ? items.filter(function (it) { return it.nama.toLowerCase().indexOf(q) > -1; })
                : items;

            if (namaCocok) list.push({ g: g, items: items, alasan: '' });
            else if (itemCocok.length) list.push({ g: g, items: itemCocok, alasan: 'item' });
        });

        if (!list.length) {
            $('groupEmpty').style.display = 'block';
            $('groupEmptyText').textContent = groups.length
                ? 'Tidak ada group atau item yang cocok dengan pencarian.'
                : 'Belum ada group. Buat lewat Tambah Aset > Tambah Group.';
            if (window.lucide) lucide.createIcons();
            return;
        }

        $('groupEmpty').style.display = 'none';

        var admin = window.Auth ? Auth.isLoggedIn() : true;

        list.forEach(function (entri) {
            var g = entri.g;
            var aset = assets.filter(function (a) {
                return String(a.group || '').toLowerCase() === g.nama.toLowerCase();
            })[0];

            // Pencarian yang menemukan item otomatis membentangkan groupnya.
            var terbuka = entri.alasan === 'item' || groupTerbuka[g.nama];

            var card = document.createElement('div');
            card.className = 'group-card' + (terbuka ? ' open' : '');

            var jumlahItem = (g.items || []).length;
            var totalUnit = (g.items || []).reduce(function (n, it) { return n + (it.jumlah || 1); }, 0);

            var meta = jumlahItem
                ? jumlahItem + ' jenis item - ' + totalUnit + ' buah'
                : 'Belum ada item';
            if (g.keterangan) meta += ' - ' + g.keterangan;

            var head = document.createElement('div');
            head.className = 'group-card-head';
            head.innerHTML =
                '<i data-lucide="chevron-right" class="chev"></i>' +
                '<div>' +
                '<div class="group-card-title">' + sorot(g.nama, q) + '</div>' +
                '<div class="group-card-meta">' + escapeHtml(meta) + '</div>' +
                '</div>' +
                '<div class="group-card-id">' +
                (aset ? '<span class="mono" style="font-size:0.75rem">' + escapeHtml(aset.id) + '</span>' : '') +
                (aset ? statusBadge(aset.status) : '') +
                '<button class="icon-btn' + (admin ? '' : ' locked') + '" data-act="isi" title="Ubah isi group">' +
                '<i data-lucide="pencil"></i></button>' +
                '</div>';

            head.addEventListener('click', function (ev) {
                if (ev.target.closest('[data-act]')) return;
                groupTerbuka[g.nama] = !card.classList.contains('open');
                card.classList.toggle('open');
            });

            head.querySelector('[data-act="isi"]').addEventListener('click', function () {
                Auth.require(function () {
                    openGroup();
                    muatGroup(g.nama);
                });
            });

            var body = document.createElement('div');
            body.className = 'group-card-body';

            if (!entri.items.length) {
                body.innerHTML = '<div class="group-item" style="color:var(--text-muted)">' +
                    'Belum ada item di group ini.</div>';
            } else {
                entri.items.forEach(function (it) {
                    var row = document.createElement('div');
                    row.className = 'group-item';
                    row.innerHTML =
                        '<i data-lucide="dot" style="width:14px;height:14px;color:var(--text-muted)"></i>' +
                        '<span>' + sorot(it.nama, q) + '</span>' +
                        (it.kondisi ? kondisiBadge(it.kondisi) : '') +
                        '<span class="qty">x' + (it.jumlah || 1) + '</span>';
                    body.appendChild(row);
                });
            }

            card.appendChild(head);
            card.appendChild(body);
            box.appendChild(card);
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

    /**
     * Isi dropdown Kelompok.
     *
     * Daftarnya datang dari tab Group di spreadsheet (lewat options.group),
     * digabung dengan kelompok yang sudah menempel di aset supaya data lama
     * tidak hilang dari pilihan.
     */
    function daftarGroup() {
        var seen = {};
        var list = [];

        (options.group || [])
            .concat(groups.map(function (g) { return g.nama; }))
            .concat(uniqueOf('group'))
            .forEach(function (v) {
                var t = String(v || '').trim();
                if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = true; list.push(t); }
            });

        return list;
    }

    /** Isi satu group, dari data yang sudah dimuat. */
    function isiGroup(nama) {
        var key = String(nama || '').trim().toLowerCase();

        var ketemu = groups.filter(function (g) {
            return String(g.nama || '').trim().toLowerCase() === key;
        })[0];

        return (ketemu && ketemu.items) || [];
    }

    function fillGroupSelect() {
        var list = daftarGroup();
        var sel = $('f-group');
        var current = sel.value;

        sel.innerHTML = '<option value="">-- pilih kelompok --</option>';
        list.forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            sel.appendChild(opt);
        });

        if (list.indexOf(current) > -1) sel.value = current;

        // Daftar di modal Tambah Group - sekadar supaya tidak membuat nama kembar.
        var box = $('groupList');
        if (!box) return;

        box.innerHTML = '';
        if (!list.length) {
            box.textContent = 'Belum ada group.';
            return;
        }

        list.forEach(function (v) {
            var jml = isiGroup(v).length;

            var chip = document.createElement('span');
            chip.className = 'group-chip' + (editingGroup === v ? ' active' : '');
            chip.textContent = jml ? v + ' (' + jml + ')' : v;
            chip.title = 'Ubah isi group ' + v;
            chip.addEventListener('click', function () { muatGroup(v); });
            box.appendChild(chip);
        });
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
        fillOptionSelect($('g-kategori'), options.kategori);
        fillOptionSelect($('g-status'), options.status);
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

        // Satu panggilan untuk semuanya. Apps Script memungut ongkos tetap yang
        // besar tiap kali dipanggil (5-38 detik, bahkan untuk aksi yang tidak
        // menyentuh spreadsheet), jadi tiga panggilan terpisah membuat halaman
        // menunggu tiga kali lebih lama tanpa alasan.
        return api('getAll')
            .catch(function () {
                // Deployment Apps Script lama belum mengenal getAll - pakai cara lama
                // supaya halaman tetap hidup sampai deployment-nya diperbarui.
                return Promise.all([
                    api('getInventory'),
                    api('getKeluar'),
                    api('getMaster')
                ]).then(function (res) {
                    return {
                        inventory: res[0].items,
                        keluar: res[1].items,
                        options: res[2].options
                    };
                });
            })
            .then(function (res) {
                assets = res.inventory || [];
                keluar = res.keluar || [];
                options = res.options || {};
                groups = res.groups || [];

                renderStats();
                renderFilters();
                fillGroupSelect();
                fillDatalists();
                renderAssets();
                renderGroups();
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
    // Jumlah unit hanya masuk akal untuk group, jadi langkah pemilihan jenis
    // dipakai sebagai saklar: individu selalu satu baris, group minimal dua.
    var MODE_LABEL = { individu: 'Aset Individu', group: 'Group Aset' };

    function tampilLangkahMode() {
        $('assetModeStep').style.display = 'block';
        $('assetFormStep').style.display = 'none';
        $('assetBackBtn').style.display = 'none';
        $('saveAssetBtn').style.display = 'none';
    }

    function tampilLangkahForm(adaTombolKembali) {
        $('assetModeStep').style.display = 'none';
        $('assetFormStep').style.display = 'block';
        $('assetBackBtn').style.display = adaTombolKembali ? 'inline-flex' : 'none';
        $('saveAssetBtn').style.display = 'inline-flex';
    }

    function terapkanMode(mode) {
        assetMode = mode;
        $('assetModeLabel').textContent = MODE_LABEL[mode] || '';
        $('assetModeBanner').classList.add('show');

        var group = mode === 'group';

        // Mode group mencatat ISI sebuah group, bukan aset tersendiri. Item tidak
        // ber-Id, tidak muncul di tabel, dan tidak punya status/lokasi sendiri -
        // semua itu melekat pada groupnya. Jadi fieldnya ikut disembunyikan supaya
        // tidak ada isian yang diam-diam terbuang.
        ['f-kategori', 'f-merk', 'f-lokasi', 'f-status', 'f-tglMasuk']
            .forEach(function (id) { tampilField($(id).closest('.form-field'), !group); });
        tampilField($('a-fileInput').closest('.form-field'), !group);

        // Kondisi melekat pada barangnya sendiri, bukan pada group - jadi ia tetap
        // ditanyakan walau yang dicatat adalah isi group.
        tampilField($('f-kondisi').closest('.form-field'), true);
        if (group) setSelectDefault($('f-kondisi'), 'Baru');

        $('groupField').style.display = group ? 'flex' : 'none';
        $('jumlahField').style.display = group ? 'flex' : 'none';

        $('namaLabelText').textContent = group ? 'Nama Item' : 'Nama Aset';
        $('f-nama').placeholder = group ? 'mis. Obeng plus' : 'mis. Penggaris';
        $('f-nama').readOnly = false;
        $('namaHint').textContent = group ? '(barang di dalam group)' : '';
        $('namaHint').style.display = group ? 'inline' : 'none';

        $('jumlahLabelText').textContent = 'Jumlah';
        $('jumlahHint').textContent = group ? '(berapa buah di dalam group)' : '(tiap unit dapat Id sendiri)';

        $('f-nama').value = '';
        $('f-jumlah').value = '1';

        if (!group) $('f-group').value = '';

        tampilIsiGroup();
    }

    /** .form-field memakai display:flex - jangan sampai tertimpa 'block'. */
    function tampilField(el, tampil) {
        if (el) el.style.display = tampil ? 'flex' : 'none';
    }

    /** Kembalikan form ke bentuk aset penuh - mode group menyembunyikan sebagian. */
    function tampilFieldAset() {
        ['f-kategori', 'f-merk', 'f-kondisi', 'f-lokasi', 'f-status', 'f-tglMasuk']
            .forEach(function (id) { tampilField($(id).closest('.form-field'), true); });
        tampilField($('a-fileInput').closest('.form-field'), true);

        $('namaLabelText').textContent = 'Nama Aset';
        $('f-nama').placeholder = 'mis. Penggaris';
        $('jumlahLabelText').textContent = 'Jumlah Unit';
        $('jumlahHint').textContent = '(tiap unit dapat Id sendiri)';
    }

    /** Rincian isi group, ditampilkan di bawah pilihan Group. */
    function tampilIsiGroup() {
        var group = $('f-group').value;
        var isi = group ? isiGroup(group) : [];

        $('f-groupIsi').textContent = !group ? ''
            : (isi.length
                ? 'Isi sekarang: ' + isi.map(function (it) {
                    return it.nama
                        + (it.kondisi ? ' (' + it.kondisi + ')' : '')
                        + (it.jumlah > 1 ? ' x' + it.jumlah : '');
                }).join(', ')
                : 'Group ini belum punya item.');
    }

    function pilihMode(mode) {
        terapkanMode(mode);
        tampilLangkahForm(true);

        // Di mode group, nama aset ditentukan oleh pilihan group - jadi itulah
        // yang didahulukan.
        if (mode === 'group') $('f-group').focus();
        else $('f-nama').focus();
    }

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
        $('f-group').value = '';
        $('f-nama').readOnly = false;
        $('namaHint').style.display = 'none';
        tampilFieldAset();
        assetMode = null;
        $('assetModeBanner').classList.remove('show');
        tampilLangkahMode();
        if (photoAsset) photoAsset.reset();
        openModal('assetModal');
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
        // Edit menyentuh satu baris saja, jadi jenis aset tidak ditanyakan lagi.
        // Group tidak ditawarkan di sini: memindahkan aset biasa ke dalam sebuah
        // group lewat form ini akan melahirkan baris group kedua, dan peminjaman
        // jadi ambigu. Group diurus sepenuhnya di tab "Group & Isinya".
        assetMode = null;
        tampilFieldAset();
        $('jumlahField').style.display = 'none';
        $('groupField').style.display = 'none';
        $('f-group').value = '';
        $('assetModeBanner').classList.remove('show');
        tampilLangkahForm(false);
        // Foto lama tidak ditarik ulang ke picker; mengambil foto baru akan
        // menggantikan link di kolom Dokumen, membiarkannya kosong tidak mengubah apa pun.
        if (photoAsset) photoAsset.reset();
        openModal('assetModal');
        $('f-nama').focus();
    }

    // ============================================================
    // PENYELAMAT ISIAN FORM ASET
    // ============================================================
    // Menekan "Ambil Foto" di ponsel memindahkan layar ke aplikasi kamera
    // bawaan. Kalau memori sedang sesak, Android mematikan tab Chrome yang
    // ditinggalkan; saat kembali, halaman dimuat ulang dari nol dan seluruh
    // isian form ikut hilang. Isian karena itu dititipkan ke sessionStorage
    // sebelum layar ditinggalkan, lalu dipasang kembali setelah data selesai
    // dimuat.
    var KUNCI_FORM_ASET = 'chickin_form_aset';

    function simpanFormAset() {
        if (!$('assetModal').classList.contains('show')) return;

        var isi = {
            editingId: editingId,
            mode: assetMode,
            group: $('f-group').value,
            nama: $('f-nama').value,
            kategori: $('f-kategori').value,
            merk: $('f-merk').value,
            kondisi: $('f-kondisi').value,
            lokasi: $('f-lokasi').value,
            status: $('f-status').value,
            tglMasuk: $('f-tglMasuk').value,
            jumlah: $('f-jumlah').value,
            foto: photoAsset ? photoAsset.value() : null
        };

        try {
            sessionStorage.setItem(KUNCI_FORM_ASET, JSON.stringify(isi));
        } catch (e) {
            // Foto bisa membuat jatah sessionStorage penuh - simpan tanpa foto
            // supaya isian teksnya tetap selamat.
            isi.foto = null;
            try { sessionStorage.setItem(KUNCI_FORM_ASET, JSON.stringify(isi)); } catch (e2) { /* menyerah */ }
        }
    }

    function hapusFormAset() {
        try { sessionStorage.removeItem(KUNCI_FORM_ASET); } catch (e) { /* abaikan */ }
    }

    function pulihkanFormAset() {
        var mentah;
        try { mentah = sessionStorage.getItem(KUNCI_FORM_ASET); } catch (e) { return; }
        if (!mentah) return;

        var isi;
        try { isi = JSON.parse(mentah); } catch (e) { hapusFormAset(); return; }

        // Dropdown baru terisi setelah getMaster selesai, jadi fungsi ini
        // sengaja dipanggil di akhir loadAll.
        editingId = isi.editingId || null;
        $('assetModalTitle').textContent = editingId ? 'Edit Aset - ' + editingId : 'Tambah Aset';
        $('f-id').value = editingId || '';
        $('f-nama').value = isi.nama || '';
        $('f-merk').value = isi.merk || '';
        $('f-lokasi').value = isi.lokasi || '';
        setSelectValue($('f-kategori'), isi.kategori);
        setSelectValue($('f-kondisi'), isi.kondisi);
        setSelectValue($('f-status'), isi.status);
        $('f-tglMasuk').value = isi.tglMasuk || '';
        $('f-jumlah').value = isi.jumlah || '1';

        if (editingId) {
            assetMode = null;
            $('jumlahField').style.display = 'none';
            $('groupField').style.display = 'none';
            $('f-group').value = '';
            $('assetModeBanner').classList.remove('show');
            tampilLangkahForm(false);
        } else if (isi.mode) {
            // terapkanMode mengosongkan Nama & Jumlah karena artinya berganti -
            // isinya dipasang kembali setelah itu.
            terapkanMode(isi.mode);
            setSelectValue($('f-group'), isi.group || '');
            $('f-nama').value = isi.nama || '';
            $('f-jumlah').value = isi.jumlah || '1';
            tampilIsiGroup();
            tampilLangkahForm(true);
        } else {
            // Ditinggalkan saat masih di langkah pemilihan.
            assetMode = null;
            $('assetModeBanner').classList.remove('show');
            tampilLangkahMode();
        }

        if (photoAsset) {
            photoAsset.reset();
            photoAsset.set(isi.foto);
        }

        openModal('assetModal');

        toast(isi.foto
            ? 'Isian dan foto sebelumnya dipulihkan.'
            : 'Isian sebelumnya dipulihkan. Fotonya ikut hilang saat halaman dimuat ulang - silakan ambil ulang.',
            isi.foto ? 'success' : 'error');
    }

    // ============================================================
    // AKSI: Tambah Group
    // ============================================================
    // ============================================================
    // EDITOR ISI GROUP
    // ============================================================
    // Satu group dipinjam sebagai satu kesatuan, jadi item di dalamnya tidak
    // diberi Id - daftar ini murni rincian isi.
    function barisItem(item) {
        var row = document.createElement('div');
        row.className = 'item-row';

        var nama = document.createElement('input');
        nama.type = 'text';
        nama.placeholder = 'mis. Obeng plus';
        nama.value = (item && item.nama) || '';
        nama.dataset.field = 'nama';

        var kondisi = document.createElement('select');
        kondisi.title = 'Kondisi';
        kondisi.dataset.field = 'kondisi';
        kondisi.innerHTML = '<option value="">- kondisi -</option>';

        (options.kondisi || []).forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            kondisi.appendChild(opt);
        });

        setSelectValue(kondisi, (item && item.kondisi) || '');

        var jumlah = document.createElement('input');
        jumlah.type = 'number';
        jumlah.min = '1';
        jumlah.value = (item && item.jumlah) || 1;
        jumlah.title = 'Jumlah';
        jumlah.dataset.field = 'jumlah';

        var hapus = document.createElement('button');
        hapus.type = 'button';
        hapus.className = 'icon-btn';
        hapus.title = 'Hapus item';
        hapus.innerHTML = '<i data-lucide="trash-2"></i>';
        hapus.addEventListener('click', function () {
            row.remove();
            if (!$('g-items').querySelector('.item-row')) renderItems([]);
        });

        row.appendChild(nama);
        row.appendChild(kondisi);
        row.appendChild(jumlah);
        row.appendChild(hapus);

        return row;
    }

    function renderItems(items) {
        var box = $('g-items');
        box.innerHTML = '';

        if (!items.length) {
            var kosong = document.createElement('div');
            kosong.className = 'item-empty';
            kosong.textContent = 'Belum ada item. Group tanpa item tetap bisa disimpan.';
            box.appendChild(kosong);
        } else {
            items.forEach(function (it) { box.appendChild(barisItem(it)); });
        }

        if (window.lucide) lucide.createIcons();
    }

    function tambahBarisItem() {
        var box = $('g-items');
        var kosong = box.querySelector('.item-empty');
        if (kosong) kosong.remove();

        var row = barisItem(null);
        box.appendChild(row);

        if (window.lucide) lucide.createIcons();
        row.querySelector('[data-field="nama"]').focus();
    }

    function bacaItems() {
        var out = [];

        $('g-items').querySelectorAll('.item-row').forEach(function (row) {
            var nama = row.querySelector('[data-field="nama"]').value.trim();
            if (!nama) return;

            out.push({
                nama: nama,
                kondisi: row.querySelector('[data-field="kondisi"]').value,
                jumlah: Math.max(1, parseInt(row.querySelector('[data-field="jumlah"]').value, 10) || 1)
            });
        });

        return out;
    }

    /** Pindah ke mode ubah isi group yang sudah ada. */
    function muatGroup(nama) {
        editingGroup = nama;
        $('groupModalTitle').textContent = 'Isi Group - ' + nama;
        $('g-nama').value = nama;
        $('g-nama').readOnly = true;

        var g = groups.filter(function (x) { return x.nama === nama; })[0];
        $('g-keterangan').value = (g && g.keterangan) || '';

        // Kategori/Lokasi/Status tinggal di baris aset milik group ini.
        var aset = assets.filter(function (a) {
            return String(a.group || '').toLowerCase() === String(nama).toLowerCase();
        })[0];

        $('g-lokasi').value = (aset && aset.lokasi) || '';
        setSelectValue($('g-kategori'), (aset && aset.kategori) || '');
        setSelectValue($('g-status'), (aset && aset.status) || '');

        renderItems(isiGroup(nama));
        fillGroupSelect();
        $('g-addItemBtn').focus();
    }

    function openGroup() {
        editingGroup = null;
        $('groupModalTitle').textContent = 'Tambah Group';
        $('g-nama').value = '';
        $('g-nama').readOnly = false;
        $('g-keterangan').value = '';
        $('g-lokasi').value = '';
        setSelectDefault($('g-kategori'), '');
        setSelectDefault($('g-status'), 'Tersedia');
        renderItems([]);
        fillGroupSelect();          // segarkan daftar group yang sudah ada
        openModal('groupModal');
        $('g-nama').focus();
    }

    function saveGroup() {
        var nama = $('g-nama').value.trim();
        if (!nama) {
            toast('Nama Group wajib diisi.', 'error');
            $('g-nama').focus();
            return;
        }

        var items = bacaItems();
        var btn = $('saveGroupBtn');
        busy(btn, true, 'Menyimpan...');

        // Group yang sudah ada cukup diperbarui isinya; yang baru dibuat sekaligus
        // beserta itemnya dalam satu panggilan.
        var atribut = {
            nama: nama,
            keterangan: $('g-keterangan').value.trim(),
            kategori: $('g-kategori').value,
            lokasi: $('g-lokasi').value.trim(),
            status: $('g-status').value,
            items: items
        };

        // Group yang sudah ada diperbarui seluruhnya - termasuk atribut baris
        // asetnya, karena baris itu tidak lagi bisa disunting dari daftar aset.
        var permintaan = editingGroup
            ? api('updateGroup', atribut)
            : api('addGroup', atribut);

        permintaan
            .then(function (res) {
                busy(btn, false);
                closeModal('groupModal');

                // Group sudah lengkap beserta isinya di modal ini, jadi form
                // Tambah Aset di belakangnya tidak ada lagi yang perlu diisi.
                closeModal('assetModal');
                toast(res.message || 'Group disimpan.', 'success');

                // Daftar lokal disegarkan dulu supaya dropdown & jumlah item
                // langsung benar, tanpa menunggu loadAll selesai.
                var lama = groups.filter(function (g) { return g.nama !== nama; });
                groups = lama.concat([{
                    nama: nama,
                    keterangan: atribut.keterangan,
                    items: items
                }]);

                options.group = res.groups || daftarGroup();

                // Group baru sudah lengkap: ia punya barisnya sendiri di tabel dan
                // itemnya sudah ikut tersimpan, jadi tidak ada lanjutan yang ditunggu.
                // Groupnya dibentangkan supaya hasilnya langsung terlihat di tab Group.
                editingGroup = null;
                groupTerbuka[nama] = true;

                fillGroupSelect();
                renderAssets();
                renderGroups();

                loadAll(true);
            })
            .catch(function (err) {
                busy(btn, false);
                toast(err.message, 'error');
            });
    }

    /** Simpan satu item ke dalam group yang dipilih. */
    function simpanItemGroup(nama) {
        var group = $('f-group').value;

        if (!group) {
            toast('Pilih group tujuannya dulu, atau buat lewat "Tambah Group".', 'error');
            $('f-group').focus();
            return;
        }

        var btn = $('saveAssetBtn');
        busy(btn, true, 'Menyimpan...');

        api('addGroupItem', {
            group: group,
            nama: nama,
            kondisi: $('f-kondisi').value,
            jumlah: Math.max(1, parseInt($('f-jumlah').value, 10) || 1)
        })
            .then(function (res) {
                busy(btn, false);
                closeModal('assetModal');
                toast(res.message || 'Item ditambahkan.', 'success');

                // Group yang baru diisi dibentangkan supaya hasilnya langsung
                // terlihat begitu pengguna membuka tab Group.
                groupTerbuka[group] = true;

                loadAll(true);
            })
            .catch(function (err) {
                busy(btn, false);
                toast(err.message, 'error');
            });
    }

    function saveAsset() {
        var nama = $('f-nama').value.trim();
        if (!nama) {
            toast((assetMode === 'group' ? 'Nama Item' : 'Nama Aset') + ' wajib diisi.', 'error');
            $('f-nama').focus();
            return;
        }

        // Mode group tidak membuat aset: isinya masuk sebagai item di dalam group,
        // tanpa Id dan tanpa baris baru di tabel.
        if (!editingId && assetMode === 'group') {
            simpanItemGroup(nama);
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
            payload.jumlah = 1;
        }

        // Foto diupload lebih dulu supaya link-nya bisa ikut dalam satu baris yang
        // sama - sama seperti alur peminjaman & pengembalian. Kalau uploadnya gagal,
        // barisnya sengaja tidak jadi dibuat supaya tidak ada aset tanpa dokumen
        // yang dikira sudah berfoto.
        var foto = photoAsset ? photoAsset.value() : null;

        busy(btn, true, foto ? 'Mengupload foto...' : 'Menyimpan...');

        var siap = foto
            ? uploadPhoto(editingId || nama, 'aset', foto).then(function (url) {
                payload.dokumen = url;
            })
            : Promise.resolve();

        siap
            .then(function () { return api(action, payload); })
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
            value: function () { return dataUrl; },

            // Dipakai saat memulihkan form setelah halaman dimuat ulang.
            set: function (url) { if (url) setPhoto(url); }
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
                $('tab-group').style.display = tab.dataset.tab === 'group' ? 'block' : 'none';
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
                if (groups.length) renderGroups();
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
        photoAsset = createPhotoPicker('a-');
        photoOut.bind();
        photoReturn.bind();
        photoAsset.bind();
        $('saveAssetBtn').addEventListener('click', saveAsset);

        Array.prototype.forEach.call(document.querySelectorAll('[data-asset-mode]'), function (el) {
            el.addEventListener('click', function () { pilihMode(el.dataset.assetMode); });
        });
        $('assetModeChangeBtn').addEventListener('click', tampilLangkahMode);
        $('assetBackBtn').addEventListener('click', tampilLangkahMode);

        // Membuat kelompok mengubah data master -> khusus admin, sejalan dengan tambah aset.
        $('openGroupBtn').addEventListener('click', function () { Auth.require(openGroup); });
        $('saveGroupBtn').addEventListener('click', saveGroup);
        $('f-group').addEventListener('change', tampilIsiGroup);
        $('g-addItemBtn').addEventListener('click', tambahBarisItem);
        $('searchGroup').addEventListener('input', renderGroups);
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

        // Layar berpindah ke aplikasi kamera / galeri -> titipkan isian dulu.
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') simpanFormAset();
        });
        window.addEventListener('pagehide', simpanFormAset);

        loadAll().then(pulihkanFormAset);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
