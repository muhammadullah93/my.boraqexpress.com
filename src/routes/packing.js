import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Router, raw } from 'express';
import { orderForRole, orderScope } from '../access.js';
import { config } from '../config.js';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import {
  googleDriveConfigured,
  openDriveFile,
  parseContentRange,
  safeDriveName,
  sendDriveChunk,
  startDriveUpload
} from '../services/google-drive.js';
import { ApiError, limit, text } from '../utils.js';

export const packingRouter = Router();

function sessionForRole(row, role) {
  const order = orderForRole({
    id: row.order_id,
    order_no: row.order_no,
    channel: row.channel,
    dropshipper_user_id: row.dropshipper_user_id,
    supplier_user_id: row.supplier_user_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    shipping_address: row.shipping_address,
    fulfillment_status: row.fulfillment_status,
    tracking_no: row.tracking_no
  }, role);
  const result = {
    id: row.id,
    barcode: row.barcode,
    status: row.status,
    evidenceStatus: row.evidence_status,
    evidenceUrl: row.evidence_url,
    evidenceProvider: row.evidence_provider,
    evidenceName: row.evidence_name,
    evidenceMimeType: row.evidence_mime_type,
    evidenceSize: row.evidence_size == null ? null : Number(row.evidence_size),
    hasVideo: Boolean(row.evidence_file_id),
    retentionUntil: row.retention_until,
    notes: row.notes,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    operatorName: row.operator_name,
    order
  };
  if (role === 'dropshipper') delete result.operatorName;
  return result;
}

function evidenceUrl(value) {
  const input = text(value, 'Evidence URL', { required: false, max: 500 });
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:') throw new Error('not https');
    return parsed.toString();
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Evidence URL must be a valid HTTPS URL.');
  }
}

const sessionSelect = `
  SELECT ps.*, o.order_no, o.channel, o.dropshipper_user_id, o.supplier_user_id,
         o.customer_name, o.customer_phone, o.shipping_address, o.fulfillment_status,
         o.tracking_no, u.name AS operator_name
    FROM packing_sessions ps
    JOIN orders o ON o.id = ps.order_id
    LEFT JOIN users u ON u.id = ps.operator_user_id`;

async function accessibleSession(id, user) {
  const scope = orderScope(user);
  const [session] = await query(`${sessionSelect} WHERE ps.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params]);
  if (!session) throw new ApiError(404, 'NOT_FOUND', 'Packing session was not found.');
  return session;
}

function videoMetadata(body) {
  const fileName = safeDriveName(text(body?.fileName, 'Video file name', { max: 255 }));
  const mimeType = text(body?.mimeType, 'Video type', { max: 120 }).toLowerCase();
  const size = Number(body?.size);
  if (!/^video\/[a-z0-9.+-]+$/.test(mimeType)) {
    throw new ApiError(400, 'INVALID_VIDEO_TYPE', 'PackProof accepts video files only.');
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > config.packProof.maxFileBytes) {
    throw new ApiError(400, 'INVALID_VIDEO_SIZE', `Video size must be between 1 byte and ${config.packProof.maxFileBytes} bytes.`);
  }
  return { fileName, mimeType, size };
}

packingRouter.get('/storage', (_req, res) => {
  res.json({
    enabled: googleDriveConfigured(),
    provider: googleDriveConfigured() ? 'google_drive' : null,
    retentionDays: config.packProof.retentionDays,
    maxFileBytes: config.packProof.maxFileBytes,
    chunkBytes: config.packProof.chunkBytes
  });
});

packingRouter.get('/', async (req, res) => {
  const scope = orderScope(req.user);
  const rows = await query(
    `${sessionSelect} WHERE ${scope.sql} ORDER BY ps.started_at DESC LIMIT ?`,
    [...scope.params, limit(req.query.limit)]
  );
  res.json({ sessions: rows.map(row => sessionForRole(row, req.user.role)) });
});

packingRouter.post('/scan', requireRoles('admin', 'supplier'), async (req, res) => {
  const barcode = text(req.body?.barcode, 'Barcode or airway bill', { max: 160 });
  const scope = orderScope(req.user);
  const result = await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT o.* FROM orders o
        WHERE ${scope.sql} AND (o.order_no = ? OR o.tracking_no = ?)
        LIMIT 1 FOR UPDATE`,
      [...scope.params, barcode, barcode]
    );
    const order = rows[0];
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'No accessible order matches that barcode, order number, or airway bill.');
    if (['to_ship', 'shipped', 'delivered', 'cancelled', 'complete'].includes(order.fulfillment_status)) {
      throw new ApiError(409, 'ORDER_NOT_PACKABLE', `An order in ${order.fulfillment_status} status cannot be packed.`);
    }
    const [existingRows] = await connection.execute(
      "SELECT id FROM packing_sessions WHERE order_id = ? AND status = 'packing' ORDER BY started_at DESC LIMIT 1",
      [order.id]
    );
    if (existingRows[0]) return { sessionId: existingRows[0].id, orderId: order.id, resumed: true };
    const sessionId = randomUUID();
    await connection.execute(
      `INSERT INTO packing_sessions (id, order_id, barcode, operator_user_id, status, evidence_status)
       VALUES (?, ?, ?, ?, 'packing', 'pending')`,
      [sessionId, order.id, barcode, req.user.id]
    );
    await connection.execute(
      "UPDATE orders SET fulfillment_status = 'packing' WHERE id = ? AND fulfillment_status IN ('new', 'pending_payment')",
      [order.id]
    );
    return { sessionId, orderId: order.id, resumed: false };
  });
  const sessionId = result.sessionId;
  if (!result.resumed) {
    await audit(req.user.id, 'start_packing', 'packing_session', sessionId, { orderId: result.orderId, barcode });
  }
  const [session] = await query(`${sessionSelect} WHERE ps.id = ? LIMIT 1`, [sessionId]);
  res.status(result.resumed ? 200 : 201).json({ session: sessionForRole(session, req.user.role), resumed: result.resumed });
});

packingRouter.post('/:id/evidence/uploads', requireRoles('admin', 'supplier'), async (req, res) => {
  if (!googleDriveConfigured()) {
    throw new ApiError(503, 'PACKPROOF_STORAGE_NOT_CONFIGURED', 'Google Drive PackProof storage is not configured.');
  }
  const metadata = videoMetadata(req.body);
  const session = await accessibleSession(req.params.id, req.user);
  if (session.status !== 'packing') throw new ApiError(409, 'PACKING_NOT_ACTIVE', 'Video can only be attached to an active packing session.');
  if (session.evidence_file_id) throw new ApiError(409, 'EVIDENCE_ALREADY_ATTACHED', 'This packing session already has a stored video.');
  const [activeUpload] = await query(
    "SELECT id, file_name, mime_type, total_size, uploaded_size FROM packproof_uploads WHERE packing_session_id = ? AND status = 'uploading' AND expires_at > UTC_TIMESTAMP() LIMIT 1",
    [session.id]
  );
  if (activeUpload) {
    if (activeUpload.mime_type !== metadata.mimeType || Number(activeUpload.total_size) !== metadata.size || !activeUpload.file_name.endsWith(`-${metadata.fileName}`)) {
      throw new ApiError(409, 'UPLOAD_ALREADY_ACTIVE', 'A different video upload is already active for this packing session.');
    }
    return res.json({
      upload: {
        id: activeUpload.id,
        uploadedSize: Number(activeUpload.uploaded_size),
        totalSize: Number(activeUpload.total_size),
        chunkBytes: config.packProof.chunkBytes,
        resumed: true
      }
    });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const driveName = safeDriveName(`${session.order_no}-${timestamp}-${metadata.fileName}`);
  const providerSessionUrl = await startDriveUpload({ ...metadata, fileName: driveName });
  const uploadId = randomUUID();
  await query(
    `INSERT INTO packproof_uploads
      (id, packing_session_id, created_by, provider_session_url, file_name, mime_type, total_size, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))`,
    [uploadId, session.id, req.user.id, providerSessionUrl, driveName, metadata.mimeType, metadata.size]
  );
  await audit(req.user.id, 'start_packproof_upload', 'packing_session', session.id, { uploadId, size: metadata.size, mimeType: metadata.mimeType });
  res.status(201).json({
    upload: { id: uploadId, uploadedSize: 0, totalSize: metadata.size, chunkBytes: config.packProof.chunkBytes }
  });
});

packingRouter.put(
  '/evidence/uploads/:uploadId',
  requireRoles('admin', 'supplier'),
  raw({ type: 'application/octet-stream', limit: config.packProof.chunkBytes + 1024 }),
  async (req, res) => {
    const contentRange = req.get('Content-Range');
    const range = parseContentRange(contentRange);
    if (!Buffer.isBuffer(req.body) || req.body.length !== range.length) {
      throw new ApiError(400, 'CHUNK_SIZE_MISMATCH', 'The uploaded chunk does not match Content-Range.');
    }
    if (range.length > config.packProof.chunkBytes) {
      throw new ApiError(413, 'CHUNK_TOO_LARGE', 'The PackProof upload chunk is too large.');
    }
    if (range.end + 1 < range.total && range.length % (256 * 1024) !== 0) {
      throw new ApiError(400, 'INVALID_CHUNK_SIZE', 'Non-final Google Drive chunks must be a multiple of 256 KB.');
    }
    const scope = orderScope(req.user);
    const [upload] = await query(
      `SELECT pu.*, o.supplier_user_id
         FROM packproof_uploads pu
         JOIN packing_sessions ps ON ps.id = pu.packing_session_id
         JOIN orders o ON o.id = ps.order_id
        WHERE pu.id = ? AND ${scope.sql}
        LIMIT 1`,
      [req.params.uploadId, ...scope.params]
    );
    if (!upload) throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'PackProof upload was not found.');
    if (upload.status !== 'uploading') throw new ApiError(409, 'UPLOAD_NOT_ACTIVE', 'This PackProof upload is no longer active.');
    if (new Date(upload.expires_at).getTime() <= Date.now()) throw new ApiError(410, 'UPLOAD_EXPIRED', 'This PackProof upload session has expired.');
    if (range.total !== Number(upload.total_size) || range.start !== Number(upload.uploaded_size)) {
      throw new ApiError(409, 'UPLOAD_OFFSET_MISMATCH', 'Upload offset does not match the server record.', { uploadedSize: Number(upload.uploaded_size) });
    }
    const result = await sendDriveChunk({
      sessionUrl: upload.provider_session_url,
      body: req.body,
      contentRange,
      mimeType: upload.mime_type
    });
    if (!result.complete) {
      const uploadedSize = Math.max(result.uploadedSize, range.end + 1);
      await query('UPDATE packproof_uploads SET uploaded_size = ? WHERE id = ? AND status = ?', [uploadedSize, upload.id, 'uploading']);
      return res.status(202).json({ upload: { id: upload.id, complete: false, uploadedSize, totalSize: range.total } });
    }
    await transaction(async connection => {
      await connection.execute(
        `UPDATE packproof_uploads
            SET status = 'completed', uploaded_size = total_size, drive_file_id = ?
          WHERE id = ? AND status = 'uploading'`,
        [result.file.id, upload.id]
      );
      await connection.execute(
        `UPDATE packing_sessions
            SET evidence_status = 'captured', evidence_url = NULL, evidence_provider = 'google_drive',
                evidence_file_id = ?, evidence_name = ?, evidence_mime_type = ?, evidence_size = ?,
                retention_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${config.packProof.retentionDays} DAY)
          WHERE id = ?`,
        [result.file.id, result.file.name || upload.file_name, upload.mime_type, Number(upload.total_size), upload.packing_session_id]
      );
    });
    await audit(req.user.id, 'complete_packproof_upload', 'packing_session', upload.packing_session_id, {
      uploadId: upload.id,
      provider: 'google_drive',
      size: Number(upload.total_size)
    });
    const session = await accessibleSession(upload.packing_session_id, req.user);
    res.json({ upload: { id: upload.id, complete: true, uploadedSize: range.total, totalSize: range.total }, session: sessionForRole(session, req.user.role) });
  }
);

packingRouter.get('/:id/evidence', async (req, res) => {
  const session = await accessibleSession(req.params.id, req.user);
  if (!session.evidence_file_id || session.evidence_provider !== 'google_drive') {
    throw new ApiError(404, 'EVIDENCE_NOT_FOUND', 'No stored PackProof video is available.');
  }
  if (session.retention_until && new Date(session.retention_until).getTime() <= Date.now()) {
    throw new ApiError(410, 'EVIDENCE_EXPIRED', 'This PackProof video has reached the retention limit.');
  }
  const driveResponse = await openDriveFile(session.evidence_file_id, req.get('Range'));
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = driveResponse.headers.get(header);
    if (value) res.set(header, value);
  }
  const downloadName = encodeURIComponent(safeDriveName(session.evidence_name || 'packproof-video'));
  res.set('Content-Disposition', `inline; filename="packproof-video"; filename*=UTF-8''${downloadName}`);
  res.status(driveResponse.status);
  if (!driveResponse.body) return res.end();
  Readable.fromWeb(driveResponse.body).on('error', () => res.destroy()).pipe(res);
});

packingRouter.post('/:id/complete', requireRoles('admin', 'supplier'), async (req, res) => {
  const url = evidenceUrl(req.body?.evidenceUrl);
  const notes = text(req.body?.notes, 'Notes', { required: false, max: 2000 }) || null;
  const result = await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT ps.*, o.supplier_user_id, o.fulfillment_status
         FROM packing_sessions ps JOIN orders o ON o.id = ps.order_id
        WHERE ps.id = ? FOR UPDATE`,
      [req.params.id]
    );
    const session = rows[0];
    if (!session) throw new ApiError(404, 'NOT_FOUND', 'Packing session was not found.');
    if (req.user.role === 'supplier' && session.supplier_user_id !== req.user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'This order is not assigned to you.');
    }
    if (session.status === 'packed') throw new ApiError(409, 'ALREADY_COMPLETED', 'This packing session is already complete.');
    const hasDriveVideo = Boolean(session.evidence_file_id && session.evidence_provider === 'google_drive');
    const evidenceStatus = hasDriveVideo || url ? 'captured' : 'metadata_only';
    const provider = hasDriveVideo ? 'google_drive' : (url ? 'external_url' : null);
    await connection.execute(
      `UPDATE packing_sessions
          SET status = 'packed', evidence_status = ?, evidence_url = ?, evidence_provider = ?, notes = ?,
              retention_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${config.packProof.retentionDays} DAY), completed_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [evidenceStatus, hasDriveVideo ? null : url, provider, notes, session.id]
    );
    await connection.execute(
      "UPDATE orders SET fulfillment_status = 'to_ship' WHERE id = ? AND fulfillment_status IN ('new', 'pending_payment', 'packing')",
      [session.order_id]
    );
    return { orderId: session.order_id, evidenceStatus };
  });
  await audit(req.user.id, 'complete_packing', 'packing_session', req.params.id, result);
  const [session] = await query(`${sessionSelect} WHERE ps.id = ? LIMIT 1`, [req.params.id]);
  res.json({ session: sessionForRole(session, req.user.role) });
});
