import { config } from './config.js';
import { getSessionQr, getSessionQrPng, getSessionStatus, logoutSession, sendMediaMessage, sendTextMessage, startSession } from './api-handlers.js';
const requireApiKey = async (request, reply) => {
    const apiKey = request.headers['x-api-key'];
    if (apiKey !== config.apiKey) {
        return reply.code(401).send({ error: 'Unauthorized' });
    }
};
export const registerRoutes = async (app, wa) => {
    app.register(async (api) => {
        api.addHook('preHandler', requireApiKey);
        api.get('/health', async () => ({ ok: true }));
        api.get('/api/session/status', getSessionStatus(wa));
        api.get('/api/session/qr', getSessionQr(wa));
        api.get('/api/session/qr.png', getSessionQrPng(wa));
        api.post('/api/session/start', startSession(wa));
        api.post('/api/session/logout', logoutSession(wa));
        api.post('/api/messages/text', sendTextMessage(wa));
        api.post('/api/messages/media', sendMediaMessage(wa));
    });
};
