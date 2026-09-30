import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Text } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { wings } from '../data/museum';
import { DOOR_H, DOOR_W, ROOM_W, SPINE_HALF_D, WALL_H, WALL_T, buildLayout, type MuseumLayout, type PlacedRoom, type Placement } from '../lib/layout';
import './Museum3D.css';

const EYE = 1.65;
const RADIUS = 0.35;
const WALK = 3.4;
const RUN = 6;
const REACH = 5; // how far you can inspect a picture
const PRELOAD = 16; // rooms within this distance of the player get their contents mounted

interface Input {
  keys: Set<string>;
  joy: { x: number; y: number };
  yaw: number;
  pitch: number;
}
type Registry = Set<THREE.Object3D>;

const idOf = (p: Placement) => `${p.wing.slug}/${p.room.slug}/${p.item.slug}`;
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7) / 360;

// ── Look & feel ──────────────────────────────────────────────────────────────

const FONT_SERIF = '/fonts/cormorant-garamond-latin-600-normal.woff';
const FONT_SANS = '/fonts/inter-latin-400-normal.woff';
const GOLD = '#c9a55c';
// Deep gallery wall colours, one per wing (cycling).
const PALETTE = ['#34504f', '#5e2f37', '#31446a', '#465331', '#54405f', '#634b33', '#2a5240', '#603f2e'];
const wallColor = (col: number) => new THREE.Color(col < 0 ? '#3d3833' : PALETTE[col % PALETTE.length]);

let woodTex: THREE.Texture | null = null;
function wood() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const planks = 8, pw = 512 / planks;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < planks; i++) {
    let y = 0;
    while (y < 512) {
      const len = Math.min(512 - y, 120 + rnd() * 260);
      g.fillStyle = `hsl(${22 + rnd() * 8} ${34 + rnd() * 12}% ${24 + rnd() * 8}%)`;
      g.fillRect(i * pw, y, pw, len);
      for (let k = 0; k < 16; k++) {
        g.strokeStyle = `rgba(${rnd() > 0.5 ? '0,0,0' : '255,220,170'},${0.03 + rnd() * 0.06})`;
        g.lineWidth = 0.6 + rnd();
        const x = i * pw + rnd() * pw;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + (rnd() - 0.5) * 8, y + len / 3, x + (rnd() - 0.5) * 8, y + (2 * len) / 3, x + (rnd() - 0.5) * 5, y + len);
        g.stroke();
      }
      y += len;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(i * pw, y - 1.5, pw, 1.5);
    }
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(i * pw, 0, 2, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return (woodTex = t);
}

let glowTex: THREE.Texture | null = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return (glowTex = new THREE.CanvasTexture(c));
}

// ── Static shell ─────────────────────────────────────────────────────────────

interface Box {
  x: number; y: number; z: number; w: number; h: number; d: number;
  color?: THREE.Color;
}

function Boxes({ boxes, children }: { boxes: Box[]; children: React.ReactNode }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = ref.current;
    const o = new THREE.Object3D();
    boxes.forEach((b, i) => {
      o.position.set(b.x, b.y, b.z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (b.color) m.setColorAt(i, b.color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [boxes]);
  if (!boxes.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} frustumCulled={false}>
      <boxGeometry />
      {children}
    </instancedMesh>
  );
}

interface Rect { x0: number; x1: number; z0: number; z1: number; color?: THREE.Color }

/** One merged horizontal surface from many rectangles; UVs are in world units so textures tile evenly. */
function surface(rects: Rect[], y: number, up: boolean, tile = 2) {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  rects.forEach((r, i) => {
    const b = i * 4;
    pos.push(r.x0, y, r.z0, r.x1, y, r.z0, r.x1, y, r.z1, r.x0, y, r.z1);
    uv.push(r.x0 / tile, r.z0 / tile, r.x1 / tile, r.z0 / tile, r.x1 / tile, r.z1 / tile, r.x0 / tile, r.z1 / tile);
    for (let k = 0; k < 4; k++) {
      nor.push(0, up ? 1 : -1, 0);
      col.push(r.color?.r ?? 1, r.color?.g ?? 1, r.color?.b ?? 1);
    }
    idx.push(...(up ? [b, b + 3, b + 2, b, b + 2, b + 1] : [b, b + 2, b + 3, b, b + 1, b + 2]));
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function Shell({ layout }: { layout: MuseumLayout }) {
  const { walls, lintels, lights, rooms, spine } = layout;

  const wallBoxes = useMemo<Box[]>(
    () => [
      ...walls.map((w) => ({ x: w.x, y: WALL_H / 2, z: w.z, w: w.w, h: WALL_H, d: w.d, color: wallColor(w.col) })),
      ...lintels.map((l) => ({
        x: l.x, y: DOOR_H + (WALL_H - DOOR_H) / 2, z: l.z, w: DOOR_W + 0.04, h: WALL_H - DOOR_H, d: WALL_T,
        color: wallColor(l.col),
      })),
    ],
    [walls, lintels],
  );
  const baseboards = useMemo<Box[]>(() => walls.map((w) => ({ x: w.x, y: 0.1, z: w.z, w: w.w + 0.08, h: 0.2, d: w.d + 0.08 })), [walls]);
  const crown = useMemo<Box[]>(() => walls.map((w) => ({ x: w.x, y: WALL_H - 0.07, z: w.z, w: w.w + 0.1, h: 0.14, d: w.d + 0.1 })), [walls]);
  const trim = useMemo<Box[]>(
    () =>
      lintels.flatMap((l) => [
        { x: l.x, y: DOOR_H - 0.03, z: l.z, w: DOOR_W + 0.1, h: 0.07, d: WALL_T + 0.06 },
        { x: l.x - DOOR_W / 2, y: DOOR_H / 2, z: l.z, w: 0.07, h: DOOR_H, d: WALL_T + 0.06 },
        { x: l.x + DOOR_W / 2, y: DOOR_H / 2, z: l.z, w: 0.07, h: DOOR_H, d: WALL_T + 0.06 },
      ]),
    [lintels],
  );
  const strips = useMemo<Box[]>(
    () => lights.map((l) => ({ x: l.x, y: WALL_H - 0.02, z: l.z, w: l.alongZ ? 0.2 : 2.4, h: 0.03, d: l.alongZ ? 2.4 : 0.2 })),
    [lights],
  );

  const { floor, ceiling } = useMemo(() => {
    const rects: Rect[] = [
      { x0: spine.x0 - WALL_T, x1: spine.x1 + WALL_T, z0: -SPINE_HALF_D - WALL_T, z1: SPINE_HALF_D + WALL_T, color: new THREE.Color('#9b8a78') },
      ...rooms.map((r) => ({
        x0: r.cx - ROOM_W / 2 - WALL_T, x1: r.cx + ROOM_W / 2 + WALL_T, z0: r.zEnd - WALL_T, z1: r.zStart,
        color: new THREE.Color('#ffffff').lerp(wallColor(layout.wings.findIndex((w) => w.wing === r.wing)), 0.25),
      })),
    ];
    return { floor: surface(rects, 0, true), ceiling: surface(rects, WALL_H, false) };
  }, [rooms, spine, layout.wings]);

  return (
    <>
      <Boxes boxes={wallBoxes}><meshStandardMaterial color="#ffffff" roughness={0.92} /></Boxes>
      <Boxes boxes={baseboards}><meshStandardMaterial color="#14110e" roughness={0.6} /></Boxes>
      <Boxes boxes={crown}><meshStandardMaterial color="#8f7a4e" roughness={0.5} metalness={0.4} /></Boxes>
      <Boxes boxes={trim}><meshStandardMaterial color={GOLD} roughness={0.35} metalness={0.85} /></Boxes>
      <Boxes boxes={strips}><meshBasicMaterial color={new THREE.Color('#fff0d0').multiplyScalar(3)} toneMapped={false} /></Boxes>
      <mesh geometry={floor}>
        <meshStandardMaterial map={wood()} vertexColors roughness={0.42} metalness={0.05} envMapIntensity={0.6} />
      </mesh>
      <mesh geometry={ceiling}>
        <meshStandardMaterial color="#4a433c" roughness={1} />
      </mesh>
    </>
  );
}

// ── Pictures ─────────────────────────────────────────────────────────────────

function Frame({ p, registry }: { p: Placement; registry: Registry }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!p.item.image || /\.(mp4|webm|mov)$/i.test(p.item.image)) return;
    let dead = false;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(p.item.image, (t) => {
      if (dead) return t.dispose();
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      loaded = t;
      setTex(t);
    });
    return () => {
      dead = true;
      loaded?.dispose();
      setTex(null);
    };
  }, [p.item.image]);

  const img = tex?.image as { width: number; height: number } | undefined;
  const aspect = img ? img.width / img.height : 4 / 3;
  // Fit the artwork inside a 2.3 × 1.7 box.
  const iw = Math.min(2.3, 1.7 * aspect);
  const ih = iw / aspect;
  const hue = hueOf(p.item.slug);
  const glowMap = glow();
  const plateY = -(ih / 2 + 0.18 + 0.46);
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
      {/* pool of light on the wall, and a soft shadow under the frame */}
      <mesh position={[0, 0.2, 0.006]} renderOrder={1}>
        <planeGeometry args={[iw + 2.6, ih + 2.4]} />
        <meshBasicMaterial map={glowMap} color="#ffd6a0" transparent opacity={0.26} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0.06, -0.08, 0.012]} renderOrder={2}>
        <planeGeometry args={[iw + 0.9, ih + 0.9]} />
        <meshBasicMaterial map={glowMap} color="#000000" transparent opacity={0.6} depthWrite={false} />
      </mesh>
      {/* gilded frame → cream mat → artwork */}
      <mesh
        ref={(m) => {
          if (!m) return;
          m.userData.placement = p;
          registry.add(m);
          return () => void registry.delete(m);
        }}
        position={[0, 0, 0.04]}
      >
        <boxGeometry args={[iw + 0.4, ih + 0.4, 0.08]} />
        <meshStandardMaterial color={GOLD} roughness={0.42} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[iw + 0.18, ih + 0.18, 0.08]} />
        <meshStandardMaterial color="#efe9dd" roughness={0.95} />
      </mesh>
      {tex ? (
        <mesh position={[0, 0, 0.092]}>
          <planeGeometry args={[iw, ih]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, 0, 0.092]}>
            <planeGeometry args={[iw, ih]} />
            <meshStandardMaterial color={new THREE.Color().setHSL(hue, 0.3, 0.3)} roughness={0.9} />
          </mesh>
          <Text font={FONT_SERIF} position={[0, 0, 0.1]} fontSize={0.2} maxWidth={iw - 0.3} textAlign="center" anchorX="center" anchorY="middle" color="#f3ead8">
            {p.item.title}
          </Text>
        </>
      )}
      {/* museum label */}
      <mesh position={[0, plateY, 0.015]}>
        <boxGeometry args={[1.9, 0.5, 0.03]} />
        <meshStandardMaterial color="#e9e2d3" roughness={0.8} />
      </mesh>
      <Text font={FONT_SERIF} position={[0, plateY + 0.1, 0.035]} fontSize={0.135} maxWidth={1.75} textAlign="center" anchorX="center" anchorY="middle" color="#1c1813">
        {p.item.title}
      </Text>
      {p.item.year && (
        <Text font={FONT_SANS} position={[0, plateY - 0.1, 0.035]} fontSize={0.07} letterSpacing={0.12} anchorX="center" anchorY="middle" color="#7a6d55">
          {p.item.year}
        </Text>
      )}
    </group>
  );
}

function RoomView({ r, pos, registry }: { r: PlacedRoom; pos: React.RefObject<{ x: number; z: number }>; registry: Registry }) {
  const [near, setNear] = useState(false);
  useFrame(() => {
    const dx = Math.max(0, Math.abs(pos.current.x - r.cx) - ROOM_W / 2);
    const dz = Math.max(0, r.zEnd - pos.current.z, pos.current.z - r.zStart);
    const n = Math.hypot(dx, dz) < PRELOAD;
    if (n !== near) setNear(n);
  });
  if (!near) return null;
  return (
    <>
      <Text font={FONT_SANS} position={[r.cx, 3.72, r.zEnd + 0.03]} fontSize={0.1} letterSpacing={0.3} anchorX="center" anchorY="middle" color={GOLD}>
        {r.wing.title.toUpperCase()}
      </Text>
      <Text font={FONT_SERIF} position={[r.cx, 3.42, r.zEnd + 0.03]} fontSize={0.34} maxWidth={ROOM_W - 1} textAlign="center" anchorX="center" anchorY="middle" color="#f1e9d8">
        {r.room.title}
      </Text>
      {r.placements.map((p) => (
        <Frame key={idOf(p)} p={p} registry={registry} />
      ))}
    </>
  );
}

// ── Player ───────────────────────────────────────────────────────────────────

function Player({
  layout, input, pos, registry, start, paused, onWhere, onHover,
}: {
  layout: MuseumLayout;
  input: React.RefObject<Input>;
  pos: React.RefObject<{ x: number; z: number }>;
  registry: Registry;
  start: { x: number; z: number };
  paused: boolean;
  onWhere: (s: string) => void;
  onHover: (p: Placement | null) => void;
}) {
  const { camera } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(undefined, undefined, 0, REACH), []);
  const t = useRef({ where: '', hover: '', acc: 0 });
  const lantern = useRef<THREE.PointLight>(null!);
  useLayoutEffect(() => {
    pos.current.x = start.x;
    pos.current.z = start.z;
  }, [start, pos]);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const inp = input.current;
    const p = pos.current;
    if (!paused) {
      const k = inp.keys;
      const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - inp.joy.y;
      const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + inp.joy.x;
      const len = Math.hypot(fwd, str);
      if (len > 0) {
        const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * Math.min(1, len);
        const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
        p.x += ((-s * fwd + c * str) / len) * speed * dt;
        p.z += ((-c * fwd - s * str) / len) * speed * dt;
      }
      // Push out of walls (circle vs axis-aligned box).
      for (const w of layout.walls) {
        const hx = w.w / 2, hz = w.d / 2;
        if (Math.abs(p.x - w.x) > hx + RADIUS || Math.abs(p.z - w.z) > hz + RADIUS) continue;
        const nx = Math.max(w.x - hx, Math.min(p.x, w.x + hx));
        const nz = Math.max(w.z - hz, Math.min(p.z, w.z + hz));
        const dx = p.x - nx, dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          p.x += (dx / d) * (RADIUS - d);
          p.z += (dz / d) * (RADIUS - d);
        } else {
          // Center is inside the box: leave through the nearest face.
          const ox = hx + RADIUS - Math.abs(p.x - w.x), oz = hz + RADIUS - Math.abs(p.z - w.z);
          if (ox < oz) p.x += Math.sign(p.x - w.x || 1) * ox;
          else p.z += Math.sign(p.z - w.z || 1) * oz;
        }
      }
    }
    camera.position.set(p.x, EYE, p.z);
    lantern.current.position.set(p.x, 3.4, p.z);
    camera.rotation.set(inp.pitch, inp.yaw, 0, 'YXZ');

    // Slow work: where am I, what am I looking at.
    t.current.acc += dt;
    if (t.current.acc < 0.1) return;
    t.current.acc = 0;
    const room = layout.rooms.find((r) => Math.abs(p.x - r.cx) <= ROOM_W / 2 && p.z <= r.zStart && p.z >= r.zEnd);
    const where = room ? `${room.wing.title} · ${room.room.title}` : p.z > -SPINE_HALF_D - WALL_T ? 'Main hall' : '';
    if (where && where !== t.current.where) {
      t.current.where = where;
      onWhere(where);
    }
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = ray.intersectObjects([...registry], false)[0];
    const placement = (hit?.object.userData.placement as Placement | undefined) ?? null;
    const id = placement ? idOf(placement) : '';
    if (id !== t.current.hover) {
      t.current.hover = id;
      onHover(placement);
    }
  });
  return <pointLight ref={lantern} color="#ffd9a8" intensity={7} distance={14} decay={2} />;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Museum3D() {
  const layout = useMemo(() => buildLayout(wings), []);
  const input = useRef<Input>({ keys: new Set(), joy: { x: 0, y: 0 }, yaw: 0, pitch: 0 });
  const pos = useRef({ x: 0, z: 0 });
  const registry = useRef<Registry>(new Set()).current;
  const hovered = useRef<Placement | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [where, setWhere] = useState('Main hall');
  const [hover, setHover] = useState<Placement | null>(null);
  const [open, setOpen] = useState<Placement | null>(null);
  const [touch, setTouch] = useState(false);
  const [start, setStart] = useState(layout.spawn);

  useEffect(() => {
    setTouch(matchMedia('(pointer: coarse)').matches);
    // Deep link: /walk/#wing/room/item stands you in front of that picture.
    const target = decodeURIComponent(location.hash.slice(1));
    const spot = target && layout.rooms.flatMap((r) => r.placements).find((p) => idOf(p) === target);
    if (spot) {
      input.current.yaw = spot.viewYaw;
      setStart({ x: spot.viewX, z: spot.viewZ, yaw: spot.viewYaw });
    } else {
      input.current.yaw = layout.spawn.yaw;
    }
  }, [layout]);

  const inspect = () => hovered.current && setOpen(hovered.current);
  const onHover = (p: Placement | null) => {
    hovered.current = p;
    setHover(p);
  };

  // Keyboard, mouse look, pointer lock.
  useEffect(() => {
    const inp = input.current;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' && document.pointerLockElement) inspect();
      if (e.code === 'Escape') setOpen(null);
      inp.keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => inp.keys.delete(e.code);
    const move = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      inp.yaw -= e.movementX * 0.0022;
      inp.pitch = Math.max(-1.2, Math.min(1.2, inp.pitch - e.movementY * 0.0022));
    };
    const lock = () => setLocked(!!document.pointerLockElement);
    const mousedown = () => document.pointerLockElement && inspect();
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('mousemove', move);
    addEventListener('mousedown', mousedown);
    document.addEventListener('pointerlockchange', lock);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('mousemove', move);
      removeEventListener('mousedown', mousedown);
      document.removeEventListener('pointerlockchange', lock);
    };
  }, []);

  useEffect(() => {
    if (open) document.exitPointerLock?.();
  }, [open]);

  const enter = () => {
    setStarted(true);
    if (!touch) root.current?.requestPointerLock();
  };

  // Touch: left area is a joystick, right area drags to look.
  const stickOrigin = useRef<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const lastLook = useRef<{ x: number; y: number } | null>(null);

  const paused = !!open || (!touch && !locked);
  const detailUrl = open && `/${open.wing.slug}/${open.room.slug}/${open.item.slug}/`;
  const body = open?.item.body.split(/\n{2,}/).filter(Boolean) ?? [];

  return (
    <div className="m3d" ref={root}>
      <Canvas camera={{ fov: 68, near: 0.1, far: 80, position: [start.x, EYE, start.z] }} dpr={[1, 2]} gl={{ antialias: false }}>
        <color attach="background" args={['#0a0807']} />
        <fog attach="fog" args={['#0a0807', 16, 62]} />
        <ambientLight intensity={0.5} color="#ffe8cc" />
        <hemisphereLight args={['#ffe9c8', '#3a2c20', 0.65]} />
        <Environment resolution={64} environmentIntensity={0.55}>
          <Lightformer form="rect" intensity={2.2} color="#ffe2b8" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
          <Lightformer form="rect" intensity={1} color="#ffcf9a" position={[-6, 2, 0]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} />
          <Lightformer form="rect" intensity={1} color="#ffcf9a" position={[6, 2, 0]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
        </Environment>
        <Shell layout={layout} />
        {layout.wings.map((w, col) => (
          <group key={w.wing.slug} position={[w.cx, 3.5, -SPINE_HALF_D + 0.03]}>
            <Text font={FONT_SANS} position={[0, 0.3, 0]} fontSize={0.1} letterSpacing={0.34} anchorX="center" anchorY="middle" color={GOLD}>
              WING {String(col + 1).padStart(2, '0')}
            </Text>
            <Text font={FONT_SERIF} position={[0, -0.02, 0]} fontSize={0.44} maxWidth={DOOR_W + 1.5} textAlign="center" anchorX="center" anchorY="middle" color="#f6efe0">
              {w.wing.title}
            </Text>
          </group>
        ))}
        {layout.rooms.map((r) => (
          <RoomView key={`${r.wing.slug}/${r.room.slug}`} r={r} pos={pos} registry={registry} />
        ))}
        <Player layout={layout} input={input} pos={pos} registry={registry} start={start} paused={paused} onWhere={setWhere} onHover={onHover} />
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.7} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette offset={0.3} darkness={0.65} />
        </EffectComposer>
      </Canvas>

      <div className="where">{where}</div>
      <a className="back" href="/" data-astro-reload>← 2D view</a>
      {(locked || touch) && !open && <div className="cross" />}

      {hover && !open && (
        <button className="hint" onClick={inspect}>
          {touch ? 'View' : <kbd>E</kbd>}
          <span>{hover.item.title}</span>
        </button>
      )}

      {!started && !open && (
        <div className="overlay" onClick={enter}>
          <div className="intro">
            <div className="eyebrow">A private collection</div>
            <h1>Museum of <em>Things</em> I Made</h1>
            {wings.length === 0 && <p>The museum is empty — add exhibits with <code>npm run admin</code>.</p>}
            <button className="enter">{touch ? 'Tap to enter' : 'Click to enter'}</button>
            <p className="keys">
              {touch ? 'Left thumb walks · right thumb looks' : <><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · mouse looks · <kbd>Shift</kbd> runs · <kbd>E</kbd> or click inspects · <kbd>Esc</kbd> frees the mouse</>}
            </p>
          </div>
        </div>
      )}
      {started && !locked && !touch && !open && (
        <div className="overlay" onClick={enter}><div className="intro"><button className="enter">Click to continue</button></div></div>
      )}

      {open && (
        <div className="detail-wrap" onClick={() => setOpen(null)}>
          <div className="detail" onClick={(e) => e.stopPropagation()}>
            {open.item.image && !/\.(mp4|webm|mov)$/i.test(open.item.image) && (
              <div className="detail-pic"><img src={open.item.image} alt={open.item.title} /></div>
            )}
            <div className="detail-text">
              <div className="eyebrow">{open.wing.title} · {open.room.title}</div>
              <h2>{open.item.title}</h2>
              {open.item.year && <div className="year">{open.item.year}</div>}
              {open.item.summary && <p className="summary">{open.item.summary}</p>}
              {body.map((p, i) => <p key={i}>{p}</p>)}
              <div className="actions">
                <a className="btn solid" href={detailUrl!}>Open page</a>
                {open.item.links.map((l) => <a key={l.url} className="btn" href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}
                <button className="btn" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {touch && started && !open && (
        <>
          <div
            className="stick"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); stickOrigin.current = { x: e.clientX, y: e.clientY }; setKnob({ x: e.clientX, y: e.clientY }); }}
            onPointerMove={(e) => {
              const o = stickOrigin.current; if (!o) return;
              const dx = e.clientX - o.x, dy = e.clientY - o.y, m = Math.min(1, Math.hypot(dx, dy) / 60);
              const a = Math.atan2(dy, dx);
              input.current.joy = { x: Math.cos(a) * m, y: Math.sin(a) * m };
            }}
            onPointerUp={() => { stickOrigin.current = null; input.current.joy = { x: 0, y: 0 }; setKnob(null); }}
            onPointerCancel={() => { stickOrigin.current = null; input.current.joy = { x: 0, y: 0 }; setKnob(null); }}
          />
          {knob && <div className="knob" style={{ left: knob.x, top: knob.y }} />}
          <div
            className="look"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); lastLook.current = { x: e.clientX, y: e.clientY }; }}
            onPointerMove={(e) => {
              const l = lastLook.current; if (!l) return;
              input.current.yaw -= (e.clientX - l.x) * 0.005;
              input.current.pitch = Math.max(-1.2, Math.min(1.2, input.current.pitch - (e.clientY - l.y) * 0.005));
              lastLook.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (lastLook.current = null)}
            onPointerCancel={() => (lastLook.current = null)}
          />
        </>
      )}
    </div>
  );
}
