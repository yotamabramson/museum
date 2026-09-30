// Bakes the local DB into files Astro can build from:
//   src/data/museum.json  (the whole tree)
//   public/media/         (copy of ./media)
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, root, tree } from './db.mjs';

export function exportMuseum() {
  const db = openDb();
  const wings = tree(db).map((w) => ({
    slug: w.slug,
    title: w.title,
    description: w.description,
    rooms: w.rooms.map((r) => ({
      slug: r.slug,
      title: r.title,
      description: r.description,
      items: r.items.map((i) => ({
        slug: i.slug,
        title: i.title,
        year: i.year,
        summary: i.summary,
        body: i.body,
        image: i.image,
        links: i.links,
        tags: i.tags,
      })),
    })),
  }));

  mkdirSync(resolve(root, 'src/data'), { recursive: true });
  writeFileSync(resolve(root, 'src/data/museum.json'), JSON.stringify({ wings }, null, 2) + '\n');

  const out = resolve(root, 'public/media');
  rmSync(out, { recursive: true, force: true });
  if (existsSync(resolve(root, 'media'))) cpSync(resolve(root, 'media'), out, { recursive: true });

  const counts = {
    wings: wings.length,
    rooms: wings.reduce((n, w) => n + w.rooms.length, 0),
    items: wings.reduce((n, w) => n + w.rooms.reduce((m, r) => m + r.items.length, 0), 0),
  };
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Exported', exportMuseum());
}
