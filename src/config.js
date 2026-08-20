const env = process.env;

function integer(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export const config = {
  nodeEnv: env.NODE_ENV || 'development',
  port: integer(env.PORT, 3000),
  trustProxy: integer(env.TRUST_PROXY, 0),
  sessionSecret: env.SESSION_SECRET || '',
  sessionTtlHours: integer(env.SESSION_TTL_HOURS, 12),
  db: {
    host: env.DB_HOST || '',
    port: integer(env.DB_PORT, 3306),
    name: env.DB_NAME || '',
    user: env.DB_USER || '',
    password: env.DB_PASSWORD || '',
    ssl: boolean(env.DB_SSL, false)
  },
  admin: {
    name: env.ADMIN_NAME || 'SellFlow Administrator',
    email: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD || ''
  },
  integrations: {
    shopee: {
      partnerId: env.SHOPEE_PARTNER_ID || '',
      partnerKey: env.SHOPEE_PARTNER_KEY || ''
    },
    tiktok: {
      appKey: env.TIKTOK_APP_KEY || '',
      appSecret: env.TIKTOK_APP_SECRET || ''
    },
    lazada: {
      appKey: env.LAZADA_APP_KEY || '',
      appSecret: env.LAZADA_APP_SECRET || ''
    }
  }
};

export function validateRuntimeConfig() {
  const missing = [];
  for (const [key, value] of Object.entries({
    DB_HOST: config.db.host,
    DB_NAME: config.db.name,
    DB_USER: config.db.user,
    DB_PASSWORD: config.db.password,
    SESSION_SECRET: config.sessionSecret
  })) {
    if (!value) missing.push(key);
  }
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  if ((config.admin.email && !config.admin.password) || (!config.admin.email && config.admin.password)) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be supplied together.');
  }
  if (config.admin.password && config.admin.password.length < 12) {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
  }
}

export function integrationConfigured(platform) {
  const item = config.integrations[platform];
  return Boolean(item && Object.values(item).every(Boolean));
}
