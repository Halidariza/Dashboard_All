#!/usr/bin/env bash
# Dijalankan DI SERVER. Menyiapkan Node, memilih port bebas, dan
# mendaftarkan service systemd untuk dashboard.
# Jalan sebagai root maupun user biasa ber-sudo.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/dashboard}
SERVICE=${SERVICE:-dashboard}

# Port dipatok, bukan dicari.
#
# Dulu skrip ini memindai port bebas mulai dari 3000. Begitu ada aplikasi lain
# menempati 3000, dashboard pindah sendiri ke port berikutnya - dan URL yang
# dipakai orang jadi putus tanpa ada yang sadar. Alamat layanan adalah hal yang
# dijanjikan ke pengguna, jadi ia ditentukan di sini, bukan hasil undian.
#
# PORT=auto mengembalikan perilaku pemindaian lama kalau memang dibutuhkan.
PORT=${PORT:-9008}
PORT_AWAL=${PORT_AWAL:-3000}

# Root langsung; selain itu lewat sudo.
if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
else
    command -v sudo >/dev/null 2>&1 || { echo "ERROR: butuh sudo, tidak ditemukan"; exit 1; }
    SUDO="sudo"
    $SUDO -n true 2>/dev/null || echo "    (sudo akan meminta password)"
fi

RUN_USER=$(id -un)
RUN_GROUP=$(id -gn)

echo "==> Cek Node.js"
if ! command -v node >/dev/null 2>&1; then
    echo "    Node belum ada, memasang Node 20 LTS"
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
fi
node --version

if [ "$PORT" = "auto" ]; then
    echo "==> Cari port yang belum dipakai (mulai dari $PORT_AWAL)"
    port=$PORT_AWAL
    while ss -ltnH "sport = :$port" | grep -q .; do
        port=$((port + 1))
    done
    echo "    Port terpilih: $port"
else
    port=$PORT
    echo "==> Port dipatok di $port"

    # Port yang sedang dipegang service ini sendiri akan bebas begitu direstart.
    # Kalau pemegangnya aplikasi lain, berhenti di sini - menimpanya diam-diam
    # berarti mematikan layanan orang tanpa pemberitahuan.
    #
    # Pembandingnya PID, bukan sekadar "apakah service hidup": service bisa
    # sedang berjalan di port lain sementara port yang dipatok dipegang
    # aplikasi lain. Pemeriksaan yang longgar meloloskannya, lalu service gagal
    # bind saat restart dan dashboard mati tanpa sebab yang jelas.
    pid_port=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o "pid=[0-9]*" | head -1 | cut -d= -f2)

    if [ -n "${pid_port:-}" ]; then
        pid_service=$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)

        if [ "$pid_port" = "${pid_service:-0}" ]; then
            echo "    (sedang dipakai service $SERVICE sendiri - bebas saat restart)"
        else
            echo "ERROR: port $port dipakai proses lain (PID $pid_port), bukan service $SERVICE."
            ss -ltnp | grep ":$port " || true
            echo "       Hentikan dulu pemiliknya, lalu jalankan deploy lagi."
            exit 1
        fi
    fi
fi

echo "==> Pasang dependency"
cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "==> Tulis PORT/HOST ke .env"
# Buang PORT/HOST lama, lalu tambahkan yang baru. Key lain dibiarkan apa adanya.
touch .env
sed -i '/^[[:space:]]*PORT=/d; /^[[:space:]]*HOST=/d' .env
printf '\nPORT=%s\nHOST=0.0.0.0\n' "$port" >> .env
chmod 600 .env

echo "==> Daftarkan service systemd (jalan sebagai $RUN_USER)"
$SUDO tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=Chickin Dashboard (Node + MQTT + Drive)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE"
$SUDO systemctl restart "$SERVICE"

echo "==> Buka firewall (kalau ufw aktif)"
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    $SUDO ufw allow "$port"/tcp || true
fi

sleep 3
echo "==> Status"
systemctl is-active "$SERVICE" || true
ss -ltn | grep ":$port " || echo "    (belum listen - cek: journalctl -u $SERVICE -n 50)"
echo
echo "SELESAI. Akses di: http://$(hostname -I | awk '{print $1}'):$port"
