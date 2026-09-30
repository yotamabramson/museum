// Adds a tiny sample museum so there is something to look at. Safe to re-run: skips if data exists.
import { create, openDb } from './db.mjs';

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM wings').get().n > 0) {
  console.log('DB already has data; not seeding.');
} else {
  const w = create(db, 'wings', { title: 'Web', description: 'Things that lived in a browser.' });
  const r = create(db, 'rooms', { wing_id: w, title: 'Early Days', description: 'Where it started.' });
  create(db, 'items', {
    room_id: r,
    title: 'Sample Exhibit',
    year: '2005',
    summary: 'A placeholder exhibit.',
    body: 'Replace me with something real via `npm run admin`.',
    tags: ['sample'],
    links: [{ label: 'Astro', url: 'https://astro.build' }],
  });
  console.log('Seeded sample museum.');
}
