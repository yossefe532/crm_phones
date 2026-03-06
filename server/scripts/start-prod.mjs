import { spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverRoot = dirname(__dirname);
const migrationsDir = join(serverRoot, 'prisma', 'migrations');
const tenantMigrationFile = join(migrationsDir, '20260305205931_tenant_isolation', 'migration.sql');

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
  const raw = dbUrl.slice('file:'.length);
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

const markAllMigrationsAsApplied = (db) => {
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const existing = new Set(
    db.prepare('SELECT migration_name FROM "_prisma_migrations"').all().map((row) => row.migration_name),
  );

  const insert = db.prepare(`
    INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
    VALUES
      (@id, @checksum, CURRENT_TIMESTAMP, @migration_name, '', NULL, CURRENT_TIMESTAMP, 1)
  `);

  for (const migrationName of migrationNames) {
    if (existing.has(migrationName)) continue;
    const sqlPath = join(migrationsDir, migrationName, 'migration.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    insert.run({
      id: randomUUID(),
      checksum,
      migration_name: migrationName,
    });
  }
};

const autoBaselineIfNeeded = () => {
  const dbPath = resolveSqlitePath();
  const db = new Database(dbPath);
  try {
    const hasTenant = !!db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='Tenant' LIMIT 1`)
      .get();

    if (!hasTenant) {
      const tenantMigrationSql = readFileSync(tenantMigrationFile, 'utf-8');
      db.exec(tenantMigrationSql);
    }

    ensureMigrationsTable(db);
    markAllMigrationsAsApplied(db);
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
