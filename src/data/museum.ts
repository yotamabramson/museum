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
