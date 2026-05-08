import 'dotenv/config';
const optionalNumber = (value, fallback) => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const normalizeHost = (value) => {
    const host = value?.trim();
    if (!host || host.toLowerCase() === 'o.o.o.o') {
        return '0.0.0.0';
    }
    return host;
};
export const config = {
    port: optionalNumber(process.env.PORT, 3000),
    host: normalizeHost(process.env.HOST),
    apiKey: process.env.API_KEY,
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminSessionSecret: process.env.ADMIN_SESSION_SECRET || process.env.API_KEY || '',
    adminSessionTtlHours: optionalNumber(process.env.ADMIN_SESSION_TTL_HOURS, 12),
    adminCookieSecure: process.env.ADMIN_COOKIE_SECURE === 'true',
    authDir: process.env.AUTH_DIR || 'auth',
    maxUploadBytes: optionalNumber(process.env.MAX_UPLOAD_MB, 15) * 1024 * 1024,
    rateLimitMax: optionalNumber(process.env.RATE_LIMIT_MAX, 60),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW || '1 minute'
};
export const assertSecureConfig = () => {
    if (!config.apiKey || config.apiKey.length < 24) {
        throw new Error('API_KEY wajib diisi minimal 24 karakter. Lihat .env.example.');
    }
    if (!config.adminPassword || config.adminPassword.length < 12) {
        throw new Error('ADMIN_PASSWORD wajib diisi minimal 12 karakter. Lihat .env.example.');
    }
    if (!config.adminSessionSecret || config.adminSessionSecret.length < 32) {
        throw new Error('ADMIN_SESSION_SECRET wajib diisi minimal 32 karakter, atau gunakan API_KEY minimal 32 karakter.');
    }
};
