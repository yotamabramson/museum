// Local-only admin for the museum DB. Not deployed. Run: npm run admin
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { LEVELS, create, openDb, remove, reorder, root, slugify, tree, update } from '../scripts/db.mjs';
import { exportMuseum } from '../scripts/export.mjs';

const PORT = Number(process.env.PORT ?? 4000);
const db = openDb();
const page = resolve(root, 'admin/index.html');

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
    if (parts[0] !== 'api') return json(res, 404, { error: 'not found' });

    if (req.method === 'GET' && parts[1] === 'tree') return json(res, 200, tree(db));

    if (req.method === 'POST' && parts[1] === 'publish') return json(res, 200, exportMuseum());

    if (req.method === 'POST' && parts[1] === 'upload') {
      const name = slugify(basename(url.searchParams.get('name') ?? 'file').replace(/\.[^.]+$/, ''));
      const ext = (basename(url.searchParams.get('name') ?? '').match(/\.[a-z0-9]+$/i) ?? ['.bin'])[0].toLowerCase();
      mkdirSync(resolve(root, 'media'), { recursive: true });
      const file = `${name}-${Date.now().toString(36)}${ext}`;
      writeFileSync(resolve(root, 'media', file), await readBody(req));
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
