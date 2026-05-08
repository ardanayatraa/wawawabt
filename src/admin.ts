import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  getSessionQr,
  getSessionQrPng,
  getSessionStatus,
  logoutSession,
  sendMediaMessage,
  sendTextMessage
} from './api-handlers.js';
import { config } from './config.js';
import type { WhatsAppService } from './whatsapp.js';

const cookieName = 'wa_admin';
const loginSchema = z.object({
  password: z.string().min(1)
});

type SessionPayload = {
  iat: number;
  exp: number;
  nonce: string;
};

type LoginAttempt = {
  count: number;
  resetAt: number;
};

const loginAttempts = new Map<string, LoginAttempt>();

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

const sign = (payload: string) => {
  return createHmac('sha256', config.adminSessionSecret).update(payload).digest('base64url');
};

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
};

const createSessionToken = () => {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + config.adminSessionTtlHours * 60 * 60,
    nonce: randomUUID()
  };
  const encoded = base64url(JSON.stringify(payload));

  return `${encoded}.${sign(encoded)}`;
};

const parseCookies = (cookieHeader: string | undefined) => {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');

    if (rawName && rawValue.length > 0) {
      cookies.set(rawName, decodeURIComponent(rawValue.join('=')));
    }
  }

  return cookies;
};

const serializeCookie = (name: string, value: string, maxAgeSeconds: number) => {
  const secure = config.adminCookieSecure ? '; Secure' : '';

  return [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/admin',
    `Max-Age=${maxAgeSeconds}`,
    secure
  ]
    .filter(Boolean)
    .join('; ');
};

const isAdminAuthenticated = (request: FastifyRequest) => {
  const token = parseCookies(request.headers.cookie).get(cookieName);

  if (!token) {
    return false;
  }

  const [encoded, signature] = token.split('.');

  if (!encoded || !signature || !safeEqual(sign(encoded), signature)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    return Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
};

const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAdminAuthenticated(request)) {
    return reply.code(401).send({ error: 'Login admin dibutuhkan.' });
  }
};

const ipKey = (request: FastifyRequest) => request.ip || request.socket.remoteAddress || 'unknown';

const isLoginLimited = (key: string) => {
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    return false;
  }

  return attempt.count >= 8;
};

const recordFailedLogin = (key: string) => {
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return;
  }

  attempt.count += 1;
};

const sendHtml = (reply: FastifyReply, html: string) => {
  return reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'")
    .header('X-Frame-Options', 'DENY')
    .send(html);
};

const loginHtml = String.raw`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WA API Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d9dee7;
      --brand: #128c7e;
      --brand-dark: #0f766c;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(420px, calc(100vw - 32px));
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
    }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
    p { margin: 0 0 22px; color: var(--muted); line-height: 1.5; }
    label { display: block; margin-bottom: 8px; font-weight: 650; }
    input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
    }
    button {
      width: 100%;
      height: 44px;
      margin-top: 16px;
      border: 0;
      border-radius: 6px;
      background: var(--brand);
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: var(--brand-dark); }
    .error { min-height: 22px; margin-top: 14px; color: var(--danger); font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>WA API Admin</h1>
    <p>Masuk untuk menghubungkan WhatsApp dan mengirim pesan dari panel privat.</p>
    <form id="loginForm">
      <label for="password">Password admin</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Masuk</button>
      <div class="error" id="error" role="status"></div>
    </form>
  </main>
  <script>
    const form = document.querySelector('#loginForm');
    const errorBox = document.querySelector('#error');

    form.addEventListener('submit', async event => {
      event.preventDefault();
      errorBox.textContent = '';

      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = 'Memeriksa...';

      try {
        const response = await fetch('/admin/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: form.password.value })
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || 'Login gagal.');
        }

        location.href = '/admin';
      } catch (error) {
        errorBox.textContent = error.message;
      } finally {
        button.disabled = false;
        button.textContent = 'Masuk';
      }
    });
  </script>
</body>
</html>`;

const appHtml = (maxUploadMb: number) => String.raw`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WA API Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d9dee7;
      --brand: #128c7e;
      --brand-dark: #0f766c;
      --ok: #15803d;
      --warn: #a16207;
      --danger: #b42318;
      --soft: #edf7f4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(255, 255, 255, 0.95);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(12px);
    }
    .bar {
      max-width: 1180px;
      margin: 0 auto;
      min-height: 68px;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 { margin: 0; font-size: 20px; line-height: 1.2; }
    .header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .status-pill {
      min-height: 32px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--warn); }
    .dot.open { background: var(--ok); }
    .dot.close { background: var(--danger); }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px 20px 42px;
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 18px;
    }
    section {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    section h2 { margin: 0 0 14px; font-size: 16px; }
    .panel-stack { display: grid; gap: 18px; align-content: start; }
    .qr-box {
      min-height: 320px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: #fbfcfe;
      overflow: hidden;
    }
    .qr-box img { width: min(276px, 100%); height: auto; image-rendering: pixelated; }
    .empty { color: var(--muted); text-align: center; line-height: 1.5; padding: 18px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    form { display: grid; gap: 12px; }
    label { display: grid; gap: 7px; font-size: 13px; font-weight: 700; color: #344054; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }
    input { height: 42px; }
    textarea { min-height: 136px; resize: vertical; line-height: 1.45; }
    input[type="file"] { padding: 8px; }
    button {
      min-height: 40px;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0 14px;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
      background: var(--brand);
      color: #fff;
    }
    button:hover { background: var(--brand-dark); }
    button.secondary {
      background: #fff;
      color: var(--text);
      border-color: var(--line);
    }
    button.secondary:hover { background: #f2f4f7; }
    button.danger {
      background: #fff;
      color: var(--danger);
      border-color: #f1b8b2;
    }
    button.danger:hover { background: #fff5f4; }
    button:disabled { opacity: 0.62; cursor: not-allowed; }
    .button-row { display: flex; flex-wrap: wrap; gap: 10px; }
    .note { margin: 10px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      max-width: min(420px, calc(100vw - 36px));
      padding: 13px 15px;
      border-radius: 8px;
      color: #fff;
      background: #17202a;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.22);
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.error { background: var(--danger); }
    @media (max-width: 880px) {
      main { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .bar { align-items: flex-start; flex-direction: column; padding-top: 14px; padding-bottom: 14px; }
      .header-actions { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <h1>WA API Admin</h1>
      <div class="header-actions">
        <span class="status-pill"><span class="dot" id="statusDot"></span><span id="statusText">Memuat status</span></span>
        <button class="secondary" id="refreshBtn" type="button">Refresh</button>
        <button class="secondary" id="logoutBtn" type="button">Keluar</button>
      </div>
    </div>
  </header>
  <main>
    <div class="panel-stack">
      <section>
        <h2>Koneksi WhatsApp</h2>
        <div class="qr-box" id="qrBox">
          <div class="empty">Menunggu QR dari WhatsApp...</div>
        </div>
        <p class="note">Scan dari WhatsApp > Linked devices. QR akan hilang setelah tersambung.</p>
        <div class="button-row" style="margin-top:14px">
          <button class="secondary" id="reloadQrBtn" type="button">Muat QR</button>
          <button class="danger" id="waLogoutBtn" type="button">Putuskan WhatsApp</button>
        </div>
      </section>
    </div>
    <div class="grid">
      <section>
        <h2>Kirim Teks</h2>
        <form id="textForm">
          <label>Nomor tujuan
            <input name="to" placeholder="628123456789" inputmode="tel" autocomplete="off" required>
          </label>
          <label>Pesan
            <textarea name="text" placeholder="Isi pesan" maxlength="4096" required></textarea>
          </label>
          <button type="submit">Kirim Teks</button>
        </form>
      </section>
      <section>
        <h2>Kirim Attachment</h2>
        <form id="mediaForm">
          <label>Nomor tujuan
            <input name="to" placeholder="628123456789" inputmode="tel" autocomplete="off" required>
          </label>
          <label>Caption
            <input name="caption" placeholder="Opsional" autocomplete="off">
          </label>
          <label>File
            <input name="file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.mp4,.mp3,.ogg" required>
          </label>
          <button type="submit">Kirim Attachment</button>
          <p class="note">Batas file ${maxUploadMb} MB. Tipe didukung: PDF, Word, gambar, MP4, MP3, OGG.</p>
        </form>
      </section>
    </div>
  </main>
  <div class="toast" id="toast" role="status"></div>
  <script>
    const statusDot = document.querySelector('#statusDot');
    const statusText = document.querySelector('#statusText');
    const qrBox = document.querySelector('#qrBox');
    const toast = document.querySelector('#toast');
    const textForm = document.querySelector('#textForm');
    const mediaForm = document.querySelector('#mediaForm');

    function showToast(message, isError) {
      toast.textContent = message;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => {
        toast.className = 'toast';
      }, 4200);
    }

    async function api(path, options) {
      const response = await fetch(path, options);
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};

      if (!response.ok) {
        if (response.status === 401) {
          location.href = '/admin';
          return;
        }

        throw new Error(payload.error || 'Request gagal.');
      }

      return payload;
    }

    function setStatus(status) {
      const connection = status.connection || 'unknown';
      statusDot.className = 'dot ' + connection;
      statusText.textContent = connection === 'open' ? 'Terhubung' : connection === 'connecting' ? 'Menunggu scan QR' : 'Terputus';
    }

    async function refreshStatus() {
      const status = await api('/admin/api/session/status');
      setStatus(status);

      if (status.connection === 'open') {
        qrBox.innerHTML = '<div class="empty">WhatsApp sudah terhubung.</div>';
      } else if (status.hasQr) {
        qrBox.innerHTML = '<img src="/admin/api/session/qr.png?ts=' + Date.now() + '" alt="QR WhatsApp">';
      } else {
        qrBox.innerHTML = '<div class="empty">QR belum tersedia. Tunggu beberapa detik lalu refresh.</div>';
      }
    }

    async function submitJson(form, path) {
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        const result = await api(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        form.reset();
        showToast('Terkirim. ID: ' + (result.messageId || '-'), false);
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
        await refreshStatus().catch(() => undefined);
      }
    }

    async function submitMedia(form) {
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        const formData = new FormData(form);
        const result = await api('/admin/api/messages/media', {
          method: 'POST',
          body: formData
        });
        form.reset();
        showToast('Attachment terkirim. ID: ' + (result.messageId || '-'), false);
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
        await refreshStatus().catch(() => undefined);
      }
    }

    document.querySelector('#refreshBtn').addEventListener('click', () => refreshStatus().catch(error => showToast(error.message, true)));
    document.querySelector('#reloadQrBtn').addEventListener('click', () => refreshStatus().catch(error => showToast(error.message, true)));
    document.querySelector('#logoutBtn').addEventListener('click', async () => {
      await api('/admin/logout', { method: 'POST' });
      location.href = '/admin';
    });
    document.querySelector('#waLogoutBtn').addEventListener('click', async () => {
      if (!confirm('Putuskan session WhatsApp dari server ini?')) {
        return;
      }

      await api('/admin/api/session/logout', { method: 'POST' });
      await refreshStatus();
      showToast('Session WhatsApp diputus.', false);
    });
    textForm.addEventListener('submit', event => {
      event.preventDefault();
      submitJson(textForm, '/admin/api/messages/text');
    });
    mediaForm.addEventListener('submit', event => {
      event.preventDefault();
      submitMedia(mediaForm);
    });

    refreshStatus().catch(error => showToast(error.message, true));
    setInterval(() => refreshStatus().catch(() => undefined), 8000);
  </script>
</body>
</html>`;

export const registerAdminRoutes = async (app: FastifyInstance, wa: WhatsAppService) => {
  app.get('/', async (request, reply) => reply.redirect('/admin'));

  app.get('/admin', async (request, reply) => {
    return sendHtml(reply, isAdminAuthenticated(request) ? appHtml(config.maxUploadBytes / 1024 / 1024) : loginHtml);
  });

  app.post('/admin/login', async (request, reply) => {
    const key = ipKey(request);

    if (isLoginLimited(key)) {
      return reply.code(429).send({ error: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
    }

    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success || !safeEqual(parsed.data.password, config.adminPassword)) {
      recordFailedLogin(key);
      return reply.code(401).send({ error: 'Password admin salah.' });
    }

    loginAttempts.delete(key);
    const token = createSessionToken();
    reply.header('Set-Cookie', serializeCookie(cookieName, token, config.adminSessionTtlHours * 60 * 60));

    return { ok: true };
  });

  app.post('/admin/logout', { preHandler: requireAdmin }, async (request, reply) => {
    reply.header('Set-Cookie', serializeCookie(cookieName, '', 0));
    return { ok: true };
  });

  app.register(async admin => {
    admin.addHook('preHandler', requireAdmin);

    admin.get('/admin/api/session/status', getSessionStatus(wa));
    admin.get('/admin/api/session/qr', getSessionQr(wa));
    admin.get('/admin/api/session/qr.png', getSessionQrPng(wa));
    admin.post('/admin/api/session/logout', logoutSession(wa));
    admin.post('/admin/api/messages/text', sendTextMessage(wa));
    admin.post('/admin/api/messages/media', sendMediaMessage(wa));
  });
};
