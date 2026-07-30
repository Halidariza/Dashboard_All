---
description: Menghentikan proses yang memblokir port 3000 dan menjalankan dashboard dengan npm start
---

Jika Anda ingin menjalankan dashboard, ikuti langkah-langkah berikut:

1. Periksa apakah port 3000 sedang digunakan:
```powershell
netstat -ano | findstr LISTENING | findstr :3000
```

2. Jika ada proses yang ditemukan (misalnya dengan PID 1234), hentikan proses tersebut:
```powershell
taskkill /F /PID <PID_PROGRESS>
```
*(Ganti <PID_PROGRESS> dengan angka PID yang ditemukan di langkah 1)*

3. Jalankan dashboard dengan perintah:
```powershell
npm start
```
