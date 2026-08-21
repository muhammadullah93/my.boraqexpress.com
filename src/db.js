import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { hashPassword } from './auth.js';

let pool;

async function prepareMigration(connection, id) {
  if (id !== '002_operations') return;
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'supplier_unit_price'`,
    [config.db.name]
  );
  if (!columns[0]) {
    await connection.execute('ALTER TABLE order_items ADD COLUMN supplier_unit_price DECIMAL(12,2) NULL AFTER unit_price');
  }
}

function connectionOptions(extra = {}) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    charset: 'utf8mb4',
    timezone: 'Z',
    ssl: config.db.ssl ? {} : undefined,
    ...extra
  };
}

export async function initDb() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrations = [
    { id: '001_initial', file: 'schema.sql' },
    { id: '002_operations', file: '002_operations.sql' }
  ];
  const bootstrap = await mysql.createConnection(connectionOptions({ multipleStatements: true }));
  try {
    await bootstrap.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id VARCHAR(80) PRIMARY KEY,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    for (const migration of migrations) {
      const [applied] = await bootstrap.execute('SELECT id FROM schema_migrations WHERE id = ? LIMIT 1', [migration.id]);
      if (applied[0]) continue;
      await prepareMigration(bootstrap, migration.id);
      const sql = await readFile(join(currentDir, '..', 'db', migration.file), 'utf8');
      await bootstrap.query(sql);
      await bootstrap.execute('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    }
  } finally {
    await bootstrap.end();
  }

  pool = mysql.createPool({
    ...connectionOptions(),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
  await pool.query('SELECT 1');
  await ensureInitialAdmin();
}

export function db() {
  if (!pool) throw new Error('Database has not been initialized.');
  return pool;
}

export async function query(sql, params = []) {
  const [rows] = await db().execute(sql, params);
  return rows;
}

export async function transaction(callback) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function audit(userId, action, entityType, entityId, details = {}) {
  await query(
    'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)',
    [randomUUID(), userId || null, action, entityType, entityId || null, JSON.stringify(details)]
  );
}

async function ensureInitialAdmin() {
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM users');
  if (Number(total) > 0) return;
  if (!config.admin.email || !config.admin.password) {
    throw new Error('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD for the first successful boot.');
  }
  const passwordHash = await hashPassword(config.admin.password);
  const id = randomUUID();
  await query(
    `INSERT INTO users (id, name, email, password_hash, role, company_name, status)
     VALUES (?, ?, ?, ?, 'admin', 'Boraq Express Operations', 'active')`,
    [id, config.admin.name, config.admin.email, passwordHash]
  );
  await audit(id, 'bootstrap_admin', 'user', id, { email: config.admin.email });
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}
