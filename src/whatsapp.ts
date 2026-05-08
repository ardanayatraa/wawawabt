import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import PQueue from 'p-queue';
import P from 'pino';
import QRCode from 'qrcode';
import { rm } from 'node:fs/promises';

export type ConnectionState = 'starting' | 'connecting' | 'open' | 'close';

export type SendTextInput = {
  to: string;
  text: string;
};

export type SendMediaInput = {
  to: string;
  buffer: Buffer;
  mimetype: string;
  filename: string;
  caption?: string;
};

const logger = P({ level: process.env.LOG_LEVEL || 'info' });

export class WhatsAppService {
  private socket?: WASocket;
  private connection: ConnectionState = 'starting';
  private qr?: string;
  private qrDataUrl?: string;
  private lastError?: string;
  private reconnecting = false;
  private readonly queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 4 });

  constructor(private readonly authDir: string) {}

  async start() {
    if (this.connection === 'open' || this.connection === 'connecting') {
      return;
    }

    this.connection = 'connecting';
    this.lastError = undefined;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({
        version,
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false,
        logger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        }
      });

      this.socket = socket;
      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', async update => {
        if (update.qr) {
          this.qr = update.qr;
          this.qrDataUrl = await QRCode.toDataURL(update.qr);
          this.lastError = undefined;
        }

        if (update.connection) {
          this.connection = update.connection;
        }

        if (update.connection === 'open') {
          this.qr = undefined;
          this.qrDataUrl = undefined;
          this.lastError = undefined;
        }

        if (update.connection === 'close') {
          const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect) {
            void this.reconnect();
          } else {
            this.lastError = 'Session WhatsApp logout. Scan QR ulang untuk menyambungkan.';
          }
        }
      });
    } catch (error) {
      this.socket = undefined;
      this.connection = 'close';
      this.qr = undefined;
      this.qrDataUrl = undefined;
      this.lastError = this.errorMessage(error);
      logger.error({ err: error }, 'Failed to start WhatsApp socket');
      throw error;
    }
  }

  getStatus() {
    return {
      connection: this.connection,
      hasQr: Boolean(this.qr),
      qr: this.qr,
      qrDataUrl: this.qrDataUrl,
      lastError: this.lastError
    };
  }

  async sendText(input: SendTextInput) {
    const socket = this.requireSocket();
    const jid = this.toJid(input.to);

    return this.queue.add(() => socket.sendMessage(jid, { text: input.text }));
  }

  async sendMedia(input: SendMediaInput) {
    const socket = this.requireSocket();
    const jid = this.toJid(input.to);
    const media = this.toMediaMessage(input);

    return this.queue.add(() => socket.sendMessage(jid, media));
  }

  async logout() {
    if (this.socket) {
      await this.socket.logout();
    }

    await rm(this.authDir, { recursive: true, force: true });
    this.socket = undefined;
    this.connection = 'close';
    this.qr = undefined;
    this.qrDataUrl = undefined;
    this.lastError = undefined;
  }

  private async reconnect() {
    if (this.reconnecting) {
      return;
    }

    this.reconnecting = true;
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.start();
    } catch (error) {
      this.lastError = this.errorMessage(error);
      logger.error({ err: error }, 'WhatsApp reconnect failed');
    } finally {
      this.reconnecting = false;
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private requireSocket() {
    if (!this.socket || this.connection !== 'open') {
      throw new Error('WhatsApp belum tersambung. Scan QR dari /api/session/qr lebih dulu.');
    }

    return this.socket;
  }

  private toJid(to: string) {
    const digits = to.replace(/[^\d]/g, '');
    if (!digits || digits.length < 8 || digits.length > 16) {
      throw new Error('Nomor tujuan tidak valid. Gunakan format internasional, contoh: 628123456789.');
    }

    return `${digits}@s.whatsapp.net`;
  }

  private toMediaMessage(input: SendMediaInput) {
    const { buffer, mimetype, filename, caption } = input;

    if (mimetype.startsWith('image/')) {
      return { image: buffer, mimetype, caption };
    }

    if (mimetype.startsWith('video/')) {
      return { video: buffer, mimetype, caption };
    }

    if (mimetype.startsWith('audio/')) {
      return { audio: buffer, mimetype };
    }

    return {
      document: buffer,
      mimetype,
      fileName: filename,
      caption
    };
  }
}
