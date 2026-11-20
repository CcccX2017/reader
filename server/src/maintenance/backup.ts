import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {readMediaStorageIdentity,isMediaStorageActivated} from '../media/storage-identity.ts';

const MANIFEST = 'reader-backup.json';
const INCOMPLETE = '.reader-backup-incomplete';
/** Directory names produced by the admin snapshot. Anything else under backups/ is ignored. */
export const BACKUP_ID = /^reader-\d{8}T\d{6}Z-[a-z0-9]{6}$/;
const LIVE_SKIP = new Set(['backups', 'reader.db', 'reader.db-wal', 'reader.db-shm', 'media.db', 'media.db-wal', 'media.db-shm']);
interface Entry { path: string; kind: 'file' | 'directory' | 'link'; size?: number; sha256?: string; target?: string }
export interface BackupManifest { format: 'reader-data-backup'; version: 1; createdAt: string; entries: Entry[] }

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(root: string, rel = '', skip: ReadonlySet<string> = new Set()): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const name of (await readdir(join(root, rel))).sort()) {
    // SQLite rebuilds shared memory from the database/WAL. Reader locks in this
    // file can change even during a read-only integrity check.
    if (!rel && (skip.has(name) || name === MANIFEST || name === INCOMPLETE || name === 'reader.db-shm' || name === 'media.db-shm')) continue;
    const path = rel ? `${rel}/${name}` : name;
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await readlink(absolute);
      if (isAbsolute(target) || !inside(root, resolve(dirname(absolute), target)) || !inside(root, await realpath(absolute))) {
        throw new Error(`不支持指向数据目录外的符号链接：${path}`);
      }
      entries.push({ path, kind: 'link', target });
    } else if (stat.isDirectory()) {
      entries.push({ path, kind: 'directory' });
      entries.push(...await inventory(root, path, skip));
    } else if (stat.isFile()) {
      entries.push({ path, kind: 'file', size: stat.size, sha256: await digest(absolute) });
    } else {
      throw new Error(`数据目录包含不支持的文件类型：${path}`);
    }
  }
  return entries;
}

function checkDatabase(root: string): void {
  // Read the existing schema without running migrations or creating a database.
  const db = new DatabaseSync(join(root, 'reader.db'), { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('SQLite 完整性校验失败');
    if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('SQLite 外键完整性校验失败');
    for (const table of ['users', 'books', 'reading_progress', 'notes']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        throw new Error(`不是当前 reader 数据库：缺少 ${table}`);
      }
    }
    const mediaPath=join(root,'media.db'),identity=readMediaStorageIdentity(db);
    if(isMediaStorageActivated(db)&&!existsSync(mediaPath))throw new Error('已启用的影音数据库缺失，请恢复完整配对备份');
    if(existsSync(mediaPath)){
      const media=new DatabaseSync(mediaPath,{readOnly:true});
      try{
        const rows=media.prepare('PRAGMA integrity_check').all();
        if(rows.length!==1||rows[0]?.integrity_check!=='ok')throw new Error('影音 SQLite 完整性校验失败');
        if(media.prepare('PRAGMA foreign_key_check').get())throw new Error('影音 SQLite 外键完整性校验失败');
        const marker=media.prepare('SELECT version,source_id FROM media_storage_migration WHERE id=1').get();
        if(marker?.version!==2||!identity||marker.source_id!==identity)throw new Error('影音数据库与阅读数据库身份不匹配，请先完成迁移升级');
      }finally{media.close();}
    }
  } finally { db.close(); }
}

async function newDestination(source: string, destination: string): Promise<string> {
  const parent = await realpath(dirname(resolve(destination)));
  const target = join(parent, relative(dirname(resolve(destination)), resolve(destination)));
  if (inside(source, target) || inside(target, source)) throw new Error('备份/恢复目录不能与源目录重叠');
  // Exclusive creation: never merge into or overwrite existing user data.
  await mkdir(target, { mode: 0o700 });
  await writeFile(join(target, INCOMPLETE), '操作未完成，请勿用此目录启动服务。\n', { flag: 'wx', mode: 0o600 });
  return target;
}

async function copyEntries(source: string, target: string, entries: Entry[]): Promise<void> {
  for (const entry of entries) {
    const from = join(source, entry.path), to = join(target, entry.path);
    if (entry.kind === 'directory') await mkdir(to, { mode: 0o700 });
    else if (entry.kind === 'file') {
      await copyFile(from, to);
      // Preserve plugin executables without making credentials world-readable.
      await chmod(to, (await lstat(from)).mode & 0o700);
    }
  }
  // Create links last, after all their targets, and never traverse them while copying.
  for (const entry of entries.filter(value => value.kind === 'link')) {
    await symlink(entry.target!, join(target, entry.path), 'file');
  }
}

/** Offline only: stop every server/plugin process using DATA_DIR before calling. */
export async function createBackup(dataDir: string, destination: string): Promise<BackupManifest> {
  const source = await realpath(dataDir);
  if ((await readdir(source)).some(name => name === INCOMPLETE || name === MANIFEST)) {
    throw new Error('源目录是备份或未完成操作目录，不能作为运行数据目录备份');
  }
  checkDatabase(source);
  const entries = await inventory(source);
  const target = await newDestination(source, destination);
  await copyEntries(source, target, entries);
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(entries) ||
      JSON.stringify(await inventory(target)) !== JSON.stringify(entries)) {
    throw new Error('复制期间数据发生变化或校验失败；请停止服务后重新备份到新目录');
  }
  checkDatabase(target);
  const manifest: BackupManifest = { format: 'reader-data-backup', version: 1, createdAt: new Date().toISOString(), entries };
  await writeFile(join(target, MANIFEST), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  await unlink(join(target, INCOMPLETE));
  return manifest;
}

export async function verifyBackup(directory: string): Promise<BackupManifest> {
  const source = await realpath(directory);
  if ((await readdir(source)).includes(INCOMPLETE)) throw new Error('备份未完成，拒绝恢复');
  const manifest = JSON.parse(await readFile(join(source, MANIFEST), 'utf8')) as BackupManifest;
  if (manifest.format !== 'reader-data-backup' || manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error('不支持的备份格式');
  }
  // Rebuild from actual files, not manifest paths: a modified manifest cannot
  // instruct restore to write outside the new data directory.
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(manifest.entries)) {
    throw new Error('备份文件校验失败：文件缺失、多余或内容已改变');
  }
  checkDatabase(source);
  return manifest;
}

/** Restore to a new directory; switching the deployed DATA_DIR remains explicit. */
export async function restoreBackup(directory: string, destination: string): Promise<BackupManifest> {
  const source = await realpath(directory);
  const manifest = await verifyBackup(source);
  const target = await newDestination(source, destination);
  await copyEntries(source, target, manifest.entries);
  if (JSON.stringify(await inventory(target)) !== JSON.stringify(manifest.entries)) throw new Error('恢复后文件校验失败');
  checkDatabase(target);
  await unlink(join(target, INCOMPLETE));
  return manifest;
}

function quoteSqlPath(path: string): string {
  return `'${path.replaceAll('\\', '/').replaceAll("'", "''")}'`;
}

/** Consistent copy of one live database. The caller's connection can stay open. */
function snapshotDatabase(source: string, destination: string): void {
  const db = new DatabaseSync(source);
  try { db.exec(`VACUUM INTO ${quoteSqlPath(destination)}`); }
  finally { db.close(); }
}

export interface RunningBackup { id: string; createdAt: string; bytes: number }

/**
 * Snapshot DATA_DIR while the server is running.
 *
 * The two databases are copied with SQLite `VACUUM INTO`, so a commit that
 * lands after the snapshot is not included and the live WAL is not copied.
 * Everything else is file-copied, except `backups/` itself: snapshots live
 * there, and packing them again would nest every previous copy.
 */
export async function createRunningBackup(dataDir: string): Promise<RunningBackup> {
  const source = await realpath(dataDir);
  if ((await readdir(source)).some(name => name === INCOMPLETE || name === MANIFEST)) {
    throw new Error('源目录是备份或未完成操作目录，不能作为运行数据目录备份');
  }
  if (!existsSync(join(source, 'reader.db'))) throw new Error('阅读数据库不存在');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const id = `reader-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const target = join(source, 'backups', id);
  await mkdir(join(source, 'backups'), { recursive: true, mode: 0o700 });
  await mkdir(target, { mode: 0o700 });
  await writeFile(join(target, INCOMPLETE), '操作未完成，请勿用此目录启动服务。\n', { flag: 'wx', mode: 0o600 });
  snapshotDatabase(join(source, 'reader.db'), join(target, 'reader.db'));
  await chmod(join(target, 'reader.db'), 0o600);
  if (existsSync(join(source, 'media.db'))) {
    snapshotDatabase(join(source, 'media.db'), join(target, 'media.db'));
    await chmod(join(target, 'media.db'), 0o600);
  }
  await copyEntries(source, target, await inventory(source, '', LIVE_SKIP));
  checkDatabase(target);
  const entries = await inventory(target);
  const manifest: BackupManifest = { format: 'reader-data-backup', version: 1, createdAt: new Date().toISOString(), entries };
  await writeFile(join(target, MANIFEST), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  await unlink(join(target, INCOMPLETE));
  return { id, createdAt: manifest.createdAt, bytes: entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) };
}

export async function listRunningBackups(dataDir: string): Promise<RunningBackup[]> {
  const dir = join(await realpath(dataDir), 'backups');
  if (!existsSync(dir)) return [];
  const items: RunningBackup[] = [];
  for (const name of await readdir(dir)) {
    if (!BACKUP_ID.test(name)) continue;
    const path = join(dir, name);
    try {
      if ((await readdir(path)).includes(INCOMPLETE)) continue;
      const manifest = JSON.parse(await readFile(join(path, MANIFEST), 'utf8')) as BackupManifest;
      if (manifest.format !== 'reader-data-backup' || !Array.isArray(manifest.entries)) continue;
      items.push({
        id: name,
        createdAt: manifest.createdAt,
        bytes: manifest.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
      });
    } catch { /* a half-written directory is not a backup */ }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Replace the live data directory with one snapshot.
 *
 * Callers must already have closed every database handle: SQLite keeps the
 * files locked, and a rename would fail. The previous files move under
 * `backups/.rollback-*` before the snapshot is copied in, and move back if
 * the copy does not verify. `backups/` itself stays put.
 */
export async function replaceDataDir(dataDir: string, id: string): Promise<void> {
  if (!BACKUP_ID.test(id)) throw new Error('未知备份');
  const source = await realpath(dataDir);
  let backup: string;
  try { backup = await realpath(join(source, 'backups', id)); }
  catch { throw new Error('未知备份'); }
  if (!inside(join(source, 'backups'), backup)) throw new Error('未知备份');
  const manifest = await verifyBackup(backup);
  const rollback = join(source, 'backups', `.rollback-${id}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(rollback, { mode: 0o700 });
  const moved: string[] = [];
  try {
    for (const name of await readdir(source)) {
      if (name === 'backups') continue;
      await rename(join(source, name), join(rollback, name));
      moved.push(name);
    }
    await copyEntries(backup, source, manifest.entries);
    if (JSON.stringify(await inventory(source, '', new Set(['backups']))) !== JSON.stringify(manifest.entries)) {
      throw new Error('恢复后文件校验失败');
    }
    checkDatabase(source);
  } catch (error) {
    for (const name of await readdir(source)) {
      if (name !== 'backups') await rm(join(source, name), { recursive: true, force: true });
    }
    for (const name of moved) await rename(join(rollback, name), join(source, name));
    throw error;
  }
}
