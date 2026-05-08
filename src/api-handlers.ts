import type { FastifyReply, FastifyRequest } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { config } from './config.js';
import type { WhatsAppService } from './whatsapp.js';

const textSchema = z.object({
  to: z.string().min(8).max(24),
  text: z.string().min(1).max(4096)
});

const allowedMediaTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'audio/mpeg',
  'audio/ogg'
]);

export const getSessionStatus = (wa: WhatsAppService) => async () => wa.getStatus();

export const startSession = (wa: WhatsAppService) => async () => {
  await wa.start();
  return { ok: true, status: wa.getStatus() };
};

export const getSessionQr = (wa: WhatsAppService) => async (request: FastifyRequest, reply: FastifyReply) => {
  const status = wa.getStatus();

  if (!status.qrDataUrl) {
    return reply.code(404).send({
      error: status.connection === 'open' ? 'WhatsApp sudah tersambung.' : 'QR belum tersedia.'
    });
  }

  return {
    qr: status.qr,
    qrDataUrl: status.qrDataUrl
  };
};

export const getSessionQrPng = (wa: WhatsAppService) => async (request: FastifyRequest, reply: FastifyReply) => {
  const status = wa.getStatus();

  if (!status.qrDataUrl) {
    return reply.code(404).send({
      error: status.connection === 'open' ? 'WhatsApp sudah tersambung.' : 'QR belum tersedia.'
    });
  }

  const base64 = status.qrDataUrl.replace(/^data:image\/png;base64,/, '');
  return reply.type('image/png').send(Buffer.from(base64, 'base64'));
};

export const logoutSession = (wa: WhatsAppService) => async () => {
  await wa.logout();
  return { ok: true };
};

export const sendTextMessage = (wa: WhatsAppService) => async (request: FastifyRequest, reply: FastifyReply) => {
  const parsed = textSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Payload tidak valid', details: parsed.error.flatten() });
  }

  const result = await wa.sendText(parsed.data);
  return { ok: true, messageId: result?.key.id };
};

export const sendMediaMessage = (wa: WhatsAppService) => async (request: FastifyRequest, reply: FastifyReply) => {
  const file = await request.file({ limits: { fileSize: config.maxUploadBytes } });

  if (!file) {
    return reply.code(400).send({ error: 'Field file wajib diisi.' });
  }

  const fields = file.fields as Record<string, { value?: unknown } | undefined>;
  const to = fields.to?.value;
  const caption = fields.caption?.value;
  const buffer = await file.toBuffer();
  const detected = await fileTypeFromBuffer(buffer);
  const mimetype = detected?.mime || file.mimetype;

  if (typeof to !== 'string') {
    return reply.code(400).send({ error: 'Field to wajib diisi.' });
  }

  if (caption !== undefined && typeof caption !== 'string') {
    return reply.code(400).send({ error: 'Field caption harus string.' });
  }

  if (!allowedMediaTypes.has(mimetype)) {
    return reply.code(415).send({ error: `Tipe file tidak didukung: ${mimetype}` });
  }

  const result = await wa.sendMedia({
    to,
    buffer,
    mimetype,
    filename: file.filename || `attachment.${detected?.ext || 'bin'}`,
    caption
  });

  return { ok: true, messageId: result?.key.id };
};
