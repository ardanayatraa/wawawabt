# WA API Ku

API ringan untuk kirim pesan WhatsApp memakai Fastify + Baileys.

Baileys memakai koneksi WebSocket ke WhatsApp Web, jadi lebih ringan daripada library berbasis Puppeteer/Chromium seperti `whatsapp-web.js`. Tetap gunakan secara wajar, karena ini bukan WhatsApp Cloud API resmi Meta.

Project ini juga menyediakan GUI admin di `/admin`. GUI tidak memakai `API_KEY` di browser; aksesnya dikunci dengan `ADMIN_PASSWORD` dan cookie HTTP-only.

## Setup

```bash
cp .env.example .env
```

Isi `API_KEY` dengan token acak panjang, minimal 24 karakter.
Isi juga:

- `ADMIN_PASSWORD`: password untuk membuka GUI admin, minimal 12 karakter.
- `ADMIN_SESSION_SECRET`: secret acak minimal 32 karakter untuk tanda tangan cookie admin.
- `ADMIN_COOKIE_SECURE=true`: gunakan ini saat deploy di HTTPS.

```bash
npm install
npm run dev
```

Di Windows PowerShell yang memblokir `npm.ps1`, gunakan:

```powershell
npm.cmd install
npm.cmd run dev
```

## GUI admin

Buka:

```txt
http://localhost:3000/admin
```

Dari GUI, kamu bisa scan QR WhatsApp, melihat status koneksi, mengirim pesan teks, mengirim attachment, logout session admin, dan memutus session WhatsApp dari server.

## Endpoint API

Semua endpoint butuh header:

```http
x-api-key: isi_API_KEY_anda
```

### Status session

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/session/status
```

### QR login

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/session/qr
```

Ambil `qrDataUrl`, buka di browser, lalu scan dari WhatsApp.

Atau simpan QR sebagai PNG:

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/session/qr.png --output qr.png
```

### Kirim teks

```bash
curl -X POST http://localhost:3000/api/messages/text \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"to":"628123456789","text":"Halo dari API"}'
```

### Kirim attachment

```bash
curl -X POST http://localhost:3000/api/messages/media \
  -H "x-api-key: $API_KEY" \
  -F "to=628123456789" \
  -F "caption=File dari API" \
  -F "file=@invoice.pdf"
```

## Catatan deploy Hostinger

Pakai Node.js Web App dengan framework backend Fastify atau Other. Set environment variable dari hPanel:

- `PORT`
- `HOST=0.0.0.0`
- `API_KEY`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ADMIN_COOKIE_SECURE=true`
- `AUTH_DIR=auth`
- `MAX_UPLOAD_MB=15`

Folder `auth/` berisi session WhatsApp dan tidak boleh dipush ke repository.
