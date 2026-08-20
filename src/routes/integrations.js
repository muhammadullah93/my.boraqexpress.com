import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit, query } from '../db.js';
import { requireRoles } from '../middleware.js';
import { marketplaceStatus, syncMarketplace } from '../services/marketplaces.js';
import { ApiError, limit, text } from '../utils.js';

export const integrationsRouter = Router();
integrationsRouter.use(requireRoles('admin'));

function normalizePlatform(value) {
  const platform = text(value, 'Platform', { max: 30 }).toLowerCase();
  if (!['shopee', 'tiktok', 'lazada'].includes(platform)) {
    throw new ApiError(404, 'PLATFORM_NOT_SUPPORTED', 'Marketplace is not supported.');
  }
  return platform;
}

integrationsRouter.get('/', async (_req, res) => {
  const rows = await query('SELECT * FROM integrations ORDER BY platform');
  const integrations = rows.map(row => {
    const runtime = marketplaceStatus(row.platform);
    return {
      id: row.id,
      platform: row.platform,
      status: runtime.credentialsConfigured ? 'awaiting_activation' : 'not_configured',
      credentialsConfigured: runtime.credentialsConfigured,
      approvalRequired: true,
      lastSyncAt: row.last_sync_at,
      message: runtime.credentialsConfigured
        ? 'Credentials detected. Activate the approved seller app and callback URLs before live sync.'
        : 'Official marketplace API approval and credentials are required.'
    };
  });
  res.json({ integrations });
});

integrationsRouter.get('/logs', async (req, res) => {
  const rows = await query(
    `SELECT sl.*, i.platform, u.name AS created_by_name
       FROM sync_logs sl JOIN integrations i ON i.id = sl.integration_id
       LEFT JOIN users u ON u.id = sl.created_by
      ORDER BY sl.created_at DESC LIMIT ?`,
    [limit(req.query.limit, 50, 200)]
  );
  res.json({ logs: rows });
});

integrationsRouter.post('/:platform/sync', async (req, res) => {
  const platform = normalizePlatform(req.params.platform);
  const [integration] = await query('SELECT * FROM integrations WHERE platform = ? LIMIT 1', [platform]);
  if (!integration) throw new ApiError(404, 'NOT_FOUND', 'Integration record was not found.');
  const runtime = marketplaceStatus(platform);
  await query(
    'UPDATE integrations SET credentials_configured = ?, status = ? WHERE id = ?',
    [runtime.credentialsConfigured ? 1 : 0, runtime.credentialsConfigured ? 'awaiting_activation' : 'not_configured', integration.id]
  );
  try {
    const output = await syncMarketplace(platform);
    const logId = randomUUID();
    await query(
      `INSERT INTO sync_logs (id, integration_id, direction, status, records_processed, message, created_by)
       VALUES (?, ?, 'bidirectional', 'success', ?, ?, ?)`,
      [logId, integration.id, Number(output?.recordsProcessed || 0), 'Synchronization completed.', req.user.id]
    );
    await query("UPDATE integrations SET status = 'connected', last_sync_at = UTC_TIMESTAMP() WHERE id = ?", [integration.id]);
    await audit(req.user.id, 'sync_marketplace', 'integration', integration.id, { platform, status: 'success' });
    res.json({ success: true, logId, output });
  } catch (error) {
    const logId = randomUUID();
    const message = String(error?.message || 'Synchronization failed.').slice(0, 500);
    await query(
      `INSERT INTO sync_logs (id, integration_id, direction, status, records_processed, message, created_by)
       VALUES (?, ?, 'bidirectional', 'failed', 0, ?, ?)`,
      [logId, integration.id, message, req.user.id]
    );
    await audit(req.user.id, 'sync_marketplace', 'integration', integration.id, { platform, status: 'failed', logId });
    throw error;
  }
});
