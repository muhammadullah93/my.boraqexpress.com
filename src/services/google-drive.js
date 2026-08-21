import { config, driveStorageConfigured } from '../config.js';
import { ApiError } from '../utils.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const REQUEST_TIMEOUT_MS = 30_000;

let tokenCache;
const folderCache = new Map();

function driveError(message, status = 502, code = 'DRIVE_ERROR') {
  return new ApiError(status, code, message);
}

async function responseMessage(response) {
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.error_description || `Google Drive returned HTTP ${response.status}.`;
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw driveError('Google Drive did not respond in time.', 504, 'DRIVE_TIMEOUT');
    throw driveError('Google Drive could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
}

export function googleDriveConfigured() {
  return driveStorageConfigured();
}

export function safeDriveName(value) {
  const cleaned = String(value || 'packproof-video')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'packproof-video').slice(0, 220);
}

export function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(value || ''));
  if (!match) throw new ApiError(400, 'INVALID_CONTENT_RANGE', 'Content-Range must use bytes start-end/total.');
  const [, start, end, total] = match.map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) {
    throw new ApiError(400, 'INVALID_CONTENT_RANGE', 'Content-Range values are invalid.');
  }
  return { start, end, total, length: end - start + 1 };
}

async function accessToken() {
  if (!googleDriveConfigured()) {
    throw new ApiError(503, 'PACKPROOF_STORAGE_NOT_CONFIGURED', 'Google Drive PackProof storage is not configured.');
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const body = new URLSearchParams({
    client_id: config.packProof.drive.clientId,
    client_secret: config.packProof.drive.clientSecret,
    refresh_token: config.packProof.drive.refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await timedFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw driveError(`Google Drive authorization failed: ${await responseMessage(response)}`, 502, 'DRIVE_AUTH_FAILED');
  const data = await response.json();
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000
  };
  return tokenCache.value;
}

async function authorizedFetch(url, options = {}) {
  const token = await accessToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return timedFetch(url, { ...options, headers });
}

function quoteQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(parentId, name) {
  const q = `'${quoteQuery(parentId)}' in parents and name = '${quoteQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    pageSize: '2',
    spaces: 'drive',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true'
  });
  const response = await authorizedFetch(`${DRIVE_FILES_URL}?${params}`);
  if (!response.ok) throw driveError(`Could not inspect the PackProof folder: ${await responseMessage(response)}`);
  return (await response.json()).files?.[0]?.id || null;
}

async function createFolder(parentId, name) {
  const params = new URLSearchParams({ fields: 'id', supportsAllDrives: 'true' });
  const response = await authorizedFetch(`${DRIVE_FILES_URL}?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
  });
  if (!response.ok) throw driveError(`Could not create the PackProof date folder: ${await responseMessage(response)}`);
  return (await response.json()).id;
}

async function datedFolder(now = new Date()) {
  const parts = [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0')
  ];
  const cacheKey = parts.join('/');
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
  let parentId = config.packProof.drive.folderId;
  for (const name of parts) {
    parentId = await findFolder(parentId, name) || await createFolder(parentId, name);
  }
  folderCache.set(cacheKey, parentId);
  return parentId;
}

export async function startDriveUpload({ fileName, mimeType, size }) {
  const parentId = await datedFolder();
  const params = new URLSearchParams({
    uploadType: 'resumable',
    supportsAllDrives: 'true',
    fields: 'id,name,size,mimeType,createdTime'
  });
  const response = await authorizedFetch(`${DRIVE_UPLOAD_URL}?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size)
    },
    body: JSON.stringify({ name: safeDriveName(fileName), parents: [parentId] })
  });
  if (!response.ok) throw driveError(`Could not start the PackProof upload: ${await responseMessage(response)}`);
  const sessionUrl = response.headers.get('location');
  if (!sessionUrl) throw driveError('Google Drive did not return an upload session.');
  return sessionUrl;
}

export async function sendDriveChunk({ sessionUrl, body, contentRange, mimeType }) {
  const response = await authorizedFetch(sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(body.length),
      'Content-Range': contentRange
    },
    body
  });
  if (response.status === 308) {
    const range = response.headers.get('range');
    const uploadedSize = range ? Number(range.split('-').at(-1)) + 1 : 0;
    return { complete: false, uploadedSize };
  }
  if (!response.ok) throw driveError(`PackProof upload failed: ${await responseMessage(response)}`);
  const file = await response.json();
  return { complete: true, uploadedSize: Number(file.size) || body.length, file };
}

export async function openDriveFile(fileId, range) {
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  const headers = range ? { Range: range } : {};
  const response = await authorizedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params}`, { headers });
  if (response.status === 404) throw new ApiError(404, 'EVIDENCE_NOT_FOUND', 'The PackProof video no longer exists.');
  if (!response.ok) throw driveError(`Could not open the PackProof video: ${await responseMessage(response)}`);
  return response;
}

export async function deleteDriveFile(fileId) {
  const params = new URLSearchParams({ supportsAllDrives: 'true' });
  const response = await authorizedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params}`, { method: 'DELETE' });
  if (response.status === 404) return false;
  if (!response.ok) throw driveError(`Could not delete an expired PackProof video: ${await responseMessage(response)}`);
  return true;
}
