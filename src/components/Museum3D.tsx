import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { wings } from '../data/museum';
import { ROOM_W, SPINE_HALF_D, WALL_H, WALL_T, buildLayout, type MuseumLayout, type PlacedRoom, type Placement } from '../lib/layout';
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

// ── Static shell ─────────────────────────────────────────────────────────────

interface Box {
  x: number; y: number; z: number; w: number; h: number; d: number;
  color?: THREE.Color;
}

function Boxes({ boxes, color, roughness = 0.9 }: { boxes: Box[]; color: string; roughness?: number }) {
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
    m.computeBoundingSphere();
  }, [boxes]);
  if (!boxes.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} frustumCulled={false}>
      <boxGeometry />
      <meshStandardMaterial color={color} roughness={roughness} />
    </instancedMesh>
  );
}

function Shell({ layout }: { layout: MuseumLayout }) {
  const { walls, rooms, spine } = layout;
  const wallBoxes = useMemo(() => walls.map((w) => ({ x: w.x, y: WALL_H / 2, z: w.z, w: w.w, h: WALL_H, d: w.d })), [walls]);
  const floors = useMemo(() => {
    const spineW = spine.x1 - spine.x0;
    const list: Box[] = [
      { x: (spine.x0 + spine.x1) / 2, y: -0.05, z: 0, w: spineW + 2 * WALL_T, h: 0.1, d: SPINE_HALF_D * 2 + 2 * WALL_T, color: new THREE.Color('#6b6055') },
    ];
    for (const r of rooms) {
      list.push({ x: r.cx, y: -0.05, z: r.cz, w: ROOM_W + 2 * WALL_T, h: 0.1, d: r.len + 2 * WALL_T, color: new THREE.Color().setHSL(hueOf(r.wing.slug), 0.18, 0.33) });
    }
    return list;
  }, [rooms, spine]);
  const ceilings = useMemo(
    () => floors.map((f) => ({ ...f, y: WALL_H + 0.05, color: undefined })),
    [floors],
  );
  return (
    <>
      <Boxes boxes={wallBoxes} color="#d8d0c4" />
      <Boxes boxes={floors} color="#ffffff" roughness={0.6} />
      <Boxes boxes={ceilings} color="#f2efe9" />
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
      t.anisotropy = 4;
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
  const iw = aspect >= 1.3 ? 1.9 : 1.9 * (aspect / 1.3);
  const ih = iw / aspect;
  const hue = hueOf(p.item.slug);
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
      <mesh
        ref={(m) => {
          if (!m) return;
          m.userData.placement = p;
          registry.add(m);
          return () => void registry.delete(m);
        }}
        position={[0, 0, 0.03]}
      >
        <boxGeometry args={[Math.max(iw, 1.2) + 0.2, Math.max(ih, 1.2) + 0.2, 0.06]} />
        <meshStandardMaterial color="#1b1712" roughness={0.6} />
      </mesh>
      {tex ? (
        <mesh position={[0, 0, 0.065]}>
          <planeGeometry args={[iw, ih]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, 0, 0.065]}>
            <planeGeometry args={[1.9, 1.4]} />
            <meshStandardMaterial color={new THREE.Color().setHSL(hue, 0.35, 0.3)} />
          </mesh>
          <Text position={[0, 0, 0.08]} fontSize={0.16} maxWidth={1.6} textAlign="center" anchorX="center" anchorY="middle" color="#f3ead8">
            {p.item.title}
          </Text>
        </>
      )}
      <Text position={[0, -1.02, 0.03]} fontSize={0.12} maxWidth={2.4} textAlign="center" anchorX="center" anchorY="top" color="#2b2620">
        {p.item.title}
      </Text>
      {p.item.year && (
        <Text position={[0, -1.24, 0.03]} fontSize={0.09} anchorX="center" anchorY="top" color="#6b6459">
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
      <Text position={[r.cx, 3.15, r.zEnd + 0.02]} fontSize={0.34} maxWidth={ROOM_W - 1} textAlign="center" anchorX="center" anchorY="middle" color="#3a342c">
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
  return null;
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
      <Canvas camera={{ fov: 70, near: 0.1, far: 80, position: [start.x, EYE, start.z] }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0a0d']} />
        <fog attach="fog" args={['#0b0a0d', 25, 75]} />
        <ambientLight intensity={1.1} />
        <hemisphereLight args={['#fff4e0', '#3a3026', 0.9]} />
        <directionalLight position={[3, 10, 4]} intensity={0.6} />
        <Shell layout={layout} />
        {layout.wings.map((w) => (
          <Text key={w.wing.slug} position={[w.cx, 3, -SPINE_HALF_D + 0.02]} fontSize={0.5} maxWidth={ROOM_W} textAlign="center" anchorX="center" anchorY="middle" color="#3a342c">
            {w.wing.title}
          </Text>
        ))}
        {layout.rooms.map((r) => (
          <RoomView key={`${r.wing.slug}/${r.room.slug}`} r={r} pos={pos} registry={registry} />
        ))}
        <Player layout={layout} input={input} pos={pos} registry={registry} start={start} paused={paused} onWhere={setWhere} onHover={onHover} />
      </Canvas>

      <div className="where">{where}</div>
      <div className="top-right"><a href="/">2D view</a></div>
      {(locked || touch) && !open && <div className="cross" />}

      {hover && !open && (
        <button className="hint" onClick={inspect}>
          {touch ? 'View' : <><kbd>E</kbd> / click</>} — {hover.item.title}
        </button>
      )}

      {!started && !open && (
        <div className="overlay" onClick={enter}>
          <div>
            <h1>Museum of Things I Made</h1>
            <p>{touch ? 'Left thumb walks, right thumb looks.' : <><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · mouse looks · <kbd>Shift</kbd> runs · <kbd>E</kbd> or click inspects · <kbd>Esc</kbd> releases the mouse</>}</p>
            {wings.length === 0 && <p>The museum is empty — add exhibits with <code>npm run admin</code>.</p>}
            <p><strong>{touch ? 'Tap' : 'Click'} to enter</strong></p>
          </div>
        </div>
      )}
      {started && !locked && !touch && !open && (
        <div className="overlay" onClick={enter}><div><p><strong>Click to continue</strong></p></div></div>
      )}

      {open && (
        <div className="detail-wrap" onClick={() => setOpen(null)}>
          <div className="detail" onClick={(e) => e.stopPropagation()}>
            <h2>{open.item.title}<span className="year">{open.item.year}</span></h2>
            <p><em>{open.item.summary}</em></p>
            {open.item.image && !/\.(mp4|webm|mov)$/i.test(open.item.image) && <img src={open.item.image} alt={open.item.title} />}
            {body.map((p, i) => <p key={i}>{p}</p>)}
            {open.item.links.map((l) => <div key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></div>)}
            <div className="actions">
              <a href={detailUrl!}>Open page</a>
              <a href="#close" onClick={(e) => (e.preventDefault(), setOpen(null))}>Close</a>
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
