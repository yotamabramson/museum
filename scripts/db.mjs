import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function openDb() {
  mkdirSync(resolve(root, 'data'), { recursive: true });
  const db = new DatabaseSync(resolve(root, 'data/museum.db'));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(resolve(root, 'db/schema.sql'), 'utf8'));
  return db;
}

// The three levels of the museum. `parent` is the foreign key to the level above.
export const LEVELS = {
  wings: { parent: null, fields: ['title', 'description'] },
  rooms: { parent: 'wing_id', fields: ['title', 'description'] },
  items: {
    parent: 'room_id',
    fields: ['title', 'year', 'summary', 'body', 'image', 'links', 'tags'],
  },
};

export function slugify(text) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function uniqueSlug(db, table, parentCol, parentId, title) {
  const base = slugify(title);
  const taken = (s) =>
    parentCol
      ? db.prepare(`SELECT 1 FROM ${table} WHERE ${parentCol} = ? AND slug = ?`).get(parentId, s)
      : db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`).get(s);
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? []));

export function create(db, level, data) {
  const { parent, fields } = LEVELS[level];
  if (!data.title?.trim()) throw new Error('title is required');
  if (parent && !data[parent]) throw new Error(`${parent} is required`);
  const parentId = parent ? data[parent] : null;
  const slug = uniqueSlug(db, level, parent, parentId, data.title);
  const sortQ = parent
    ? db.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM ${level} WHERE ${parent} = ?`).get(parentId)
    : db.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM ${level}`).get();
  const cols = ['slug', 'sort', ...(parent ? [parent] : []), ...fields];
  const vals = [
    slug,
    sortQ.n,
    ...(parent ? [parentId] : []),
    ...fields.map((f) => (f === 'links' || f === 'tags' ? asText(data[f]) : (data[f] ?? ''))),
  ];
  const res = db
    .prepare(`INSERT INTO ${level} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...vals);
  return Number(res.lastInsertRowid);
}

export function update(db, level, id, data) {
  const { fields } = LEVELS[level];
  const present = fields.filter((f) => f in data);
  if (!present.length) return;
  db.prepare(`UPDATE ${level} SET ${present.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
    ...present.map((f) => (f === 'links' || f === 'tags' ? asText(data[f]) : data[f])),
    id,
  );
}

// Foreign keys cascade: deleting a wing removes its rooms and their items.
export function remove(db, level, id) {
  db.prepare(`DELETE FROM ${level} WHERE id = ?`).run(id);
}

export function reorder(db, level, ids) {
  const stmt = db.prepare(`UPDATE ${level} SET sort = ? WHERE id = ?`);
  ids.forEach((id, i) => stmt.run(i + 1, id));
}

export function tree(db) {
  const parse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return [];
    }
  };
  const wings = db.prepare('SELECT * FROM wings ORDER BY sort, id').all();
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort, id').all();
  const items = db.prepare('SELECT * FROM items ORDER BY sort, id').all();
  return wings.map((w) => ({
    ...w,
    rooms: rooms
      .filter((r) => r.wing_id === w.id)
      .map((r) => ({
        ...r,
        items: items
          .filter((i) => i.room_id === r.id)
          .map((i) => ({ ...i, links: parse(i.links), tags: parse(i.tags) })),
      })),
  }));
}
