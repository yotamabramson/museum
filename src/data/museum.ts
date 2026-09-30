import raw from './museum.json';

export interface Item {
  slug: string;
  title: string;
  year: string;
  summary: string;
  body: string;
  image: string;
  links: { label: string; url: string }[];
  tags: string[];
}
export interface Room {
  slug: string;
  title: string;
  description: string;
  items: Item[];
}
export interface Wing {
  slug: string;
  title: string;
  description: string;
  rooms: Room[];
}

export const wings = (raw as { wings: Wing[] }).wings;

export const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
/** CSS background for something with no picture: a deep tinted gradient. */
export const tint = (seed: string) =>
  `linear-gradient(135deg, hsl(${hueOf(seed)} 35% 26%), hsl(${(hueOf(seed) + 40) % 360} 30% 14%))`;
const isVideo = (s: string) => /\.(mp4|webm|mov)$/i.test(s);
export const pictureOf = (i: Item) => (i.image && !isVideo(i.image) ? i.image : '');
export const roomCover = (r: Room) => r.items.map(pictureOf).find(Boolean) ?? '';
export const wingCover = (w: Wing) => w.rooms.map(roomCover).find(Boolean) ?? '';
export const bg = (cover: string, seed: string) => (cover ? `url(${cover}) center/cover` : tint(seed));
export const itemCount = (w: Wing) => w.rooms.reduce((n, r) => n + r.items.length, 0);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
