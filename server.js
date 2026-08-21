import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, validateRuntimeConfig } from './src/config.js';
import { closeDb, initDb } from './src/db.js';
import { cookies, errorHandler, notFound, requestContext, securityHeaders } from './src/middleware.js';
import { apiRouter } from './src/routes/api.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(currentDir, 'public');
let server;

async function start() {
  validateRuntimeConfig();
  await initDb();

  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(securityHeaders);
  app.use(cookies);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/api', apiRouter);
  app.use(express.static(publicDir, { dotfiles: 'ignore', etag: true, maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.includes('.')) {
      return res.sendFile(join(publicDir, 'index.html'));
    }
    next();
  });
  app.use('/api', notFound);
  app.use(errorHandler);

  server = app.listen(config.port, () => {
    console.log(`SellFlow Commerce OS listening on port ${config.port}`);
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 5_000;
}

async function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  if (!server) {
    await closeDb();
    process.exit(0);
  }
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(async (error) => {
  console.error('SellFlow startup failed:', error);
  try {
    await closeDb();
  } catch (closeError) {
    console.error('Failed to close database after startup error:', closeError);
  }
  process.exit(1);
});
