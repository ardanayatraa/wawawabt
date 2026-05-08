import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { config, assertSecureConfig } from './config.js';
import { registerRoutes } from './routes.js';
import { registerAdminRoutes } from './admin.js';
import { WhatsAppService } from './whatsapp.js';
assertSecureConfig();
const app = Fastify({
    logger: true,
    bodyLimit: config.maxUploadBytes
});
app.setErrorHandler((error, request, reply) => {
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'Ukuran file terlalu besar.' });
    }
    if (error.message.includes('WhatsApp belum tersambung')) {
        return reply.code(409).send({ error: error.message });
    }
    if (error.message.includes('Nomor tujuan tidak valid')) {
        return reply.code(400).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
});
await app.register(cors, {
    origin: false
});
await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow
});
await app.register(multipart, {
    limits: {
        fileSize: config.maxUploadBytes,
        files: 1
    }
});
const wa = new WhatsAppService(config.authDir);
await wa.start();
await registerAdminRoutes(app, wa);
await registerRoutes(app, wa);
const shutdown = async () => {
    await app.close();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await app.listen({ port: config.port, host: config.host });
