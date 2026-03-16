import { spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverRoot = dirname(__dirname);
const migrationsDir = join(serverRoot, 'prisma', 'migrations');
const tenantMigrationFile = join(migrationsDir, '20260305205931_tenant_isolation', 'migration.sql');
const defaultDatabaseUrl = process.env.RAILWAY_ENVIRONMENT
  ? 'file:/data/crm.db'
  : 'file:./prisma/dev.db';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = defaultDatabaseUrl;
  console.warn(`[startup] DATABASE_URL was missing. Fallback applied: ${process.env.DATABASE_URL}`);
}
if (typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('file:') && !process.env.DATABASE_URL.includes('connection_limit=')) {
  process.env.DATABASE_URL = `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=1`;
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: serverRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'pipe',
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
};

const resolveSqlitePath = () => {
  const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
  if (!dbUrl.startsWith('file:')) {
    throw new Error(`Unsupported DATABASE_URL for auto-baseline: ${dbUrl}`);
  }
  const raw = dbUrl.slice('file:'.length).split('?')[0].split('#')[0];
  if (raw.startsWith('/')) return raw;
  return join(serverRoot, raw.replace(/^\.\//, ''));
};

const ensureMigrationsTable = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);
};

const migrationIsMarkedApplied = (db, migrationName) => {
  const row = db
    .prepare('SELECT 1 AS ok FROM "_prisma_migrations" WHERE "migration_name" = ? LIMIT 1')
    .get(migrationName);
  return !!row?.ok;
};

const markMigrationAsApplied = (db, migrationName, sql) => {
  const checksum = createHash('sha256').update(sql).digest('hex');
  db.prepare(`
    INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
    VALUES
      (@id, @checksum, CURRENT_TIMESTAMP, @migration_name, '', NULL, CURRENT_TIMESTAMP, 1)
  `).run({
    id: randomUUID(),
    checksum,
    migration_name: migrationName,
  });
};

const autoBaselineIfNeeded = () => {
  const dbPath = resolveSqlitePath();
  const db = new Database(dbPath);
  try {
    const hasTenant = !!db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='Tenant' LIMIT 1`)
      .get();

    ensureMigrationsTable(db);
    if (!hasTenant) {
      const tenantMigrationName = '20260305205931_tenant_isolation';
      const tenantMigrationSql = readFileSync(tenantMigrationFile, 'utf-8');
      db.exec(tenantMigrationSql);
      if (!migrationIsMarkedApplied(db, tenantMigrationName)) {
        markMigrationAsApplied(db, tenantMigrationName, tenantMigrationSql);
      }
    }
  } finally {
    db.close();
  }
};

const runStart = () => {
  const generate = run('npx', ['prisma', 'generate']);
  if (generate.status !== 0) process.exit(generate.status || 1);

  let deploy = run('npx', ['prisma', 'migrate', 'deploy']);
  const output = `${deploy.stdout || ''}\n${deploy.stderr || ''}`;
  if (deploy.status !== 0 && output.includes('P3005')) {
    autoBaselineIfNeeded();
    deploy = run('npx', ['prisma', 'migrate', 'deploy']);
  }
  if (deploy.status !== 0) process.exit(deploy.status || 1);

  const seed = run('node', ['prisma/seed.js'], { env: { PRISMA_AUTO_BOOTSTRAP: '0' } });
  if (seed.status !== 0) process.exit(seed.status || 1);

  const server = spawnSync('node', ['server.js'], {
    cwd: serverRoot,
    env: { ...process.env, PRISMA_AUTO_BOOTSTRAP: '0' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(server.status || 0);
};

runStart();
