import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, validateRuntimeConfig } from './src/config.js';
import { closeDb, initDb } from './src/db.js';
import { cookies, errorHandler, notFound, securityHeaders } from './src/middleware.js';
import { apiRouter } from './src/routes/api.js';

validateRuntimeConfig();
await initDb();

const app = express();
const currentDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(currentDir, 'public');

app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
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

const server = app.listen(config.port, () => {
  console.log(`SellFlow Commerce OS listening on port ${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
