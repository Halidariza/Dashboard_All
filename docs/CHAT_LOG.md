# 📝 Catatan Percakapan Claude Code → Google Doc

Mencatat setiap prompt Anda dan jawaban Claude Code ke satu Google Doc,
otomatis setiap kali Claude selesai menjawab.

Doc tujuan:
<https://docs.google.com/document/d/1Fejxe0DJVn6StO0sHK9mXZYRjNfTTLwirxGrtafdSm0/edit>

---

## Alur kerja

```
Claude Code selesai menjawab
    ↓
hook "Stop" di .claude/settings.json
    ↓
node tools/log-chat.js
  - tanya ke Doc: sudah tercatat sampai baris berapa? (action getProgress)
  - baca transkrip sesi (~/.claude/projects/<slug>/<sessionId>.jsonl)
  - ambil HANYA ucapan manusia + jawaban teks Claude, mulai dari baris itu
    ↓
POST ke GAS_CHATLOG_URL
    ↓
gas/GAS_ChatLog.js  ->  DocumentApp  ->  Google Doc
```

Transkrip memang sudah ditulis sendiri oleh Claude Code; skrip ini hanya
mengalirkannya ke Doc. Jadi kalau hook mati sehari, catatannya tidak hilang —
jalankan skripnya manual dan entri yang tertinggal ikut terkirim.

---

## Yang TIDAK dikirim ke Doc

Hanya teks percakapan yang dikirim. Isi tool — hasil `cat`, `grep`, diff,
output perintah — **tidak** ikut, karena di dalamnya bisa ada isi `.env`,
kunci API, dan id spreadsheet.

Sebagai penjaga terakhir kalau rahasia sempat terkutip di dalam teks
percakapan, `tools/log-chat.js` menyensor dua pola sebelum mengirim:

- kunci bergaya Google (`AIza…`)
- `PASSWORD=`, `API_KEY=`, `SECRET=`, `TOKEN=`, `CREDENTIAL=` beserta nilainya

---

## Pemasangan

### 1. Deploy Apps Script

1. Buka <https://script.google.com> → **New Project**
2. Paste seluruh isi [`gas/GAS_ChatLog.js`](../gas/GAS_ChatLog.js)
3. Jalankan fungsi `testTulis()` sekali dari editor — ini memicu dialog izin
   akses Google Docs. Setujui. Dua baris uji akan muncul di Doc (boleh dihapus).
4. **Deploy → New deployment → Type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy URL `/exec`

### 2. Isi `.env`

```env
GAS_CHATLOG_URL=https://script.google.com/macros/s/XXXX/exec
```

### 3. Uji tanpa mengirim

```powershell
node tools/log-chat.js --dry-run
```

Menampilkan apa saja yang akan dikirim, tanpa menyentuh Doc.

### 4. Uji kirim sungguhan

```powershell
node tools/log-chat.js
```

Periksa Doc. Kalau sudah masuk, lanjut ke hook.

### 5. Pasang hook

Buat `.claude/settings.json` di root proyek:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"d:/Software Engineer/web asset - Release/tools/log-chat.js\"",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

Restart sesi Claude Code supaya hook terbaca.

Setelah hook jalan sekali, periksa `data/chatlog-hook-payload.json` — isinya
payload mentah yang dikirim harness. Kalau di dalamnya ada `transcript_path`
atau `session_id`, skrip sudah memakai sesi yang persis benar. Kalau payloadnya
kosong atau bentuknya lain, skrip jatuh ke transkrip yang paling baru disentuh
di folder proyek — tetap benar untuk pemakaian satu sesi pada satu waktu.

---

## Perintah

| Perintah | Guna |
|---|---|
| `node tools/log-chat.js` | Kirim entri baru sesi berjalan |
| `node tools/log-chat.js --dry-run` | Tampilkan di layar, jangan kirim |
| `node tools/log-chat.js --import` | Kirim **semua** sesi dari awal, abaikan kemajuan di Doc (sesi lama) |

`--import` mengirim ulang dari baris 0 untuk setiap transkrip yang ada, jadi
jalankan sekali saja — menjalankannya dua kali membuat isi Doc dobel.

---

## Batas & perawatan

- **Google Doc mentok di sekitar 1.000.000 karakter.** `GAS_ChatLog.js` menolak
  menulis di atas 900.000 karakter dengan pesan jelas. Kalau sudah penuh: buat
  Doc baru, ganti `DOC_ID` di `GAS_ChatLog.js`, deploy ulang.
- Cek sisa ruang kapan saja: buka URL `/exec` + `?action=ping` di browser —
  dibalas nama Doc dan jumlah karakternya.
- **Kemajuan disimpan di dalam Doc, bukan di komputer Anda.** Setiap selesai
  menulis, Apps Script meninggalkan satu paragraf penanda di akhir Doc:

  ```
  [[chatlog sesi=2c3be234-… baris=500]]
  ```

  Paragraf itu diperkecil (ukuran 6, abu-abu) supaya tidak mengganggu, dan
  penanda lama sesi yang sama dibuang tiap kali diperbarui — jadi hanya ada
  satu per sesi. Itulah yang dibaca `getProgress`.
- **Doc yang dikosongkan manual akan terisi ulang sendiri.** Isi Doc hilang →
  penandanya ikut hilang → `getProgress` tidak menemukan apa-apa → percakapan
  dicatat ulang dari baris pertama, judul bulan & sesi ikut ditulis lagi.
  Tidak ada yang perlu Anda hapus atau samakan di sisi komputer.
- **Jangan menghapus baris penanda itu sendiri** kalau Anda merapikan Doc —
  menghapusnya membuat sesi tersebut tercatat ulang dari awal dan isinya dobel.
- `data/` hanya menyimpan `chatlog-hook-payload.json` (payload mentah dari hook,
  untuk diperiksa sekali). Folder itu sudah masuk `.gitignore` dan boleh dihapus
  kapan saja.
- Judul bulan dan judul sesi di Doc dilacak lewat Script Properties Apps
  Script, bukan dengan membaca isi Doc — jadi tetap murah walau Doc membesar.

---

## Kalau gagal

| Pesan | Sebab |
|---|---|
| `GAS_CHATLOG_URL belum diisi di .env` | Langkah 2 belum dilakukan |
| `Respon Apps Script bukan JSON` | Deployment bukan "Who has access: Anyone", atau URL yang dipakai URL editor bukan `/exec` |
| `Transkrip sesi tidak ditemukan` | Folder `~/.claude/projects/<slug>/` belum ada — jalankan dari root proyek |
| `Penulisan lain sedang berjalan` | Dua sesi mengirim bersamaan; aman, coba lagi |

Hook yang gagal tidak menghentikan sesi Claude Code — pesan errornya muncul,
percakapan tetap jalan, dan entri yang belum terkirim akan ikut pada
pengiriman berikutnya.
