// Turns the wings → rooms → items tree into 3D geometry. Pure and deterministic, no React/Three.
//
// Plan view (x → right, z ↓ toward the viewer, so wings run "north" into -z):
//
//        wing A      wing B      wing C
//        ┌────┐      ┌────┐      ┌────┐
//        │room│      │room│      │room│      rooms are chained through doorways
//        ├─ ──┤      ├─ ──┤      ├─ ──┤
//   ┌────┴─ ──┴──────┴─ ──┴──────┴─ ──┴────┐
//   │                 spine                 │
//   └───────────────────────────────────────┘
import type { Item, Room, Wing } from '../data/museum';

export const ROOM_W = 8; // inner width of a room (x)
export const WALL_T = 0.3; // wall thickness
export const WALL_H = 4;
export const DOOR_W = 3.2;
export const WING_SPACING = 14; // x distance between wing centers
export const SPINE_HALF_D = 4; // spine spans z ∈ [-4, 4]
export const ITEM_SPACING = 3.2; // distance between items along a wall
const MIN_ROOM_LEN = 8;
const END_PAD = 1;

export const DOOR_H = 3; // doorways are this tall; a lintel fills the wall above

export interface Wall {
  x: number; // center
  z: number;
  w: number; // size along x
  d: number; // size along z
  /** Index of the (non-empty) wing this wall belongs to, or -1 for the main hall. */
  col: number;
}

export interface Lintel {
  x: number;
  z: number;
  col: number;
}

export interface CeilingLight {
  x: number;
  z: number;
  alongZ: boolean;
}

export interface Placement {
  wing: Wing;
  room: Room;
  item: Item;
  /** Hanging point on the wall surface. */
  x: number;
  y: number;
  z: number;
  /** Rotation about Y so the picture faces into the room. */
  rotY: number;
  /** Where to stand to look at it, and the yaw that faces it. */
  viewX: number;
  viewZ: number;
  viewYaw: number;
}

export interface PlacedRoom {
  wing: Wing;
  room: Room;
  wingIndex: number;
  roomIndex: number;
  cx: number;
  cz: number; // center
  len: number; // inner length (z)
  zStart: number; // z of the entry side (larger z)
  zEnd: number; // z of the far side (smaller z)
  placements: Placement[];
}

export interface PlacedWing {
  wing: Wing;
  cx: number;
}

export interface MuseumLayout {
  walls: Wall[];
  lintels: Lintel[];
  lights: CeilingLight[];
  rooms: PlacedRoom[];
  wings: PlacedWing[];
  spine: { x0: number; x1: number; z0: number; z1: number };
  spawn: { x: number; z: number; yaw: number };
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

/** A wall from `a` to `b` along x at depth z, with a doorway gap centered on each x in `gaps`. */
function wallAlongX(z: number, x0: number, x1: number, gaps: number[], col: number): Wall[] {
  const cuts = [...gaps].sort((a, b) => a - b);
  const out: Wall[] = [];
  let cursor = x0;
  for (const g of cuts) {
    const gs = g - DOOR_W / 2;
    if (gs > cursor) out.push({ x: (cursor + gs) / 2, z, w: gs - cursor, d: WALL_T, col });
    cursor = g + DOOR_W / 2;
  }
  if (x1 > cursor) out.push({ x: (cursor + x1) / 2, z, w: x1 - cursor, d: WALL_T, col });
  return out;
}

export function buildLayout(wings: Wing[]): MuseumLayout {
  const walls: Wall[] = [];
  const lintels: Lintel[] = [];
  const lights: CeilingLight[] = [];
  const rooms: PlacedRoom[] = [];
  const placedWings: PlacedWing[] = [];

  const occupied = wings.map((wing, wingIndex) => ({ wing, wingIndex })).filter((w) => w.wing.rooms.length > 0);
  const wingXs = occupied.map((_, i) => i * WING_SPACING);

  // Spine
  const x0 = -WING_SPACING / 2;
  const x1 = Math.max(0, (occupied.length - 1) * WING_SPACING) + WING_SPACING / 2;
  const spine = { x0, x1, z0: -SPINE_HALF_D, z1: SPINE_HALF_D };
  walls.push(...wallAlongX(SPINE_HALF_D + WALL_T / 2, x0 - WALL_T, x1 + WALL_T, [], -1)); // south, solid
  walls.push(...wallAlongX(-SPINE_HALF_D - WALL_T / 2, x0 - WALL_T, x1 + WALL_T, wingXs, -1)); // north, doorways
  const capD = SPINE_HALF_D * 2 + WALL_T * 2;
  walls.push({ x: x0 - WALL_T / 2, z: 0, w: WALL_T, d: capD, col: -1 });
  walls.push({ x: x1 + WALL_T / 2, z: 0, w: WALL_T, d: capD, col: -1 });
  wingXs.forEach((x, col) => lintels.push({ x, z: -SPINE_HALF_D - WALL_T / 2, col }));
  for (let x = x0 + 4; x < x1; x += 7) lights.push({ x, z: 0, alongZ: false });

  occupied.forEach(({ wing, wingIndex }, col) => {
    const cx = wingXs[col];
    placedWings.push({ wing, cx });
    let zStart = -SPINE_HALF_D - WALL_T; // first room starts beyond the spine's north wall

    wing.rooms.forEach((room, roomIndex) => {
      const perSide = Math.ceil(room.items.length / 2);
      const len = Math.max(MIN_ROOM_LEN, perSide * ITEM_SPACING + END_PAD * 2);
      const zEnd = zStart - len;
      const cz = (zStart + zEnd) / 2;

      // Side walls
      const half = ROOM_W / 2;
      walls.push({ x: cx - half - WALL_T / 2, z: cz, w: WALL_T, d: len + WALL_T, col });
      walls.push({ x: cx + half + WALL_T / 2, z: cz, w: WALL_T, d: len + WALL_T, col });
      // Far wall: doorway into the next room, solid at the end of the wing.
      const last = roomIndex === wing.rooms.length - 1;
      walls.push(...wallAlongX(zEnd - WALL_T / 2, cx - half - WALL_T, cx + half + WALL_T, last ? [] : [cx], col));
      if (!last) lintels.push({ x: cx, z: zEnd - WALL_T / 2, col });
      for (let z = zStart - 2; z > zEnd + 1; z -= 4) lights.push({ x: cx, z, alongZ: true });

      // Items hang alternately on the left (+x facing) and right (-x facing) walls.
      const margin = (len - perSide * ITEM_SPACING) / 2;
      const placements: Placement[] = room.items.map((item, k) => {
        const left = k % 2 === 0;
        const row = Math.floor(k / 2);
        const z = zStart - margin - (row + 0.5) * ITEM_SPACING;
        const wallX = left ? cx - half : cx + half;
        const nx = left ? 1 : -1; // wall normal, pointing into the room
        return {
          wing,
          room,
          item,
          x: wallX + nx * 0.02,
          y: 1.7,
          z,
          rotY: left ? Math.PI / 2 : -Math.PI / 2,
          viewX: wallX + nx * 3.1,
          viewZ: z,
          // Camera forward is -z at yaw 0 and yaw turns counter-clockwise seen from above,
          // so looking at the left wall (toward -x) is +π/2 and at the right wall (+x) is -π/2 — equal to rotY.
          viewYaw: left ? Math.PI / 2 : -Math.PI / 2,
        };
      });

      rooms.push({ wing, room, wingIndex, roomIndex, cx, cz, len, zStart, zEnd, placements });
      zStart = zEnd - WALL_T; // next room begins past this room's far wall
    });
  });

  const spawn = { x: 0, z: SPINE_HALF_D - 1.2, yaw: 0 };
  const zMin = rooms.reduce((m, r) => Math.min(m, r.zEnd), -SPINE_HALF_D) - 2;
  return { walls, lintels, lights, rooms, wings: placedWings, spine, spawn, bounds: { x0: x0 - 2, x1: x1 + 2, z0: zMin, z1: SPINE_HALF_D + 2 } };
}
