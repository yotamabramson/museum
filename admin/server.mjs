// Local-only admin for the museum DB. Not deployed. Run: npm run admin
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import { LEVELS, create, openDb, remove, reorder, root, slugify, tree, update } from '../scripts/db.mjs';
import { exportMuseum } from '../scripts/export.mjs';

const PORT = Number(process.env.PORT ?? 4000);
let db = openDb();
const dbFile = resolve(root, 'data/museum.db');
// Cancel restores the DB as it was when the editor opened (or when last baked) and removes images uploaded since.
const snapshot = resolve(tmpdir(), `museum-session-${process.pid}.db`);
let uploads = [];
const takeSnapshot = () => {
  copyFileSync(dbFile, snapshot);
  uploads = [];
};
takeSnapshot();

const shutdown = () => {
  rmSync(snapshot, { force: true });
  setTimeout(() => process.exit(0), 100);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
const page = resolve(root, 'admin/index.html');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

const readBody = (req) =>
  new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(readFileSync(page));
    }
    if (req.method === 'GET' && parts[0] === 'media' && parts.length === 2) {
      const file = resolve(root, 'media', basename(decodeURIComponent(parts[1])));
      try {
        const data = readFileSync(file);
        res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
        return res.end(data);
      } catch {
        return json(res, 404, { error: 'not found' });
      }
    }
    if (parts[0] !== 'api') return json(res, 404, { error: 'not found' });

    if (req.method === 'GET' && parts[1] === 'tree') return json(res, 200, tree(db));

    if (req.method === 'POST' && parts[1] === 'bake') {
      const counts = exportMuseum();
      takeSnapshot(); // the baked state is the new baseline for Cancel
      return json(res, 200, counts);
    }

    if (req.method === 'POST' && parts[1] === 'cancel') {
      db.close();
      copyFileSync(snapshot, dbFile);
      for (const f of uploads) rmSync(resolve(root, 'media', f), { force: true });
      json(res, 200, { ok: true, discardedUploads: uploads.length });
      return shutdown();
    }

    if (req.method === 'POST' && parts[1] === 'quit') {
      json(res, 200, { ok: true });
      return shutdown();
    }

    if (req.method === 'POST' && parts[1] === 'upload') {
      const name = slugify(basename(url.searchParams.get('name') ?? 'file').replace(/\.[^.]+$/, ''));
      const ext = (basename(url.searchParams.get('name') ?? '').match(/\.[a-z0-9]+$/i) ?? ['.bin'])[0].toLowerCase();
      mkdirSync(resolve(root, 'media'), { recursive: true });
      const file = `${name}-${Date.now().toString(36)}${ext}`;
      writeFileSync(resolve(root, 'media', file), await readBody(req));
      uploads.push(file);
      return json(res, 200, { path: `/media/${file}` });
    }

    const level = parts[1];
    if (!(level in LEVELS)) return json(res, 404, { error: 'unknown level' });
    const body = ['POST', 'PUT'].includes(req.method) ? JSON.parse((await readBody(req)).toString() || '{}') : {};

    if (req.method === 'POST' && parts[2] === 'reorder') return (reorder(db, level, body.ids), json(res, 200, { ok: true }));
    if (req.method === 'POST') return json(res, 200, { id: create(db, level, body) });
    if (req.method === 'PUT' && parts[2]) return (update(db, level, Number(parts[2]), body), json(res, 200, { ok: true }));
    if (req.method === 'DELETE' && parts[2]) return (remove(db, level, Number(parts[2])), json(res, 200, { ok: true }));
    return json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Museum admin: http://localhost:${PORT}`));
