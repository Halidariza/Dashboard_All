# 🤖 AI Drive Assistant - Dokumentasi

## ✅ Fitur yang Sudah Diimplementasikan

### 1. **AI Dapat "Melihat" File dan Folder**
AI sekarang menerima informasi tentang:
- Folder yang sedang dibuka
- Daftar semua file dan folder yang terlihat
- Total jumlah item

### 2. **System Prompt Khusus Google Drive**
AI dibatasi untuk HANYA menjawab pertanyaan tentang:
- Manajemen file Google Drive
- Upload, download, delete, organize files
- Troubleshooting masalah Drive

Pertanyaan di luar topik akan ditolak dengan sopan.

### 3. **Context-Aware Responses**
AI bisa menjawab pertanyaan seperti:
- "Apa saja file yang ada di folder ini?"
- "Berapa jumlah file PDF?"
- "Ada folder apa saja?"
- "Tolong jelaskan isi folder ini"

---

## 🚀 Cara Menggunakan

### **1. Jalankan Server**
```bash
npm start
```

### **2. Buka Browser**
Akses: `http://localhost:3000`

### **3. Test AI dengan Chat**
Klik icon chat di pojok kanan bawah dan coba tanya:
- "Apa saja file yang ada di sini?"
- "Berapa jumlah folder?"
- "Bagaimana cara upload file?"

---

## 🧪 Testing

### **Test 1: Drive Focus (AI hanya jawab tentang Drive)**
```bash
node test_drive_focus.js
```

### **Test 2: Drive Access (AI bisa "melihat" file)**
```bash
node test_drive_access.js
```

### **Test 3: Server Endpoint**
```bash
node test_server_endpoint.js
```

---

## 📊 Alur Kerja

```
User bertanya di Chat
    ↓
Frontend mengumpulkan context:
  - Current folder name
  - List of files/folders
    ↓
Kirim ke Backend (/api/chat)
    ↓
Backend menambahkan context ke prompt
    ↓
Gemini AI memproses dengan context
    ↓
AI memberikan jawaban yang context-aware
    ↓
Frontend menampilkan jawaban
```

---

## 🔧 Konfigurasi

### **Environment Variables (.env)**
```env
PORT=3000
HOST=localhost
GAS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
GEMINI_API_KEY=your_api_key_here
```

### **Model yang Digunakan**
- **Primary**: `gemini-2.5-flash` (Tercepat & Terbaru)
- **Fallback**: `gemini-2.0-flash`

---

## 📝 Contoh Interaksi

### **Contoh 1: AI Melihat File**
```
User: "Apa saja file yang ada di folder ini?"

AI: "Di folder 'My Documents' saat ini ada 4 item:
     📄 Report 2024.pdf
     📁 Photos
     📄 Budget.xlsx
     📄 Presentation.pptx"
```

### **Contoh 2: AI Menolak Pertanyaan Off-Topic**
```
User: "Berapa hasil 2 + 2?"

AI: "Maaf, saya hanya bisa membantu dengan manajemen file Google Drive. 
     Apakah ada yang bisa saya bantu terkait Drive Anda?"
```

### **Contoh 3: AI Memberikan Panduan**
```
User: "Bagaimana cara upload file?"

AI: "Untuk upload file ke Google Drive:
     1. Klik tombol 'Upload File' di atas
     2. Pilih file dari komputer Anda
     3. File akan otomatis terupload ke folder yang sedang dibuka
     
     Anda sedang di folder 'My Documents', jadi file akan masuk ke sana."
```

---

## 🎯 Fitur Mendatang (Opsional)

- [ ] AI bisa memberikan instruksi untuk create folder
- [ ] AI bisa memberikan instruksi untuk delete file
- [ ] AI bisa search file berdasarkan nama
- [ ] AI bisa memberikan statistik (jumlah file per tipe)
- [ ] Voice input untuk chat

---

## 🐛 Troubleshooting

### **Error: 404 Not Found**
- ✅ **Solusi**: Model sudah diupdate ke `gemini-2.5-flash`

### **AI Tidak Melihat File**
- ✅ **Solusi**: Context sudah dikirim dari frontend

### **AI Menjawab Pertanyaan Off-Topic**
- ✅ **Solusi**: System prompt sudah dibatasi

---

## 📞 Support

Jika ada masalah, cek:
1. Server running di `http://localhost:3000`
2. `.env` file sudah benar
3. Google Apps Script sudah deployed
4. API key Gemini valid

---

**Created**: 2026-02-11
**Version**: 2.0
**Status**: ✅ Production Ready
