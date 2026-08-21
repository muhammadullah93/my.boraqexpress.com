import { audit, query } from '../db.js';
import { deleteDriveFile, googleDriveConfigured } from './google-drive.js';

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let cleanupRunning = false;

export async function cleanupExpiredPackProof() {
  if (!googleDriveConfigured() || cleanupRunning) return { skipped: true, deleted: 0, failed: 0 };
  cleanupRunning = true;
  let deleted = 0;
  let failed = 0;
  try {
    await query("DELETE FROM packproof_uploads WHERE status = 'uploading' AND expires_at < UTC_TIMESTAMP()");
    const expired = await query(
      `SELECT id, evidence_file_id
         FROM packing_sessions
        WHERE evidence_provider = 'google_drive'
          AND evidence_file_id IS NOT NULL
          AND retention_until IS NOT NULL
          AND retention_until <= UTC_TIMESTAMP()
        ORDER BY retention_until ASC
        LIMIT 100`
    );
    for (const item of expired) {
      try {
        await deleteDriveFile(item.evidence_file_id);
        await query(
          `UPDATE packing_sessions
              SET evidence_status = 'expired', evidence_file_id = NULL, evidence_url = NULL
            WHERE id = ? AND evidence_file_id = ?`,
          [item.id, item.evidence_file_id]
        );
        await audit(null, 'expire_packproof_evidence', 'packing_session', item.id, { provider: 'google_drive' });
        deleted += 1;
      } catch (error) {
        failed += 1;
        console.error(`PackProof cleanup failed for session ${item.id}:`, error.message);
      }
    }
    return { skipped: false, deleted, failed };
  } finally {
    cleanupRunning = false;
  }
}

export function schedulePackProofCleanup() {
  const timer = setInterval(() => {
    cleanupExpiredPackProof().catch(error => console.error('PackProof cleanup failed:', error.message));
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
  setTimeout(() => {
    cleanupExpiredPackProof().catch(error => console.error('Initial PackProof cleanup failed:', error.message));
  }, 15_000).unref();
  return timer;
}
