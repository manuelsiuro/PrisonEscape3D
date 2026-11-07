import * as THREE from 'three';
import { DECOR, type DecorKind } from '../../../src/content/decor';
import { GANG_COLOR } from '../../../src/content/gangs';
import { ITEMS, itemNumber, type ItemDef } from '../../../src/content/items';
import { PROPS, type PropKind } from '../../../src/content/props';
import { en } from '../../../src/i18n/en';
import { fr } from '../../../src/i18n/fr';
import { DOING } from '../../../src/sim/systems/inmates';
import { TILE } from '../../../src/sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../../../src/sim/world/World';
import type { OutsideWorld } from '../../../src/sim/hunt/world';
import { bedDummyMesh } from '../../../src/render/BedDummy';
import { Character, TRAY_AT } from '../../../src/render/Character';
import { decorGeometry } from '../../../src/render/decor';
import { DELIVERY_MODELS } from '../../../src/render/Delivery';
import { Dogs } from '../../../src/render/Dog';
import { diceTexture } from '../../../src/render/Games';
import { keeperGeometry, wingGeometry } from '../../../src/render/Getaway';
import {
  barbecue,
  basket as holidayBasket,
  BRIGHT,
  garland,
  hoseReel,
  lantern as holidayLantern,
  LIGHTS,
  snowman,
  tree as holidayTree,
} from '../../../src/render/holidayModels';
import { heliModel, vanGeometry, vehicleGeometry } from '../../../src/render/huntModels';
import { buildHouses } from '../../../src/render/huntTown';
import { ITEM_SHAPES, itemGeometry } from '../../../src/render/itemModels';
import { kioskBodyParts, kioskHeadParts } from '../../../src/render/Kiosk';
import { box, cyl, disc, kitMaterial, merge, paint, rod, type Part } from '../../../src/render/kit';
import { cropGeometry, lapTrackGeometry, plantGeometry } from '../../../src/render/Long';
import { type Look } from '../../../src/render/look';
import { oddJobsBoardParts, ODD_JOBS_CARDS, oddJobsCardParts, oddJobsTagParts } from '../../../src/render/OddJobs';
import { ballTexture, boardTexture, cardGeometry, cardTexture } from '../../../src/render/Pastimes';
import { carParts, phoneParts } from '../../../src/render/Phone';
import { lampParts, lanternParts, propGeometry } from '../../../src/render/props';
import { bodyGeometry as ratBodyGeometry, tailGeometry as ratTailGeometry } from '../../../src/render/Rat';
import { releaseDeskParts } from '../../../src/render/Release';
import {
  droneGeometry,
  lightsGeometry as droneLightsGeometry,
  parcelGeometry as droneParcelGeometry,
  rotorGeometry as droneRotorGeometry,
  visitorColors,
  visitorParts,
} from '../../../src/render/Smuggling';
import { currentTheme, setTheme, stoneCap, TEX, type Theme } from '../../../src/render/textures';
import { BIN_PILES } from '../../../src/render/WorkGear';
import { pine, sceneryTree, WALL_H, wallBlock } from '../../../src/render/WorldView';
import type { BuildContext, BuiltModel, CatalogLibraryInfo, ModelCategory, ModelEntry, ModelStats } from './types';

export const LIBRARIES: CatalogLibraryInfo[] = [
  {
    id: 'all',
    name: 'All Libraries',
    badge: 'ALL',
    description: 'Every procedural 3D object across the game and the V2 kit library.',
  },
  {
    id: 'game',
    name: 'Prison Escape 3D',
    badge: 'GAME',
    description: 'All 3D models built by the game in src/render/* and src/content/*.',
  },
  {
    id: 'kit-library',
    name: 'V2 Kit Library',
    badge: 'V2 LIB',
    description: 'Parametric code-generated 3D objects built from kit.ts primitives.',
  },
];

export const CATEGORIES: ReadonlyArray<{ id: ModelCategory | 'all'; label: string; icon: string }> = [
  { id: 'all', label: 'All Objects', icon: '◈' },
  { id: 'props', label: 'Props', icon: '🪑' },
  { id: 'decor', label: 'Room Decor', icon: '🖼' },
  { id: 'items', label: 'Items & Tools', icon: '🔧' },
  { id: 'characters', label: 'Characters', icon: '🧍' },
  { id: 'animals', label: 'Animals', icon: '🐕' },
  { id: 'vehicles', label: 'Vehicles', icon: '🚁' },
  { id: 'fixtures', label: 'Fixtures', icon: '☎️' },
  { id: 'architecture', label: 'Architecture', icon: '🧱' },
];

const enMap = en as Record<string, string>;
const frMap = fr as Record<string, string>;

function humanize(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function makeKitMesh(parts: Part[], ao = true, mat: THREE.Material = kitMaterial): THREE.Mesh {
  const m = new THREE.Mesh(merge(parts, ao), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Default footprints and subcategories for all 39 PropKind models. */
const PROP_META: Record<PropKind, { w: number; d: number; sub: string; desc: string; sizes?: Array<[number, number]>; tags?: string[] }> = {
  bed: { w: 1, d: 2, sub: 'Cell & Living', desc: 'Steel frame bunk with mattress, pillow, and folded blanket.', sizes: [[1, 2]] },
  desk: {
    w: 1,
    d: 1,
    sub: 'Cell & Living',
    desc: 'Personal cell desk with drawer and stash compartment.',
    sizes: [
      [1, 1],
      [2, 1],
    ],
  },
  toilet: { w: 1, d: 1, sub: 'Cell & Living', desc: 'Porcelain cell toilet with cistern and flush stash.', sizes: [[1, 1]] },
  chair: { w: 1, d: 1, sub: 'Cell & Living', desc: 'Four-legged wooden chair.', sizes: [[1, 1]] },
  readChair: { w: 1, d: 1, sub: 'Cell & Living', desc: 'Library reading chair with backrest.', sizes: [[1, 1]] },
  deskChair: { w: 1, d: 1, sub: 'Cell & Living', desc: 'Office chair positioned at desks.', sizes: [[1, 1]] },
  table: {
    w: 2,
    d: 1,
    sub: 'Canteen & Common',
    desc: 'Long table for canteen meals, visiting, or workshops.',
    sizes: [
      [1, 1],
      [2, 1],
      [3, 1],
      [2, 2],
    ],
  },
  seat: {
    w: 2,
    d: 1,
    sub: 'Canteen & Common',
    desc: 'Low bench alongside canteen tables.',
    sizes: [
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
  bench: {
    w: 2,
    d: 1,
    sub: 'Yard & Sports',
    desc: 'Slatted timber bench with iron legs for the yard.',
    sizes: [
      [2, 1],
      [3, 1],
    ],
  },
  bleachers: {
    w: 3,
    d: 1,
    sub: 'Yard & Sports',
    desc: 'Three-tier spectator bleachers alongside the sports pitch.',
    sizes: [
      [2, 1],
      [3, 1],
      [4, 1],
    ],
  },
  counter: {
    w: 3,
    d: 1,
    sub: 'Canteen & Common',
    desc: 'Serving counter with sneeze guard and tray rail.',
    sizes: [
      [2, 1],
      [3, 1],
      [4, 1],
    ],
  },
  vending: { w: 1, d: 1, sub: 'Canteen & Common', desc: 'Snack & soda vending machine cabinet.', tags: ['interactive', 'electric'] },
  cooler: {
    w: 1,
    d: 1,
    sub: 'Canteen & Common',
    desc: 'Canteen water cooler with inverted blue bottle and cup dispenser.',
    tags: ['interactive'],
  },
  jobBoard: {
    w: 1,
    d: 1,
    sub: 'Administration',
    desc: 'Standing notice board where prison work quotas and openings are posted.',
    tags: ['interactive'],
  },
  controlDesk: {
    w: 2,
    d: 1,
    sub: 'Administration',
    desc: 'Security console with angled monitors and status lamps.',
    sizes: [
      [2, 1],
      [3, 1],
    ],
    tags: ['electric', 'security'],
  },
  generator: {
    w: 2,
    d: 2,
    sub: 'Utility & Security',
    desc: 'Diesel/electric prison power generator with cooling fins and exhaust.',
    sizes: [
      [2, 1],
      [2, 2],
    ],
    tags: ['interactive', 'electric', 'security'],
  },
  lamp: {
    w: 1,
    d: 1,
    sub: 'Utility & Security',
    desc: 'Outdoor street lamp (or Six Hunter iron lantern in forest theme).',
    tags: ['lit-at-night', 'theme-aware'],
  },
  ladder: {
    w: 1,
    d: 1,
    sub: 'Utility & Security',
    desc: 'Wall-mounted steel ladder reaching the vents and roof hatch.',
    tags: ['interactive', 'escape'],
  },
  helipad: {
    w: 3,
    d: 3,
    sub: 'Utility & Security',
    desc: 'HMP Irongate concrete landing pad with yellow H markings.',
    sizes: [[3, 3]],
    tags: ['escape'],
  },
  shower: { w: 1, d: 1, sub: 'Hygiene', desc: 'Tiled floor drain, chrome riser pipe, and angled showerhead.', tags: ['hygiene'] },
  weights: {
    w: 1,
    d: 2,
    sub: 'Gym & Yard',
    desc: 'Weight bench with uprights and animated barbell.',
    sizes: [[1, 2]],
    tags: ['interactive', 'animated', 'gym'],
  },
  treadmill: {
    w: 1,
    d: 2,
    sub: 'Gym & Yard',
    desc: 'Motorized running belt with console handrails.',
    sizes: [[1, 2]],
    tags: ['interactive', 'gym'],
  },
  pullup: { w: 1, d: 1, sub: 'Gym & Yard', desc: 'Tall steel pull-up frame for outdoor strength training.', tags: ['interactive', 'gym'] },
  punchingBag: {
    w: 1,
    d: 1,
    sub: 'Gym & Yard',
    desc: 'Steel frame and swinging heavy leather punching bag.',
    tags: ['interactive', 'animated', 'gym'],
  },
  mat: {
    w: 1,
    d: 2,
    sub: 'Gym & Yard',
    desc: 'Blue gym floor mat for push-ups.',
    sizes: [
      [1, 2],
      [2, 1],
    ],
    tags: ['interactive', 'gym'],
  },
  shelf: {
    w: 2,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Multi-tier storage rack with boxes and supplies.',
    sizes: [
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
  bin: {
    w: 1,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Workshop supply/output bin with selectable job cargo pile.',
    tags: ['interactive', 'jobs'],
  },
  washer: {
    w: 1,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Industrial laundry washing machine with spinning drum.',
    tags: ['interactive', 'animated', 'jobs'],
  },
  workbench: {
    w: 2,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Woodshop carpenter bench with vice and timber.',
    sizes: [[2, 1]],
    tags: ['interactive', 'jobs'],
  },
  press: {
    w: 1,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Metalshop hydraulic stamping press for license plates.',
    tags: ['interactive', 'animated', 'jobs'],
  },
  oven: {
    w: 1,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Kitchen industrial oven with glowing window and burners.',
    tags: ['interactive', 'jobs'],
  },
  freezer: {
    w: 2,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Walk-in/chest kitchen cold storage unit.',
    sizes: [
      [1, 1],
      [2, 1],
    ],
    tags: ['interactive', 'jobs'],
  },
  sortingDesk: {
    w: 2,
    d: 1,
    sub: 'Workshops & Jobs',
    desc: 'Mailroom sorting desk with pigeonholes and moving letters.',
    sizes: [[2, 1]],
    tags: ['interactive', 'jobs'],
  },
  planter: {
    w: 2,
    d: 1,
    sub: 'Garden & Estate',
    desc: 'Raised timber garden planter with growing leafy crops and ripe vegetables.',
    sizes: [
      [2, 1],
      [3, 1],
    ],
    tags: ['interactive', 'jobs', 'garden'],
  },
  toolShed: {
    w: 2,
    d: 1,
    sub: 'Garden & Estate',
    desc: 'Garden timber shed holding seedling trays and tools.',
    sizes: [[2, 1]],
    tags: ['interactive', 'jobs', 'garden'],
  },
  crate: {
    w: 1,
    d: 1,
    sub: 'Garden & Estate',
    desc: 'Slatted timber produce crate heaped with harvested vegetables.',
    tags: ['interactive', 'jobs', 'garden'],
  },
  trough: {
    w: 2,
    d: 1,
    sub: 'Garden & Estate',
    desc: 'Six Hunter kennels feeding trough (feed sacks in, dog bowls out).',
    sizes: [[2, 1]],
    tags: ['interactive', 'jobs', 'six-hunter'],
  },
  smoker: {
    w: 1,
    d: 1,
    sub: 'Garden & Estate',
    desc: 'Six Hunter fieldstone firebox and iron smokehouse cabinet.',
    tags: ['interactive', 'jobs', 'six-hunter'],
  },
  netFrame: {
    w: 2,
    d: 1,
    sub: 'Garden & Estate',
    desc: 'Six Hunter boathouse timber frame with stretched fishing net, cork floats, and stool.',
    sizes: [[2, 1]],
    tags: ['interactive', 'jobs', 'six-hunter'],
  },
};

function buildPropEntries(): ModelEntry[] {
  const pileKeys = ['empty', ...Object.keys(BIN_PILES)];
  return (Object.keys(PROPS) as PropKind[]).map((kind) => {
    const meta = PROP_META[kind];
    const sizes = meta.sizes ?? [[meta.w, meta.d]];
    const variants: ModelEntry['variants'] = [];

    if (sizes.length > 1) {
      variants.push({
        key: 'size',
        label: 'Footprint (W×D)',
        kind: 'select',
        options: sizes.map(([w, d]) => ({ value: `${w}x${d}`, label: `${w} × ${d} tiles` })),
        defaultValue: `${meta.w}x${meta.d}`,
      });
    }
    if (kind === 'lamp') {
      variants.push(
        {
          key: 'style',
          label: 'Theme Style',
          kind: 'select',
          options: [
            { value: 'classic', label: 'Street Lamp (Classic)' },
            { value: 'forest', label: 'Iron Lantern (Six Hunter)' },
          ],
          defaultValue: 'classic',
        },
        {
          key: 'heads',
          label: 'Arms / Heads',
          kind: 'select',
          options: [
            { value: 1, label: 'Single Head (1)' },
            { value: 2, label: 'Twin Heads (2)' },
          ],
          defaultValue: 1,
        },
      );
    }
    if (kind === 'bin') {
      variants.push({
        key: 'pile',
        label: 'Bin Cargo Pile',
        kind: 'select',
        options: pileKeys.map((k) => ({ value: k, label: k === 'empty' ? 'Empty Bin' : humanize(k) })),
        defaultValue: 'dirty_laundry',
      });
    }
    if (kind === 'planter') {
      variants.push({
        key: 'growth',
        label: 'Crop Growth Stage',
        kind: 'select',
        options: [
          { value: 'ripe', label: 'Ripe Crop (100%)' },
          { value: 'growing', label: 'Growing Seedlings (50%)' },
          { value: 'soil', label: 'Empty Soil (0%)' },
        ],
        defaultValue: 'ripe',
      });
    }

    const tags = ['prop', PROPS[kind].solid ? 'solid' : 'walkable', meta.sub.toLowerCase().split(' ')[0], ...(meta.tags ?? [])];

    return {
      id: `prop:${kind}`,
      library: 'game',
      name: humanize(kind),
      category: 'props',
      subcategory: meta.sub,
      tags,
      sourceFile: 'src/render/props.ts',
      builderName: `propGeometry('${kind}', w, d)`,
      description: meta.desc,
      footprint: [meta.w, meta.d],
      variants: variants.length ? variants : undefined,
      build: (ctx: BuildContext): BuiltModel => {
        const sizeStr = String(ctx.variants.size ?? `${meta.w}x${meta.d}`);
        const [w, d] = sizeStr.split('x').map(Number);
        const group = new THREE.Group();
        const disposables: THREE.BufferGeometry[] = [];

        if (kind === 'lamp') {
          const heads = Number(ctx.variants.heads ?? 1);
          const isForest = ctx.variants.style === 'forest';
          const parts = isForest ? lanternParts(heads) : lampParts(heads);
          const geo = merge(parts);
          disposables.push(geo);
          const mesh = new THREE.Mesh(geo, kitMaterial);
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
        } else {
          const geo = propGeometry(kind, w, d);
          disposables.push(geo);
          const mesh = new THREE.Mesh(geo, kitMaterial);
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
        }

        // Attach dynamic sub-meshes from GymGear, WorkGear, and GroundsView
        let barMesh: THREE.Mesh | null = null;
        let bagPivot: THREE.Mesh | null = null;
        let pressRam: THREE.Mesh | null = null;
        let washerDrum: THREE.Mesh | null = null;

        if (kind === 'weights') {
          const barGeo = merge(
            [rod(0.025, 0.9, 0x8d949e, 0, 0, 0), disc(0.12, 0.05, 0x23262b, -0.4, 0, 0), disc(0.12, 0.05, 0x23262b, 0.4, 0, 0)],
            false,
          );
          disposables.push(barGeo);
          barMesh = new THREE.Mesh(barGeo, kitMaterial);
          barMesh.position.set(0, 0.62, -0.25);
          barMesh.castShadow = true;
          group.add(barMesh);
        } else if (kind === 'punchingBag') {
          const bagGeo = merge([cyl(0.2, 0.75, 0xb8352f, 0, -0.75, 0, 12), cyl(0.21, 0.04, 0x3b4048, 0, -0.53, 0, 12)], false);
          disposables.push(bagGeo);
          bagPivot = new THREE.Mesh(bagGeo, kitMaterial);
          bagPivot.position.set(0, 1.15, 0);
          bagPivot.castShadow = true;
          group.add(bagPivot);
        } else if (kind === 'bin') {
          const pileKey = String(ctx.variants.pile ?? 'dirty_laundry');
          const pileBuilder = BIN_PILES[pileKey];
          if (pileBuilder) {
            const pileGeo = merge(pileBuilder(), false);
            disposables.push(pileGeo);
            const pileMesh = new THREE.Mesh(pileGeo, kitMaterial);
            pileMesh.castShadow = true;
            group.add(pileMesh);
          }
        } else if (kind === 'washer') {
          const drumGeo = merge(
            [
              disc(0.2, 0.02, 0x59636f, 0, 0, 0),
              box(0.14, 0.09, 0.02, 0xf2701c, -0.05, -0.1, 0.012),
              box(0.12, 0.08, 0.02, 0xf2f2ee, 0.06, -0.07, 0.014),
            ],
            false,
          );
          disposables.push(drumGeo);
          washerDrum = new THREE.Mesh(drumGeo, kitMaterial);
          washerDrum.position.set(0, 0.48, 0.42);
          group.add(washerDrum);
        } else if (kind === 'press') {
          const ramGeo = merge([box(0.4, 0.08, 0.34, 0x3b4048, 0, 0, 0), cyl(0.06, 0.28, 0xa8b0ba, 0, 0.08, 0, 8)], false);
          disposables.push(ramGeo);
          pressRam = new THREE.Mesh(ramGeo, kitMaterial);
          pressRam.position.set(0, 0.9, 0);
          group.add(pressRam);
        } else if (kind === 'planter') {
          const stage = String(ctx.variants.growth ?? 'ripe');
          if (stage !== 'soil') {
            const crops: Part[] = [];
            const VEG = [0xe8862e, 0xd23f36, 0xe8d23a];
            for (let k = 0; k < w * 2; k++) {
              const t = (k + 0.5) / 2 - w / 2;
              const h = 0.12 + ((k * 3) % 5) * 0.025;
              crops.push(box(0.28, h, 0.26, k % 2 ? 0x4f8a2e : 0x3c6e24, t, 0, 0), box(0.18, h * 0.8, 0.34, 0x4f8a2e, t, 0, 0));
              if (stage === 'ripe' && k % 2 === 0) {
                crops.push(box(0.12, 0.1, 0.12, VEG[k % VEG.length], t + 0.06, h * 0.5, 0.05));
              }
            }
            const cropGeo = merge(crops, false);
            disposables.push(cropGeo);
            const cropMesh = new THREE.Mesh(cropGeo, kitMaterial);
            cropMesh.position.set(0, 0.38, 0);
            if (stage === 'growing') cropMesh.scale.set(0.75, 0.55, 0.75);
            group.add(cropMesh);
          }
        }

        return {
          root: group,
          animate: (t) => {
            if (barMesh) barMesh.position.y = 0.62 + (Math.sin(t * 2.5) * 0.5 + 0.5) * 0.28;
            if (bagPivot) bagPivot.rotation.x = Math.sin(t * 4.2) * 0.22;
            if (washerDrum) washerDrum.rotation.z = t * 4.5;
            if (pressRam) pressRam.position.y = 0.9 - Math.pow(Math.max(0, Math.sin(t * 2.4)), 4) * 0.18;
          },
          dispose: () => disposables.forEach((g) => g.dispose()),
        };
      },
    };
  });
}

const TABLETOP_DECOR = new Set<DecorKind>(['trays', 'pans', 'deskLamp', 'coffee', 'books', 'phone']);

function buildDecorEntries(): ModelEntry[] {
  return (Object.keys(DECOR) as DecorKind[]).map((kind) => {
    const isWall = DECOR[kind].wall;
    const isTabletop = TABLETOP_DECOR.has(kind);
    const sub = isWall ? 'Wall Decor' : isTabletop ? 'Tabletop Decor' : 'Floor & Yard Decor';
    const defaultW = kind === 'menuBoard' || kind === 'pipes' || kind === 'wallShelf' || kind === 'pigeonholes' ? 2 : 1;
    const defaultD = 1;

    // Test once whether this decor has glow or canopy
    const probe = decorGeometry(kind, defaultW, defaultD);
    const hasGlow = !!probe.glow;
    const hasCanopy = !!probe.canopy;
    probe.base.dispose();
    probe.glow?.dispose();
    probe.canopy?.dispose();

    const tags = ['decor', isWall ? 'wall-mounted' : isTabletop ? 'tabletop' : 'floor'];
    if (hasGlow) tags.push('lit-at-night', 'electric');
    if (hasCanopy) tags.push('foliage', 'canopy');
    if (kind === 'tallyBoard' || kind === 'antlers') tags.push('six-hunter');
    if (kind === 'lifebuoy' || kind === 'bollard' || kind === 'windsock' || kind === 'ropeCoil') tags.push('irongate');
    if (kind === 'cactus' || kind === 'mineSign') tags.push('san-pancho');

    const variants: ModelEntry['variants'] = [
      {
        key: 'width',
        label: 'Width (Tiles)',
        kind: 'select',
        options: [
          { value: 1, label: '1 Tile Wide' },
          { value: 2, label: '2 Tiles Wide' },
          { value: 3, label: '3 Tiles Wide' },
        ],
        defaultValue: defaultW,
      },
    ];
    if (hasCanopy) {
      variants.push({
        key: 'showCanopy',
        label: 'Show Tree Canopy',
        kind: 'boolean',
        defaultValue: true,
      });
    }

    return {
      id: `decor:${kind}`,
      library: 'game',
      name: humanize(kind),
      category: 'decor',
      subcategory: sub,
      tags,
      sourceFile: 'src/render/decor.ts',
      builderName: `decorGeometry('${kind}', w, d)`,
      description: `${sub} piece (${isWall ? 'hangs on north wall' : isTabletop ? 'sits on furniture' : 'stands on floor'})${hasGlow ? '; includes emissive glow mesh.' : '.'}`,
      footprint: [defaultW, defaultD],
      wallMounted: isWall,
      variants,
      build: (ctx: BuildContext): BuiltModel => {
        const w = Number(ctx.variants.width ?? defaultW);
        const built = decorGeometry(kind, w, defaultD);
        const group = new THREE.Group();
        const baseMesh = new THREE.Mesh(built.base, kitMaterial);
        baseMesh.castShadow = baseMesh.receiveShadow = true;
        group.add(baseMesh);

        let glowMat: THREE.MeshBasicMaterial | null = null;
        if (built.glow) {
          glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
          const glowMesh = new THREE.Mesh(built.glow, glowMat);
          group.add(glowMesh);
        }
        if (built.canopy && ctx.variants.showCanopy !== false) {
          const canopyMesh = new THREE.Mesh(built.canopy, kitMaterial);
          canopyMesh.castShadow = canopyMesh.receiveShadow = true;
          group.add(canopyMesh);
        }

        return {
          root: group,
          animate: (t, _dt, c) => {
            if (glowMat) {
              const flicker = 0.94 + Math.sin(t * 23) * 0.03;
              glowMat.color.setScalar(0.12 + 0.88 * c.power * flicker);
            }
          },
          dispose: () => {
            built.base.dispose();
            built.glow?.dispose();
            built.canopy?.dispose();
            glowMat?.dispose();
          },
        };
      },
    };
  });
}

function buildItemEntries(): ModelEntry[] {
  const shapeKeys = Object.keys(ITEM_SHAPES);
  return ITEMS.map((item: ItemDef, idx: number) => {
    const num = idx + 1;
    const nameEn = enMap[`item.${item.id}`] ?? humanize(item.id);
    const nameFr = frMap[`item.${item.id}`] ?? nameEn;
    const hexColor = `#${item.color.toString(16).padStart(6, '0')}`;
    const hexAccent = `#${(item.accent ?? item.color).toString(16).padStart(6, '0')}`;

    const tags: string[] = ['item', item.cat, item.contraband ? 'contraband' : 'legal', `shape:${item.shape}`];
    if (item.tool) tags.push('tool', `tool:${item.tool.kind}`);
    if (item.attack) tags.push('weapon');
    if (item.defense) tags.push('armor');
    if (item.food) tags.push('food');
    if (item.small) tags.push('rat-carry');
    if (item.from.includes('estate')) tags.push('six-hunter');
    if (item.from.includes('holiday')) tags.push('holiday');

    const subMap: Record<ItemDef['cat'], string> = {
      tool: 'Tools (Dig / Cut / Chip)',
      weapon: 'Weapons',
      key: 'Keys & Keycards',
      mold: 'Key Molds & Impressions',
      outfit: 'Outfits & Disguises',
      gear: 'Escape & Tactical Gear',
      material: 'Crafting Materials & Everyday',
    };

    const descParts = [
      `Item #${num} (${item.id})`,
      `3D shape: "${item.shape}"`,
      item.contraband ? 'Contraband' : 'Legal item',
      `$${item.value}`,
    ];
    if (item.tool) descParts.push(`${item.tool.kind} tier ${item.tool.tier} (${item.uses ?? '∞'} uses)`);
    if (item.attack) descParts.push(`+${item.attack} attack`);
    if (item.defense) descParts.push(`+${item.defense} defense`);

    return {
      id: `item:${item.id}`,
      library: 'game',
      name: nameEn,
      nameFr,
      category: 'items',
      subcategory: subMap[item.cat] ?? 'Items',
      tags,
      sourceFile: 'src/render/itemModels.ts',
      builderName: `itemGeometry(ITEMS[${idx}]) /* shape: ${item.shape} */`,
      description: descParts.join(' · '),
      footprint: [1, 1],
      variants: [
        {
          key: 'shape',
          label: '3D Shape Archetype',
          kind: 'select',
          options: shapeKeys.map((s) => ({ value: s, label: s })),
          defaultValue: item.shape,
        },
        {
          key: 'color',
          label: 'Primary Color',
          kind: 'color',
          defaultValue: hexColor,
        },
        {
          key: 'accent',
          label: 'Accent Color',
          kind: 'color',
          defaultValue: hexAccent,
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const chosenShape = String(ctx.variants.shape ?? item.shape);
        const cStr = String(ctx.variants.color ?? hexColor);
        const aStr = String(ctx.variants.accent ?? hexAccent);
        const c = parseInt(cStr.replace('#', ''), 16);
        const a = parseInt(aStr.replace('#', ''), 16);

        const isDefault = chosenShape === item.shape && c === item.color && a === (item.accent ?? item.color);
        const geo = isDefault ? itemGeometry(item) : merge((ITEM_SHAPES[chosenShape] ?? ITEM_SHAPES.blob)(c, a), false);

        const mesh = new THREE.Mesh(geo, kitMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        const group = new THREE.Group();
        group.add(mesh);
        return {
          root: group,
          dispose: () => {
            if (!isDefault) geo.dispose();
          },
        };
      },
    };
  });
}

function buildCharacterEntries(): ModelEntry[] {
  const poseOptions = [
    { value: 'idle', label: 'Standing Idle (with glances)' },
    { value: 'walk', label: 'Walking Stride' },
    { value: 'run', label: 'Running Sprint' },
    { value: 'eat', label: 'Carrying Meal Tray' },
    { value: 'lift', label: 'Lifting / Exercising' },
    { value: 'pushup', label: 'Push-Ups (Prone)' },
    { value: 'read', label: 'Reading Book' },
    { value: 'guitar', label: 'Talent Night: Playing Guitar' },
    { value: 'drums', label: 'Talent Night: Bucket Drums' },
    { value: 'phone', label: 'Talking on Pay Phone' },
    { value: 'sweep', label: 'Sweeping / Mopping' },
    { value: 'ko', label: 'Knocked Out' },
  ];

  const heldOptions = [
    { value: 'none', label: 'Empty-Handed' },
    { value: 'baton', label: 'Guard Baton' },
    { value: 'shovel', label: 'Sturdy Shovel' },
    { value: 'pickaxe', label: 'Sturdy Pickaxe' },
    { value: 'cutters', label: 'Heavy Snips' },
    { value: 'broom', label: 'Push Broom' },
    { value: 'cup_of_tea', label: 'Cup of Tea' },
    { value: 'book', label: 'Book' },
    { value: 'wooden_bat', label: 'Spiked Bat' },
  ];

  interface CharPreset {
    id: string;
    name: string;
    sub: string;
    desc: string;
    look: Look;
    gangColor?: number;
    work?: 'kitchen';
    tags: string[];
  }

  const presets: CharPreset[] = [
    {
      id: 'inmate',
      name: 'Inmate (Orange Jumpsuit)',
      sub: 'Prisoners',
      desc: 'Blocky Escapists-style inmate figure with skinned limb bones, blinking eyes, and number patch.',
      look: { outfit: 0xf2701c, skin: 0xf1c6a0, hair: 0x3b2a1e, hairStyle: 0 },
      tags: ['character', 'inmate', 'animated', 'skinned'],
    },
    {
      id: 'inmate_gang_skulls',
      name: 'Gang Member (Kitchen Crew)',
      sub: 'Prisoners',
      desc: 'Inmate wearing the crimson head-wrap of the Kitchen Crew gang.',
      look: { outfit: 0xf2701c, skin: 0xc98d62, hair: 0x1d1612, hairStyle: 1, beard: 2 },
      gangColor: GANG_COLOR.kitchen,
      tags: ['character', 'inmate', 'gang', 'animated'],
    },
    {
      id: 'inmate_gang_dogs',
      name: 'Gang Member (Old Lifers)',
      sub: 'Prisoners',
      desc: 'Inmate wearing the gold head-wrap of the Old Lifers gang.',
      look: { outfit: 0xf2701c, skin: 0x7d4f33, hair: 0x1d1612, hairStyle: 5, glasses: 2, glassesColor: 0x1a1a1e },
      gangColor: GANG_COLOR.lifers,
      tags: ['character', 'inmate', 'gang', 'animated'],
    },
    {
      id: 'inmate_gang_syndicate',
      name: 'Gang Member (Gym Rats)',
      sub: 'Prisoners',
      desc: 'Inmate wearing the green head-wrap of the Gym Rats gang.',
      look: { outfit: 0xf2701c, skin: 0xe2ad84, hair: 0x6b4a2b, hairStyle: 3 },
      gangColor: GANG_COLOR.gymRats,
      tags: ['character', 'inmate', 'gang', 'animated'],
    },
    {
      id: 'inmate_kitchen',
      name: 'Inmate Worker (Kitchen Chef Toque)',
      sub: 'Prisoners',
      desc: 'Inmate dressed in a kitchen chef toque and white-trimmed uniform.',
      look: { outfit: 0xf2701c, skin: 0xf1c6a0, hair: 0x4a321e, hairStyle: 0, hat: 4, hatColor: 0xf4f4f0 },
      tags: ['character', 'inmate', 'jobs', 'animated'],
    },
    {
      id: 'guard',
      name: 'Prison Guard (Navy Uniform)',
      sub: 'Guards & Staff',
      desc: 'Patrol guard in navy uniform with peaked cap, belt key tag, and radio.',
      look: { outfit: 0x2c4a6e, skin: 0xe2ad84, hair: 0x3b2a1e, cap: 0x1f3550 },
      tags: ['character', 'guard', 'security', 'animated'],
    },
    {
      id: 'guard_riot',
      name: 'Riot Guard (Helmet, Visor & Shield)',
      sub: 'Guards & Staff',
      desc: 'Armored tactical guard with riot helmet, visor, body vest, and polycarbonate riot shield.',
      look: { outfit: 0x22364f, skin: 0xc98d62, hair: 0x1d1612, cap: 0x172638, riot: true },
      tags: ['character', 'guard', 'riot', 'security', 'animated'],
    },
    {
      id: 'guard_hunter',
      name: 'Six Hunter Forester Guard',
      sub: 'Guards & Staff',
      desc: 'The Six Hunter estate guard in forest loden green coat and wide-brimmed ranger hat.',
      look: { outfit: 0x354a34, trousers: 0x283627, skin: 0xe2ad84, hair: 0x4a321e, cap: 0x263825, beard: 1 },
      tags: ['character', 'guard', 'six-hunter', 'animated'],
    },
    {
      id: 'inspector',
      name: 'Ministry Inspector (Charcoal Suit & Bowler)',
      sub: 'Visitors & Officials',
      desc: 'Official from the ministry on inspection day, dressed in a charcoal suit and bowler hat.',
      look: { outfit: 0x34383f, trousers: 0x2a2d33, skin: 0xe2ad84, hair: 0x8a8a8a, hairStyle: 0, hat: 8, hatColor: 0x1d1f24, size: 1.02 },
      tags: ['character', 'official', 'event', 'animated'],
    },
  ];

  const entries: ModelEntry[] = presets.map((p, idx) => ({
    id: `char:${p.id}`,
    library: 'game',
    name: p.name,
    category: 'characters',
    subcategory: p.sub,
    tags: p.tags,
    sourceFile: 'src/render/Character.ts',
    builderName: `new Character(look, ${idx + 1})`,
    description: p.desc,
    footprint: [1, 1],
    variants: [
      {
        key: 'pose',
        label: 'Pose / Activity',
        kind: 'select',
        options: poseOptions,
        defaultValue: 'idle',
      },
      {
        key: 'held',
        label: 'Held Item (Right Hand)',
        kind: 'select',
        options: heldOptions,
        defaultValue: p.id.startsWith('guard') ? 'baton' : 'none',
      },
      {
        key: 'hairStyle',
        label: 'Haircut Style',
        kind: 'select',
        options: [
          { value: 0, label: '0: Short' },
          { value: 1, label: '1: Buzz Cut' },
          { value: 2, label: '2: Bald' },
          { value: 3, label: '3: Tall Top' },
          { value: 4, label: '4: Mohawk' },
          { value: 5, label: '5: Curls' },
          { value: 6, label: '6: Ponytail' },
        ],
        defaultValue: p.look.hairStyle ?? 0,
      },
    ],
    build: (ctx: BuildContext): BuiltModel => {
      const look: Look = { ...p.look, hairStyle: Number(ctx.variants.hairStyle ?? p.look.hairStyle ?? 0) };
      const ch = new Character(look, idx + 1);
      if (p.gangColor) ch.colours(p.gangColor);

      const heldId = String(ctx.variants.held ?? 'none');
      if (heldId !== 'none') {
        const num = itemNumber(heldId);
        const def = ITEMS[num - 1];
        if (def) ch.hold(num, itemGeometry(def));
      }

      const poseKey = String(ctx.variants.pose ?? 'idle');
      return {
        root: ch.root,
        animate: (t, dt) => {
          const moving = poseKey === 'walk' || poseKey === 'run';
          const speed = poseKey === 'run' ? 4.2 : poseKey === 'walk' ? 2.1 : 0;
          let doing: number = DOING.NOTHING;
          if (poseKey === 'run') doing = DOING.RUN;
          else if (poseKey === 'lift') doing = DOING.LIFT;
          else if (poseKey === 'pushup') doing = DOING.PUSHUP;
          else if (poseKey === 'read') doing = DOING.READ;
          else if (poseKey === 'guitar') doing = DOING.GUITAR;
          else if (poseKey === 'drums') doing = DOING.DRUMS;
          else if (poseKey === 'phone') doing = DOING.PHONE;
          else if (poseKey === 'sweep') doing = DOING.MOP;
          else if (poseKey === 'ko') doing = DOING.KNOCKED_OUT;

          ch.trayPose(poseKey === 'eat' ? TRAY_AT.HANDS : TRAY_AT.NONE, 1);
          ch.pose(t * speed, 0, 0, moving, Math.min(0.05, dt || 0.016), t, true, doing);
          ch.root.position.x = 0;
          ch.root.position.z = 0;
        },
        dispose: () => ch.dispose(),
      };
    },
  }));

  // Also add Visitor, Gatekeeper, and Bed Dummy
  entries.push(
    {
      id: 'char:visitor',
      library: 'game',
      name: 'Seated Visitor / Parole Board Member',
      category: 'characters',
      subcategory: 'Visitors & Officials',
      tags: ['character', 'visitor', 'parole'],
      sourceFile: 'src/render/Smuggling.ts',
      builderName: 'visitorParts()',
      description: 'Seated figure used for visiting room guests and the three parole board members.',
      footprint: [1, 1],
      variants: [
        {
          key: 'look',
          label: 'Visitor Look Seed',
          kind: 'select',
          options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: `Visitor Look #${n + 1}` })),
          defaultValue: 0,
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const parts = visitorParts();
        const colors = visitorColors(Number(ctx.variants.look ?? 0));
        const group = new THREE.Group();
        const cMat = kitMaterial.clone();
        cMat.color.setHex(colors.clothes);
        const sMat = kitMaterial.clone();
        sMat.color.setHex(colors.skin);
        const hMat = kitMaterial.clone();
        hMat.color.setHex(colors.hair);
        group.add(new THREE.Mesh(parts.clothes, cMat), new THREE.Mesh(parts.skin, sMat), new THREE.Mesh(parts.hair, hMat));
        return {
          root: group,
          dispose: () => {
            parts.clothes.dispose();
            parts.skin.dispose();
            parts.hair.dispose();
            cMat.dispose();
            sMat.dispose();
            hMat.dispose();
          },
        };
      },
    },
    {
      id: 'char:gatekeeper',
      library: 'game',
      name: 'Checkpoint Gatekeeper Bust',
      category: 'characters',
      subcategory: 'Guards & Staff',
      tags: ['character', 'guard', 'checkpoint'],
      sourceFile: 'src/render/Getaway.ts',
      builderName: 'keeperGeometry()',
      description: 'Seated guard bust inside the main road checkpoint booth.',
      footprint: [1, 1],
      build: (): BuiltModel => {
        const geo = keeperGeometry();
        const m = new THREE.Mesh(geo, kitMaterial);
        m.castShadow = true;
        const g = new THREE.Group();
        g.add(m);
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'char:bed_dummy',
      library: 'game',
      name: 'Bed Dummy (Decoy Sleeper)',
      category: 'characters',
      subcategory: 'Prisoners',
      tags: ['character', 'escape', 'decoy'],
      sourceFile: 'src/render/BedDummy.ts',
      builderName: 'bedDummyMesh()',
      description: 'Two pillows under the blanket and a soap head with hair, fooling guards during night roll call.',
      footprint: [1, 2],
      build: (): BuiltModel => {
        const mesh = bedDummyMesh();
        mesh.visible = true;
        mesh.position.set(0, 0, 0.45);
        const g = new THREE.Group();
        g.add(mesh);
        return { root: g, dispose: () => mesh.geometry.dispose() };
      },
    },
  );

  return entries;
}

function buildAnimalEntries(): ModelEntry[] {
  const breeds = [
    { id: 'shepherd', name: 'German Shepherd', desc: 'Classic tan-and-black saddle guard dog.' },
    { id: 'mastiff', name: 'Guard Mastiff', desc: 'Broad-shouldered heavy brindle mastiff.' },
    { id: 'retriever', name: 'Golden Retriever', desc: 'Warm russet-gold kennel hound.' },
    { id: 'collie', name: 'Border Collie', desc: 'Black-and-white patrol collie.' },
    {
      id: 'foxhound',
      name: 'Tricolour Foxhound (Six Hunter)',
      desc: 'Rangy white, black, and tan hunting hound from the Six Hunter pack.',
    },
    {
      id: 'bloodhound',
      name: 'Black-and-Tan Bloodhound (Six Hunter)',
      desc: 'Heavy-headed red-and-black scent hound from the Six Hunter pack.',
    },
  ] as const;

  const dogPoses = [
    { value: 'heel', label: 'At Heel / Trotting' },
    { value: 'track', label: 'Nose Down Tracking Scent' },
    { value: 'point', label: 'Pointing & Barking' },
    { value: 'kennel', label: 'Lying by Kennel' },
    { value: 'dazed', label: 'Dazed / Sneezing (Pepper)' },
    { value: 'asleep', label: 'Asleep (Jerky Treat)' },
  ];

  const entries: ModelEntry[] = breeds.map((b) => ({
    id: `animal:dog_${b.id}`,
    library: 'game',
    name: `Dog: ${b.name}`,
    category: 'animals',
    subcategory: 'Guard & Hunting Dogs',
    tags: ['animal', 'dog', 'animated', b.id, ...(b.id === 'foxhound' || b.id === 'bloodhound' ? ['six-hunter'] : [])],
    sourceFile: 'src/render/Dog.ts',
    builderName: `new Dogs() /* coat: '${b.id}' */`,
    description: b.desc,
    footprint: [1, 1],
    variants: [
      {
        key: 'pose',
        label: 'Dog Pose',
        kind: 'select',
        options: dogPoses,
        defaultValue: 'heel',
      },
      {
        key: 'moving',
        label: 'Trotting Gait',
        kind: 'boolean',
        defaultValue: true,
      },
      {
        key: 'showKennel',
        label: 'Show Wooden Kennel Behind',
        kind: 'boolean',
        defaultValue: false,
      },
    ],
    build: (ctx: BuildContext): BuiltModel => {
      const dogs = new Dogs();
      dogs.setDogs([{ x: -0.5, z: -0.5, face: 5, coat: b.id }]);
      const pose = (ctx.variants.pose ?? 'heel') as 'kennel' | 'heel' | 'point' | 'track' | 'dazed' | 'asleep';
      const moving = Boolean(ctx.variants.moving ?? true) && (pose === 'heel' || pose === 'track');
      const showKennel = Boolean(ctx.variants.showKennel ?? false);
      const kennelMesh = dogs.group.children[5] as THREE.InstancedMesh | undefined;
      if (kennelMesh) kennelMesh.visible = showKennel;
      dogs.update([{ x: 0, z: 0, facing: 0, moving, pace: 1, pose, friend: false }], [], 2, 2, 0.016, 0, true, [], true);

      return {
        root: dogs.group,
        animate: (t, dt) => {
          dogs.update(
            [{ x: 0, z: 0, facing: 0, moving, pace: 1, pose, friend: false }],
            [],
            2,
            2,
            Math.min(0.05, dt || 0.016),
            t,
            true,
            [],
            true,
          );
        },
        dispose: () => {
          dogs.group.traverse((o) => {
            const m = o as THREE.Mesh;
            m.geometry?.dispose();
            const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
            for (const mat of mats) {
              if (mat !== kitMaterial) {
                (mat as THREE.MeshStandardMaterial).map?.dispose();
                mat.dispose();
              }
            }
          });
        },
      };
    },
  }));

  entries.push({
    id: 'animal:rat',
    library: 'game',
    name: 'Prison Rat (Pet / Messenger / Racer)',
    category: 'animals',
    subcategory: 'Rats',
    tags: ['animal', 'rat', 'animated', 'pet'],
    sourceFile: 'src/render/Rat.ts',
    builderName: 'bodyGeometry() + tailGeometry()',
    description: 'Low-poly prison rat with wagging pink tail, ears, and optional carried item in its teeth.',
    footprint: [1, 1],
    variants: [
      {
        key: 'scale',
        label: 'Scale',
        kind: 'select',
        options: [
          { value: 1.5, label: 'Floor Scale (1.5×)' },
          { value: 1.1, label: 'Shoulder Perched (1.1×)' },
          { value: 2.5, label: 'Close-Up Study (2.5×)' },
        ],
        defaultValue: 1.5,
      },
    ],
    build: (ctx: BuildContext): BuiltModel => {
      const bodyGeo = ratBodyGeometry();
      const tailGeo = ratTailGeometry();
      const bodyMesh = new THREE.Mesh(bodyGeo, kitMaterial);
      const tailMesh = new THREE.Mesh(tailGeo, kitMaterial);
      bodyMesh.castShadow = tailMesh.castShadow = true;
      tailMesh.position.set(0, 0.05, -0.11);
      const group = new THREE.Group();
      group.add(bodyMesh, tailMesh);
      group.scale.setScalar(Number(ctx.variants.scale ?? 1.5));
      return {
        root: group,
        animate: (t) => {
          tailMesh.rotation.y = Math.sin(t * 9) * 0.25;
          group.position.y = Math.abs(Math.sin(t * 12)) * 0.025;
        },
        dispose: () => {
          bodyGeo.dispose();
          tailGeo.dispose();
        },
      };
    },
  });

  return entries;
}

function buildVehicleEntries(): ModelEntry[] {
  const entries: ModelEntry[] = [];

  const deliverySpecs: Array<{
    key: 'truck' | 'redCross' | 'produce';
    name: string;
    desc: string;
    tags: string[];
  }> = [
    {
      key: 'truck',
      name: 'Delivery Box Truck (Suppliers)',
      desc: 'Center Perks blue-and-white supply truck with orange stripe, crates inside, and rolling rear door.',
      tags: ['vehicle', 'delivery', 'escape', 'animated'],
    },
    {
      key: 'redCross',
      name: 'Red Cross Parcel Truck (Canvas Hoops)',
      desc: 'Stalag Flucht bowed canvas military parcel truck with Red Cross markings and rear canvas flaps.',
      tags: ['vehicle', 'delivery', 'escape', 'animated', 'alpine'],
    },
    {
      key: 'produce',
      name: 'San Pancho Produce Pickup Truck',
      desc: 'Sun-faded teal pickup truck loaded with fruit/vegetable crates, stowaway tarp, and drop tailgate.',
      tags: ['vehicle', 'delivery', 'escape', 'animated', 'desert'],
    },
  ];

  for (const spec of deliverySpecs) {
    entries.push({
      id: `vehicle:delivery_${spec.key}`,
      library: 'game',
      name: spec.name,
      category: 'vehicles',
      subcategory: 'Delivery & Stowaway Trucks',
      tags: spec.tags,
      sourceFile: 'src/render/Delivery.ts',
      builderName: `DELIVERY_MODELS.${spec.key}()`,
      description: spec.desc,
      footprint: [2, 5],
      variants: [
        {
          key: 'tailgate',
          label: 'Tailgate Open',
          kind: 'boolean',
          defaultValue: true,
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const built = DELIVERY_MODELS[spec.key]();
        const group = new THREE.Group();
        const bodyGeo = merge(built.body);
        const gateGeo = merge(built.tailgate, false);
        const lampGeo = merge(built.lamps, false);
        const wheelGeo = merge(
          [rod(built.wheelR, 0.24, 0x1d1f23, 0, 0, 0, 12), rod(built.wheelR * 0.55, 0.26, 0x9aa1ab, 0, 0, 0, 10)],
          false,
        );

        const bodyMesh = new THREE.Mesh(bodyGeo, kitMaterial);
        bodyMesh.castShadow = bodyMesh.receiveShadow = true;
        const gateMesh = new THREE.Mesh(gateGeo, kitMaterial);
        const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
        const lampMesh = new THREE.Mesh(lampGeo, lampMat);

        if (ctx.variants.tailgate !== false) {
          if (built.gate === 'roller') gateMesh.position.y = 1.45;
          else if (built.gate === 'flaps') gateMesh.scale.x = 0.12;
          else gateMesh.visible = false;
        }

        const wheels = new THREE.InstancedMesh(wheelGeo, kitMaterial, built.wheels.length);
        const m = new THREE.Matrix4();
        built.wheels.forEach(([x, y, z], i) => {
          wheels.setMatrixAt(i, m.makeTranslation(x, y, z));
        });
        wheels.instanceMatrix.needsUpdate = true;
        group.add(bodyMesh, gateMesh, lampMesh, wheels);

        return {
          root: group,
          dispose: () => {
            bodyGeo.dispose();
            gateGeo.dispose();
            lampGeo.dispose();
            wheelGeo.dispose();
            lampMat.dispose();
          },
        };
      },
    });
  }

  entries.push({
    id: 'vehicle:helicopter',
    library: 'game',
    name: 'Patrol & Airlift Helicopter',
    category: 'vehicles',
    subcategory: 'Aircraft & Drones',
    tags: ['vehicle', 'aircraft', 'escape', 'animated'],
    sourceFile: 'src/render/huntModels.ts',
    builderName: 'heliModel(paintC)',
    description: 'Helicopter with cockpit glass, landing skids, spinning main rotor, and tail rotor.',
    footprint: [3, 4],
    variants: [
      {
        key: 'liveries',
        label: 'Livery Paint',
        kind: 'select',
        options: [
          { value: 0x2c4a6e, label: 'Police / Irongate Navy' },
          { value: 0x3b4d3a, label: 'Search & Rescue Olive' },
          { value: 0xc83e2b, label: 'Coast Guard Red' },
        ],
        defaultValue: 0x2c4a6e,
      },
    ],
    build: (ctx: BuildContext): BuiltModel => {
      const paintC = Number(ctx.variants.liveries ?? 0x2c4a6e);
      const h = heliModel(paintC);
      const group = new THREE.Group();
      group.add(h.body, h.rotor, h.tail);
      return {
        root: group,
        animate: (t) => {
          h.rotor.rotation.y = t * 14;
          h.tail.rotation.x = t * 22;
        },
        dispose: () => {
          h.body.geometry.dispose();
          h.rotor.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
          h.tail.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
        },
      };
    },
  });

  const huntVehicles: Array<{
    id: string;
    name: string;
    desc: string;
    buildGeo: () => THREE.BufferGeometry;
    footprint: [number, number];
    tags: string[];
  }> = [
    {
      id: 'van',
      name: "Searchers' & Stowaway Van",
      desc: 'White panel van with blue stripe and headlamps.',
      buildGeo: () => vanGeometry(),
      footprint: [2, 3],
      tags: ['vehicle', 'manhunt'],
    },
    {
      id: 'bus',
      name: 'Country Bus (Yellow)',
      desc: 'Yellow passenger bus at the country bus stop.',
      buildGeo: () => vehicleGeometry('bus'),
      footprint: [2, 5],
      tags: ['vehicle', 'manhunt', 'escape'],
    },
    {
      id: 'coach',
      name: 'Long-Distance Coach (Blue)',
      desc: 'Blue highway coach at the town terminal.',
      buildGeo: () => vehicleGeometry('coach'),
      footprint: [2, 5],
      tags: ['vehicle', 'manhunt', 'escape'],
    },
    {
      id: 'rig_truck',
      name: 'Highway Semi Rig Truck',
      desc: 'Red cab tractor-trailer rig with chrome exhaust stack.',
      buildGeo: () => vehicleGeometry('truck'),
      footprint: [2, 5],
      tags: ['vehicle', 'manhunt', 'escape'],
    },
    {
      id: 'boxcar_train',
      name: 'Freight Boxcar Train',
      desc: 'Rust-red railway boxcar with open sliding door.',
      buildGeo: () => vehicleGeometry('train'),
      footprint: [2, 5],
      tags: ['vehicle', 'train', 'manhunt', 'escape'],
    },
    {
      id: 'timber_train',
      name: 'Sawmill Timber Train (Six Hunter)',
      desc: 'Green shunting locomotive pulling two flatcars stacked with chained logs.',
      buildGeo: () => vehicleGeometry('train', 'forest'),
      footprint: [2, 6],
      tags: ['vehicle', 'train', 'six-hunter', 'escape'],
    },
    {
      id: 'border_post',
      name: 'Frontier Border Crossing Barrier & Sign',
      desc: 'Red-and-white striped road barrier pole, frontier sign, and flag.',
      buildGeo: () => vehicleGeometry('border'),
      footprint: [3, 2],
      tags: ['vehicle', 'checkpoint', 'manhunt'],
    },
  ];

  for (const v of huntVehicles) {
    entries.push({
      id: `vehicle:${v.id}`,
      library: 'game',
      name: v.name,
      category: 'vehicles',
      subcategory: 'Manhunt & Safe-Point Vehicles',
      tags: v.tags,
      sourceFile: 'src/render/huntModels.ts',
      builderName: `vehicleGeometry('${v.id}')`,
      description: v.desc,
      footprint: v.footprint,
      build: (): BuiltModel => {
        const geo = v.buildGeo();
        const mesh = new THREE.Mesh(geo, kitMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        const group = new THREE.Group();
        group.add(mesh);
        return { root: group, dispose: () => geo.dispose() };
      },
    });
  }

  entries.push(
    {
      id: 'vehicle:getaway_car',
      library: 'game',
      name: "Lou's Getaway Sedan",
      category: 'vehicles',
      subcategory: 'Escape Craft',
      tags: ['vehicle', 'car', 'escape', 'lit-at-night'],
      sourceFile: 'src/render/Phone.ts',
      builderName: 'carParts()',
      description: 'Two-tone cherry red sedan with cream roof, chrome bumpers, cabin glass, and headlamps.',
      footprint: [2, 3],
      build: (): BuiltModel => {
        const parts = carParts();
        const bodyGeo = merge(parts.body);
        const glassGeo = merge(parts.glass, false);
        const lampsGeo = merge(parts.lamps, false);
        const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
        const group = new THREE.Group();
        const b = new THREE.Mesh(bodyGeo, kitMaterial);
        b.castShadow = b.receiveShadow = true;
        group.add(b, new THREE.Mesh(glassGeo, kitMaterial), new THREE.Mesh(lampsGeo, lampMat));
        return {
          root: group,
          dispose: () => {
            bodyGeo.dispose();
            glassGeo.dispose();
            lampsGeo.dispose();
            lampMat.dispose();
          },
        };
      },
    },
    {
      id: 'vehicle:hang_glider',
      library: 'game',
      name: 'Balsa & Sheet Hang Glider',
      category: 'vehicles',
      subcategory: 'Escape Craft',
      tags: ['vehicle', 'aircraft', 'escape'],
      sourceFile: 'src/render/Getaway.ts',
      builderName: 'wingGeometry()',
      description: 'Delta-wing glider crafted from bed sheets and balsa spars with A-frame control bar.',
      footprint: [3, 2],
      build: (): BuiltModel => {
        const geo = wingGeometry();
        const mesh = new THREE.Mesh(geo, kitMaterial);
        mesh.position.y = 0.85;
        mesh.castShadow = true;
        const group = new THREE.Group();
        group.add(mesh);
        return {
          root: group,
          animate: (t) => {
            mesh.position.y = 0.85 + Math.sin(t * 2) * 0.06;
            mesh.rotation.z = Math.sin(t * 1.5) * 0.06;
          },
          dispose: () => geo.dispose(),
        };
      },
    },
    {
      id: 'vehicle:smuggling_drone',
      library: 'game',
      name: 'Smuggling Quadcopter Drone (with Parcel)',
      category: 'vehicles',
      subcategory: 'Aircraft & Drones',
      tags: ['vehicle', 'aircraft', 'contraband', 'animated'],
      sourceFile: 'src/render/Smuggling.ts',
      builderName: 'droneGeometry() + rotorGeometry() + parcelGeometry()',
      description: 'Four-rotor smuggling drone with blinking port/starboard nav lights and taped contraband parcel.',
      footprint: [1, 1],
      variants: [
        {
          key: 'carryParcel',
          label: 'Slung Contraband Parcel',
          kind: 'boolean',
          defaultValue: true,
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const dGeo = droneGeometry();
        const lGeo = droneLightsGeometry();
        const rGeo = droneRotorGeometry();
        const pGeo = droneParcelGeometry();
        const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

        const group = new THREE.Group();
        const hover = new THREE.Group();
        hover.position.y = 0.7;
        hover.add(new THREE.Mesh(dGeo, kitMaterial), new THREE.Mesh(lGeo, lightMat));

        const rotors: THREE.Mesh[] = [];
        for (const [sx, sz] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const r = new THREE.Mesh(rGeo, kitMaterial);
          r.position.set(sx * 0.34, 0.1, sz * 0.34);
          hover.add(r);
          rotors.push(r);
        }
        if (ctx.variants.carryParcel !== false) {
          hover.add(new THREE.Mesh(pGeo, kitMaterial));
        }
        group.add(hover);

        return {
          root: group,
          animate: (t) => {
            hover.position.y = 0.7 + Math.sin(t * 3.5) * 0.05;
            for (const r of rotors) r.rotation.y = t * 25;
          },
          dispose: () => {
            dGeo.dispose();
            lGeo.dispose();
            rGeo.dispose();
            pGeo.dispose();
            lightMat.dispose();
          },
        };
      },
    },
  );

  return entries;
}

function buildFixtureEntries(): ModelEntry[] {
  const entries: ModelEntry[] = [
    {
      id: 'fixture:pay_phone',
      library: 'game',
      name: 'Wall Pay Phone Booth',
      category: 'fixtures',
      subcategory: 'Comms & Kiosks',
      tags: ['fixture', 'interactive', 'wall-mounted', 'phone'],
      sourceFile: 'src/render/Phone.ts',
      builderName: 'phoneParts()',
      description: 'Brushed-steel acoustic hood, coin box with 12-button keypad, chrome cradle, and coiled handset.',
      footprint: [1, 1],
      wallMounted: true,
      variants: [
        {
          key: 'offHook',
          label: 'Handset Off Hook',
          kind: 'boolean',
          defaultValue: false,
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const p = phoneParts();
        const off = Boolean(ctx.variants.offHook);
        const geo = merge([...p.body, ...(off ? p.out : p.handset)]);
        const m = new THREE.Mesh(geo, kitMaterial);
        m.position.z = -0.48;
        m.castShadow = true;
        const g = new THREE.Group();
        g.add(m);
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'fixture:internet_kiosk',
      library: 'game',
      name: 'Internet Kiosk Terminal',
      category: 'fixtures',
      subcategory: 'Comms & Kiosks',
      tags: ['fixture', 'interactive', 'wall-mounted', 'electric'],
      sourceFile: 'src/render/Kiosk.ts',
      builderName: 'kioskBodyParts() + kioskHeadParts()',
      description: 'Wall-bolted steel pedestal with keyboard shelf, trackball, card slot, and tilted CRT/LCD screen head.',
      footprint: [1, 1],
      wallMounted: true,
      build: (): BuiltModel => {
        const bodyGeo = merge(kioskBodyParts());
        const headGeo = merge(kioskHeadParts(), false);
        const g = new THREE.Group();
        const body = new THREE.Mesh(bodyGeo, kitMaterial);
        const head = new THREE.Mesh(headGeo, kitMaterial);
        head.position.y = 0.84;
        head.rotation.x = -0.2;
        const sub = new THREE.Group();
        sub.position.z = -0.48;
        sub.add(body, head);
        g.add(sub);
        return {
          root: g,
          dispose: () => {
            bodyGeo.dispose();
            headGeo.dispose();
          },
        };
      },
    },
    {
      id: 'fixture:odd_jobs_board',
      library: 'game',
      name: 'Odd Jobs Cork Board & Pinned Cards',
      category: 'fixtures',
      subcategory: 'Boards & Podiums',
      tags: ['fixture', 'interactive', 'wall-mounted', 'jobs'],
      sourceFile: 'src/render/OddJobs.ts',
      builderName: 'oddJobsBoardParts() + oddJobsCardParts()',
      description: 'Canteen wall cork board with green header strip, three daily job cards, story manila card, and active red tag.',
      footprint: [2, 1],
      wallMounted: true,
      build: (): BuiltModel => {
        const g = new THREE.Group();
        const holder = new THREE.Group();
        holder.position.z = -0.48;
        const bGeo = merge(oddJobsBoardParts());
        holder.add(new THREE.Mesh(bGeo, kitMaterial));
        const geos = [bGeo];
        for (const c of ODD_JOBS_CARDS) {
          const cGeo = merge(oddJobsCardParts(c), false);
          geos.push(cGeo);
          const m = new THREE.Mesh(cGeo, kitMaterial);
          m.position.set(c.x, c.y, 0.064);
          m.rotation.z = c.tilt;
          holder.add(m);
        }
        const tGeo = merge(oddJobsTagParts(), false);
        geos.push(tGeo);
        holder.add(new THREE.Mesh(tGeo, kitMaterial));
        g.add(holder);
        return { root: g, dispose: () => geos.forEach((x) => x.dispose()) };
      },
    },
    {
      id: 'fixture:release_desk',
      library: 'game',
      name: 'Release Point Podium & Lamp',
      category: 'fixtures',
      subcategory: 'Boards & Podiums',
      tags: ['fixture', 'interactive', 'lit-at-night'],
      sourceFile: 'src/render/Release.ts',
      builderName: 'releaseDeskParts()',
      description: 'Steel podium with sloped top, forms in-tray, navy exit arrow sign, and status beacon lamp.',
      footprint: [1, 1],
      variants: [
        {
          key: 'status',
          label: 'Beacon Lamp Status',
          kind: 'select',
          options: [
            { value: 'freed', label: 'Cleared / Freed (Green)' },
            { value: 'called', label: 'Name Called (Amber)' },
            { value: 'off', label: 'Standby (Off)' },
          ],
          defaultValue: 'freed',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const geo = merge(releaseDeskParts());
        const st = String(ctx.variants.status ?? 'freed');
        const lampColor = st === 'freed' ? 0x5fe08a : st === 'called' ? 0xffb84a : 0x4a4f57;
        const lampGeo = new THREE.SphereGeometry(0.065, 14, 10);
        const lampMat = new THREE.MeshBasicMaterial({ color: lampColor, toneMapped: false });
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(0, 1.74, -0.1);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, kitMaterial), lamp);
        return {
          root: g,
          dispose: () => {
            geo.dispose();
            lampGeo.dispose();
            lampMat.dispose();
          },
        };
      },
    },
    {
      id: 'fixture:talent_stage',
      library: 'game',
      name: 'Talent Night Stage, Mic Stand & String Lights',
      category: 'fixtures',
      subcategory: 'Side Games & Nights',
      tags: ['fixture', 'event', 'lit-at-night', 'music'],
      sourceFile: 'src/render/Nights.ts',
      builderName: 'NightsView.buildStage()',
      description: 'Three-by-two plank stage with brass trim, microphone stand, twin speakers, and colourful string bulbs.',
      footprint: [3, 2],
      build: (): BuiltModel => {
        const BULBS = [0xffd166, 0xff6fb5, 0x5fd3ff, 0x7ed957, 0xff9f43, 0xb38cff, 0xffd166, 0xff6fb5, 0x5fd3ff];
        const bulbY = (x: number) => 1.66 - 0.12 * (1 - (x / 1.3) ** 2);
        const boards = [
          ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => box(0.3, 0.02, 1.96, k % 2 ? 0x8a5a33 : 0x9c6a3e, -1.35 + k * 0.3, 0, 0)),
          box(3, 0.03, 0.05, 0xd9a441, 0, 0, 0.97),
          cyl(0.13, 0.02, 0x2b2e34, 0.62, 0.02, 0.05, 12),
          cyl(0.016, 0.88, 0x9aa2ad, 0.62, 0.02, 0.05, 6),
          rod(0.016, 0.2, 0x9aa2ad, 0.52, 0.9, 0.0),
          cyl(0.04, 0.09, 0x2b2e34, 0.42, 0.86, -0.05, 8),
          cyl(0.035, 1.8, 0x3b3f46, -1.42, 0, -0.92, 8),
          cyl(0.035, 1.8, 0x3b3f46, 1.42, 0, -0.92, 8),
          box(0.34, 0.56, 0.26, 0x22252b, -1.18, 0.02, -0.82),
          box(0.34, 0.56, 0.26, 0x22252b, 1.18, 0.02, -0.82),
          box(0.2, 0.2, 0.02, 0x5a5f69, -1.18, 0.31, -0.68),
          box(0.2, 0.2, 0.02, 0x5a5f69, 1.18, 0.31, -0.68),
          rod(0.008, 2.84, 0x2b2e34, 0, 1.74, -0.92),
          ...BULBS.map((c, k) => {
            const x = -1.3 + (k * 2.6) / (BULBS.length - 1);
            const y = bulbY(x);
            return paint(new THREE.SphereGeometry(0.06, 8, 6).translate(x, y - 0.04, -0.92), c);
          }),
        ];
        const geo = merge(boards);
        const m = new THREE.Mesh(geo, kitMaterial);
        m.castShadow = m.receiveShadow = true;
        const g = new THREE.Group();
        g.add(m);
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'fixture:quiz_buzzer',
      library: 'game',
      name: 'Quiz Night Contestant Buzzer Podium',
      category: 'fixtures',
      subcategory: 'Side Games & Nights',
      tags: ['fixture', 'event', 'lit-at-night'],
      sourceFile: 'src/render/Nights.ts',
      builderName: 'NightsView.buildQuiz()',
      description: 'Contestant podium with dome buzzer button (lights yellow on buzz, green for right, red for wrong).',
      footprint: [1, 1],
      build: (): BuiltModel => {
        const geo = merge([
          box(0.28, 0.04, 0.28, 0x2b2e34, 0, 0, 0),
          cyl(0.04, 0.72, 0x3b3f46, 0, 0.04, 0, 8),
          box(0.32, 0.06, 0.26, 0x6e4a2b, 0, 0.76, 0),
          paint(new THREE.SphereGeometry(0.075, 10, 8).scale(1, 0.55, 1).translate(0, 0.83, 0), 0xffe066),
        ]);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, kitMaterial));
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'fixture:garden_bed',
      library: 'game',
      name: 'Garden Plot, Growing Plant & Ripe Crop',
      category: 'fixtures',
      subcategory: 'Side Games & Nights',
      tags: ['fixture', 'garden', 'interactive'],
      sourceFile: 'src/render/Long.ts',
      builderName: 'plantGeometry() + cropGeometry()',
      description: 'Tilled soil garden bed with furrowed rows, leafy plant stem, and ripe fruit.',
      footprint: [1, 1],
      build: (): BuiltModel => {
        const soilGeo = merge([
          box(0.84, 0.04, 0.84, 0x7a5536, 0, 0, 0),
          ...[-0.26, 0, 0.26].map((z) => box(0.76, 0.025, 0.1, 0x4a3220, 0, 0.04, z)),
        ]);
        const pGeo = plantGeometry();
        const cGeo = cropGeometry();
        const pMat = kitMaterial.clone();
        pMat.color.setHex(0x4f9a3a);
        const cMat = kitMaterial.clone();
        cMat.color.setHex(0xd8344a);
        const plant = new THREE.Mesh(pGeo, pMat);
        const crop = new THREE.Mesh(cGeo, cMat);
        plant.scale.setScalar(1.35);
        crop.scale.setScalar(1.35);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(soilGeo, kitMaterial), plant, crop);
        return {
          root: g,
          dispose: () => {
            soilGeo.dispose();
            pGeo.dispose();
            cGeo.dispose();
            pMat.dispose();
            cMat.dispose();
          },
        };
      },
    },
    {
      id: 'fixture:rat_lap_track',
      library: 'game',
      name: 'Pet Rat Home Exercise Track',
      category: 'fixtures',
      subcategory: 'Side Games & Nights',
      tags: ['fixture', 'rat', 'interactive'],
      sourceFile: 'src/render/Long.ts',
      builderName: 'lapTrackGeometry()',
      description: 'Oval track of taped magazine pages where the player trains their pet rat.',
      footprint: [1, 1],
      build: (): BuiltModel => {
        const geo = lapTrackGeometry();
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, kitMaterial));
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'fixture:pastimes_set',
      library: 'game',
      name: 'Pastimes Set (Basketball, Dice, Cards & Checkers)',
      category: 'fixtures',
      subcategory: 'Side Games & Nights',
      tags: ['fixture', 'games', 'interactive'],
      sourceFile: 'src/render/Pastimes.ts',
      builderName: 'ballTexture() + boardTexture() + cardGeometry() + diceTexture()',
      description: 'The yard & common-room side-game pieces: seamed basketball, checkers board, playing cards, and dice.',
      footprint: [2, 1],
      build: (): BuiltModel => {
        const g = new THREE.Group();
        const hasDom = typeof document !== 'undefined';
        const bTex = hasDom ? boardTexture() : null;
        const bMat = new THREE.MeshStandardMaterial({ map: bTex, color: bTex ? 0xffffff : 0x5c3e26, roughness: 0.8 });
        const bGeo = new THREE.BoxGeometry(0.62, 0.03, 0.62);
        const board = new THREE.Mesh(bGeo, bMat);
        board.position.set(-0.35, 0.015, 0);

        const ballTex = hasDom ? ballTexture() : null;
        const ballMat = new THREE.MeshStandardMaterial({ map: ballTex, color: ballTex ? 0xffffff : 0xd4622a, roughness: 0.7 });
        const ballGeo = new THREE.SphereGeometry(0.14, 16, 12);
        const ball = new THREE.Mesh(ballGeo, ballMat);
        ball.position.set(0.35, 0.14, -0.18);

        const cTex = hasDom ? cardTexture() : null;
        const cMat = new THREE.MeshStandardMaterial({ map: cTex, color: cTex ? 0xffffff : 0xf2eee4, roughness: 0.8 });
        const cGeo = cardGeometry(1);
        const card = new THREE.Mesh(cGeo, cMat);
        card.position.set(0.25, 0.02, 0.2);

        const dTex = hasDom ? diceTexture() : null;
        const dMat = new THREE.MeshStandardMaterial({ map: dTex, color: dTex ? 0xffffff : 0xf4efe2, roughness: 0.5 });
        const dGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
        const die = new THREE.Mesh(dGeo, dMat);
        die.position.set(0.5, 0.07, 0.2);

        g.add(board, ball, card, die);
        return {
          root: g,
          dispose: () => {
            bGeo.dispose();
            ballGeo.dispose();
            cGeo.dispose();
            dGeo.dispose();
            bTex?.dispose();
            ballTex?.dispose();
            cTex?.dispose();
            dTex?.dispose();
            bMat.dispose();
            ballMat.dispose();
            cMat.dispose();
            dMat.dispose();
          },
        };
      },
    },
  ];

  const holidays: Array<{
    id: string;
    name: string;
    desc: string;
    wall?: boolean;
    buildParts: () => { out: Part[]; glow: Part[] };
  }> = [
    {
      id: 'christmas_tree',
      name: 'Holiday: Christmas Tree & Wrapped Gifts',
      desc: 'Three-tier pine tree topped with a golden octahedron star, 14 coloured fairy lights, and wrapped presents.',
      buildParts: () => {
        const out: Part[] = [];
        const glow: Part[] = [];
        holidayTree(out, glow, 0, 0);
        return { out, glow };
      },
    },
    {
      id: 'snowman',
      name: 'Holiday: Yard Snowman (in Santa Hat)',
      desc: 'Three-sphere snowman (or desert sandman) with coal eyes, carrot nose, scarf, and red Santa hat.',
      buildParts: () => {
        const out: Part[] = [];
        snowman(out, 0, 0, false);
        return { out, glow: [] };
      },
    },
    {
      id: 'jack_o_lantern',
      name: "Holiday: Halloween Jack-o'-Lantern",
      desc: 'Carved orange pumpkin with glowing eyes and grin.',
      buildParts: () => {
        const out: Part[] = [];
        const glow: Part[] = [];
        holidayLantern(out, glow, 0, 0, 0, 1.8);
        return { out, glow };
      },
    },
    {
      id: 'barbecue',
      name: 'Holiday: Summer Yard Barbecue Grill',
      desc: 'Charcoal grill on four legs with glowing orange coals and sizzling sausages.',
      buildParts: () => {
        const out: Part[] = [];
        const glow: Part[] = [];
        barbecue(out, glow, 0, 0);
        return { out, glow };
      },
    },
    {
      id: 'hose_reel',
      name: 'Holiday: Summer Garden Hose & Sprinkler Stake',
      desc: 'Standpipe tap, wall-mounted green hose reel, and brass nozzle on a wooden stake.',
      buildParts: () => {
        const out: Part[] = [];
        hoseReel(out, 0, 0.2, 0, 1);
        return { out, glow: [] };
      },
    },
    {
      id: 'easter_basket',
      name: 'Holiday: Easter Basket of Painted Eggs',
      desc: 'Woven basket with handle holding four pastel-painted Easter eggs.',
      buildParts: () => {
        const out: Part[] = [];
        holidayBasket(out, 0, 0);
        for (const p of out) p.translate(0, -0.52, 0);
        return { out, glow: [] };
      },
    },
    {
      id: 'garland',
      name: 'Holiday: Wall Pennant Garland / Fairy Lights',
      desc: 'Festive bunting flags and string bulbs hung across canteen and yard walls.',
      wall: true,
      buildParts: () => {
        const out: Part[] = [];
        garland(out, { what: 'garland', x: -1, x1: 1, z: -0.5 }, BRIGHT, false);
        garland(out, { what: 'garland', x: -1, x1: 1, z: -0.35 }, LIGHTS, true);
        return { out, glow: [] };
      },
    },
  ];

  for (const h of holidays) {
    entries.push({
      id: `fixture:holiday_${h.id}`,
      library: 'game',
      name: h.name,
      category: 'fixtures',
      subcategory: 'Seasonal Holiday Decor',
      tags: ['fixture', 'holiday', ...(h.wall ? ['wall-mounted'] : [])],
      sourceFile: 'src/render/holidayModels.ts',
      builderName: `${h.id}()`,
      description: h.desc,
      footprint: [1, 1],
      wallMounted: h.wall,
      build: (): BuiltModel => {
        const { out, glow } = h.buildParts();
        const g = new THREE.Group();
        const bGeo = merge(out, false);
        g.add(new THREE.Mesh(bGeo, kitMaterial));
        let gGeo: THREE.BufferGeometry | null = null;
        let gMat: THREE.MeshBasicMaterial | null = null;
        if (glow.length) {
          gGeo = merge(glow, false);
          gMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
          g.add(new THREE.Mesh(gGeo, gMat));
        }
        return {
          root: g,
          dispose: () => {
            bGeo.dispose();
            gGeo?.dispose();
            gMat?.dispose();
          },
        };
      },
    });
  }

  return entries;
}

function buildArchitectureEntries(): ModelEntry[] {
  const themes: Array<{ value: Theme; label: string }> = [
    { value: 'suburban', label: 'Suburban (Center Perks)' },
    { value: 'alpine', label: 'Alpine Snow (Stalag Flucht)' },
    { value: 'industrial', label: 'Industrial (Shankton State)' },
    { value: 'desert', label: 'Desert Adobe (San Pancho)' },
    { value: 'island', label: 'Island Granite (HMP Irongate)' },
    { value: 'forest', label: 'Pine Forest (The Six Hunter)' },
  ];

  const entries: ModelEntry[] = [
    {
      id: 'arch:wall_brick',
      library: 'game',
      name: 'Prison Wall Block (Theme-Textured)',
      category: 'architecture',
      subcategory: 'Walls, Fences & Doors',
      tags: ['architecture', 'wall', 'theme-aware'],
      sourceFile: 'src/render/WorldView.ts',
      builderName: 'wallBlock() + TEX.brick()',
      description: 'Two-group wall block (sides + raised cap stone) with procedural pixel-art textures for all 6 prison themes.',
      footprint: [1, 1],
      variants: [
        { key: 'theme', label: 'Prison Theme', kind: 'select', options: themes, defaultValue: 'suburban' },
        {
          key: 'reinforced',
          label: 'Reinforced / Fieldstone Wall',
          kind: 'boolean',
          defaultValue: false,
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const prev = currentTheme();
        const th = (ctx.variants.theme ?? 'suburban') as Theme;
        const reinf = Boolean(ctx.variants.reinforced);
        setTheme(th);
        const geo = wallBlock();
        geo.translate(0, WALL_H / 2, 0);
        const sideTex = (reinf ? TEX.reinforced() : TEX.brick()).clone();
        sideTex.repeat.set(1, WALL_H);
        sideTex.needsUpdate = true;
        const topTex = reinf ? (th === 'forest' ? stoneCap() : TEX.reinforced()) : TEX.wallTop();
        const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 });
        const topMat = new THREE.MeshStandardMaterial({
          map: topTex,
          color: reinf && th !== 'forest' ? 0xc4c4c4 : 0xffffff,
          roughness: 0.9,
        });
        setTheme(prev);
        const m = new THREE.Mesh(geo, [sideMat, topMat]);
        m.castShadow = m.receiveShadow = true;
        const g = new THREE.Group();
        g.add(m);
        return {
          root: g,
          dispose: () => {
            geo.dispose();
            sideTex.dispose();
            sideMat.dispose();
            topMat.dispose();
          },
        };
      },
    },
    {
      id: 'arch:fence',
      library: 'game',
      name: 'Perimeter Fence & Razor Wire Coil',
      category: 'architecture',
      subcategory: 'Walls, Fences & Doors',
      tags: ['architecture', 'fence', 'security', 'escape'],
      sourceFile: 'src/render/WorldView.ts',
      builderName: 'WorldView.buildFences()',
      description: 'Chain-link, electrified, or Six Hunter timber deer fence topped with coiled razor wire.',
      footprint: [2, 1],
      variants: [
        {
          key: 'kind',
          label: 'Fence Type',
          kind: 'select',
          options: [
            { value: 'standard', label: 'Standard Chain-Link Fence' },
            { value: 'electric', label: 'Electrified Perimeter Fence' },
            { value: 'forest', label: 'Six Hunter Timber Deer Fence' },
          ],
          defaultValue: 'standard',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const k = String(ctx.variants.kind ?? 'standard');
        const prev = currentTheme();
        setTheme(k === 'forest' ? 'forest' : 'suburban');
        const tex = TEX.fence().clone();
        tex.needsUpdate = true;
        setTheme(prev);

        const h = 1.8;
        const g = new THREE.Group();
        const panelGeo = new THREE.PlaneGeometry(2, h);
        panelGeo.translate(0, h / 2, 0);
        const panelMat = new THREE.MeshStandardMaterial({
          map: tex,
          color: k === 'electric' ? 0xffeb8a : 0xffffff,
          emissive: k === 'electric' ? 0x2a2200 : 0x000000,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
          roughness: 0.5,
          metalness: 0.5,
        });
        g.add(new THREE.Mesh(panelGeo, panelMat));

        const postParts: Part[] = [];
        for (const x of [-1, 0, 1]) {
          postParts.push(k === 'forest' ? cyl(0.065, h + 0.15, 0x6a5038, x, 0, 0, 6) : box(0.09, h + 0.15, 0.09, 0x7d858f, x, 0, 0));
        }
        for (const x of [-0.75, -0.25, 0.25, 0.75]) {
          postParts.push(paint(new THREE.TorusGeometry(0.17, 0.014, 4, 10).rotateY(Math.PI / 2).translate(x, h + 0.12, 0), 0xb8c0ca));
        }
        const postGeo = merge(postParts, false);
        g.add(new THREE.Mesh(postGeo, kitMaterial));

        return {
          root: g,
          dispose: () => {
            panelGeo.dispose();
            panelMat.dispose();
            tex.dispose();
            postGeo.dispose();
          },
        };
      },
    },
    {
      id: 'arch:door',
      library: 'game',
      name: 'Prison Door (Cell Bars & Keyed Security Slabs)',
      category: 'architecture',
      subcategory: 'Walls, Fences & Doors',
      tags: ['architecture', 'door', 'security', 'key'],
      sourceFile: 'src/render/WorldView.ts',
      builderName: 'WorldView.buildDoors()',
      description: 'Sliding prison door leaf and lintel: barred cell/yard gate or steel security slab in all 5 key colors.',
      footprint: [1, 1],
      variants: [
        {
          key: 'style',
          label: 'Door Style & Key Color',
          kind: 'select',
          options: [
            { value: 'bars_open', label: 'Cell Door (Grey Bars)' },
            { value: 'bars_yellow', label: 'Cell / Yard Gate (Yellow Key Bars)' },
            { value: 'slab_cyan', label: 'Work Door (Cyan Key Slab)' },
            { value: 'slab_purple', label: 'Utility Door (Purple Key Slab)' },
            { value: 'slab_red', label: 'Security Door (Red Key Slab)' },
            { value: 'slab_green', label: 'Staff / Perimeter Door (Green Key Slab)' },
          ],
          defaultValue: 'bars_yellow',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const st = String(ctx.variants.style ?? 'bars_yellow');
        const colorMap: Record<string, number> = {
          bars_open: 0x888888,
          bars_yellow: 0xe8b828,
          slab_cyan: 0x2fb6c8,
          slab_purple: 0x8e4fc4,
          slab_red: 0xd23f36,
          slab_green: 0x36a447,
        };
        const c = colorMap[st] ?? 0xe8b828;
        const leafH = WALL_H * 0.86;
        const parts: Part[] = [box(1, WALL_H - leafH, 0.34, 0x4a515c, 0, leafH, 0)];
        if (st.startsWith('bars')) {
          parts.push(
            box(0.96, 0.07, 0.07, c, 0, 0, 0),
            box(0.96, 0.07, 0.07, c, 0, leafH - 0.07, 0),
            box(0.96, 0.05, 0.05, c, 0, leafH * 0.45, 0),
          );
          for (let b = 0; b < 6; b++) parts.push(cyl(0.025, leafH, c, -0.4 + b * 0.16, 0, 0, 6));
        } else {
          parts.push(
            box(0.96, leafH, 0.1, 0x9aa2ad, 0, 0, 0),
            box(0.97, 0.16, 0.12, c, 0, leafH * 0.32 - 0.08, 0),
            box(0.3, 0.22, 0.12, 0x24303d, 0, leafH * 0.72 - 0.11, 0),
          );
        }
        const geo = merge(parts);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, kitMaterial));
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'arch:detector_arch',
      library: 'game',
      name: 'Contraband Metal Detector Arch',
      category: 'architecture',
      subcategory: 'Walls, Fences & Doors',
      tags: ['architecture', 'security', 'contraband', 'electric'],
      sourceFile: 'src/render/WorldView.ts',
      builderName: 'WorldView.buildDetectors()',
      description: 'Walk-through metal detector arch with top status beacon (green when powered, flashes red when tripped).',
      footprint: [1, 1],
      build: (): BuiltModel => {
        const geo = merge([
          box(0.12, 1.25, 0.24, 0xb4bcc6, -0.44, 0, 0),
          box(0.12, 1.25, 0.24, 0xb4bcc6, 0.44, 0, 0),
          box(1, 0.16, 0.26, 0xb4bcc6, 0, 1.22, 0),
          box(0.14, 0.06, 0.1, 0x3fb950, 0, 1.38, 0),
        ]);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, kitMaterial));
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'arch:watchtower',
      library: 'game',
      name: 'Guard Watchtower & Forest Hunting Stand',
      category: 'architecture',
      subcategory: 'Towers & Buildings',
      tags: ['architecture', 'tower', 'security', 'six-hunter'],
      sourceFile: 'src/render/WorldView.ts',
      builderName: 'WorldView.buildTowers()',
      description: 'Perimeter sniper/searchlight watchtower (concrete & steel or Six Hunter splayed timber hunting stand).',
      footprint: [3, 3],
      variants: [
        {
          key: 'style',
          label: 'Tower Architecture',
          kind: 'select',
          options: [
            { value: 'classic', label: 'Guard Watchtower (Classic)' },
            { value: 'forest', label: 'Timber Hunting Stand (Six Hunter)' },
          ],
          defaultValue: 'classic',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const stand = ctx.variants.style === 'forest';
        const w = 3;
        const d = 3;
        const H = 4.2;
        const parts: Part[] = [];
        if (stand) {
          const wood = 0x5e4630;
          const cabinC = 0x7d5c3e;
          for (const [sx, sz] of [
            [-w / 2 + 0.25, -d / 2 + 0.25],
            [w / 2 - 0.25, -d / 2 + 0.25],
            [-w / 2 + 0.25, d / 2 - 0.25],
            [w / 2 - 0.25, d / 2 - 0.25],
          ]) {
            parts.push(
              paint(
                new THREE.CylinderGeometry(0.1, 0.14, H, 6)
                  .rotateZ((sx < 0 ? 1 : -1) * 0.06)
                  .rotateX((sz < 0 ? -1 : 1) * 0.06)
                  .translate(sx, H / 2, sz),
                wood,
              ),
            );
          }
          for (const y of [1.2, 2.6]) {
            parts.push(
              box(w - 0.3, 0.09, 0.09, wood, 0, y, -d / 2 + 0.25),
              box(0.09, 0.09, d - 0.3, -w / 2 + 0.25, y + 0.5, 0),
              box(0.09, 0.09, d - 0.3, w / 2 - 0.25, y + 0.5, 0),
            );
          }
          parts.push(box(w + 0.3, 0.15, d + 0.3, wood, 0, H - 0.075, 0));
          const cw = w - 1.0;
          const cd = d - 1.0;
          parts.push(box(cw, 0.62, cd, cabinC, 0, H + 0.07, 0));
          for (const [cx, cz] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ]) {
            parts.push(box(0.1, 1.15, 0.1, cabinC, (cx * (cw - 0.1)) / 2, H + 0.4, (cz * (cd - 0.1)) / 2));
          }
          const r = (Math.max(cw, cd) / 2 + 0.2) * Math.SQRT2;
          parts.push(paint(new THREE.ConeGeometry(r, 0.7, 4).rotateY(Math.PI / 4).translate(0, H + 1.9, 0), 0x5b5044));
        } else {
          for (const [sx, sz] of [
            [-w / 2 + 0.3, -d / 2 + 0.3],
            [w / 2 - 0.3, -d / 2 + 0.3],
            [-w / 2 + 0.3, d / 2 - 0.3],
            [w / 2 - 0.3, d / 2 - 0.3],
          ]) {
            parts.push(box(0.25, H, 0.25, 0x6b7280, sx, 0, sz));
          }
          for (const y of [1.3, 2.8]) parts.push(box(w - 0.4, 0.08, 0.08, 0x6b7280, 0, y, d / 2 - 0.3));
          parts.push(
            box(w + 0.3, 0.15, d + 0.3, 0x6b7280, 0, H - 0.075, 0),
            box(w - 0.2, 1.3, d - 0.2, 0xc9b99a, 0, H + 0.07, 0),
            box(w - 0.16, 0.5, d - 0.16, 0x223040, 0, H + 0.7, 0),
            paint(new THREE.ConeGeometry(Math.max(w, d) * 0.82, 0.9, 4).rotateY(Math.PI / 4).translate(0, H + 1.82, 0), 0x6e3328),
          );
        }
        const geo = merge(parts);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, kitMaterial));
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'arch:scenery_tree',
      library: 'game',
      name: 'Scenery Tree (Suburban, Alpine, Desert, Scrub, Scots Pine)',
      category: 'architecture',
      subcategory: 'Nature & Trees',
      tags: ['architecture', 'foliage', 'tree', 'theme-aware', 'six-hunter'],
      sourceFile: 'src/render/WorldView.ts',
      builderName: 'sceneryTree(theme) / pine()',
      description: 'Surrounding landscape trees for each biome, including the tall rust-barked Scots Pine of The Six Hunter.',
      footprint: [2, 2],
      variants: [
        {
          key: 'theme',
          label: 'Biome Tree Type',
          kind: 'select',
          options: [
            { value: 'forest', label: 'Scots Pine (The Six Hunter)' },
            { value: 'suburban', label: 'Leafy Deciduous Tree (Center Perks)' },
            { value: 'alpine', label: 'Snow-Tiered Fir (Stalag Flucht)' },
            { value: 'industrial', label: 'Highway Olive Scrub (Shankton)' },
            { value: 'desert', label: 'Giant Saguaro Cactus (San Pancho)' },
          ],
          defaultValue: 'forest',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const th = String(ctx.variants.theme ?? 'forest');
        const geo = th === 'forest' ? pine() : sceneryTree(th);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, kitMaterial));
        return { root: g, dispose: () => geo.dispose() };
      },
    },
    {
      id: 'arch:manhunt_house',
      library: 'game',
      name: 'Manhunt Town Building (House, Barn, Chalet, Shed, Adobe, Terrace)',
      category: 'architecture',
      subcategory: 'Towers & Buildings',
      tags: ['architecture', 'building', 'manhunt', 'theme-aware'],
      sourceFile: 'src/render/huntTown.ts',
      builderName: 'buildHouses(outsideWorld, theme)',
      description: 'Procedural outside buildings with pitched/flat roofs, windows, doors, chimneys, and skylights by prison theme.',
      footprint: [4, 3],
      variants: [
        { key: 'theme', label: 'Town Architecture Style', kind: 'select', options: themes, defaultValue: 'suburban' },
        {
          key: 'size',
          label: 'Building Footprint',
          kind: 'select',
          options: [
            { value: '4x3', label: 'House / Cabin (4 × 3 tiles)' },
            { value: '6x4', label: 'Barn / Warehouse / Terrace Row (6 × 4 tiles)' },
          ],
          defaultValue: '4x3',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const th = String(ctx.variants.theme ?? 'suburban');
        const [bw, bd] = String(ctx.variants.size ?? '4x3')
          .split('x')
          .map(Number);
        const size = MAP_W * MAP_H;
        const base = new Uint8Array(size).fill(TILE.GRASS);
        const kind = new Uint8Array(size).fill(TILE.GRASS);
        const ox = 10;
        const oz = 10;
        for (let z = oz; z < oz + bd; z++) {
          for (let x = ox; x < ox + bw; x++) {
            base[z * MAP_W + x] = TILE.BRICK;
            kind[z * MAP_W + x] = TILE.BRICK;
          }
        }
        for (let x = ox; x < ox + bw; x++) kind[(oz + bd) * MAP_W + x] = TILE.ROAD;

        const mockOutside = {
          world: { ground: { base, kind } } as unknown as World,
          ox: ox - 1,
          oz: oz - 1,
          w: bw + 2,
          h: bd + 2,
          deco: new Uint8Array(size),
          safe: new Uint8Array(size),
        } as unknown as OutsideWorld;
        const built = buildHouses(mockOutside, th);
        built.group.position.set(-(ox + bw / 2), 0, -(oz + bd / 2));
        const wrapper = new THREE.Group();
        wrapper.add(built.group);
        return {
          root: wrapper,
          dispose: () => {
            built.group.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
            built.glass.dispose();
          },
        };
      },
    },
  ];

  return entries;
}

/**
 * Version 2 Foundation: Procedural Kit Library (`kit-library`).
 * Demonstrates browsing a code-generated library of parametric 3D objects built with `src/render/kit.ts`.
 */
function buildKitLibraryEntries(): ModelEntry[] {
  return [
    {
      id: 'lib:guard_booth_modular',
      library: 'kit-library',
      name: 'Modular Security Booth (Parametric)',
      category: 'architecture',
      subcategory: 'V2 Procedural Kit Library',
      tags: ['kit-library', 'parametric', 'security', 'building'],
      sourceFile: 'src/render/kit.ts',
      builderName: 'box() + cyl() + disc() + merge()',
      description: 'Parametric security gatehouse built with kit.ts primitives: adjustable roof overhang, stripe color, and searchlight.',
      footprint: [2, 2],
      variants: [
        {
          key: 'accent',
          label: 'Stripe Color',
          kind: 'color',
          defaultValue: '#2f6fd1',
        },
        {
          key: 'searchlight',
          label: 'Roof Searchlight',
          kind: 'boolean',
          defaultValue: true,
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const accent = parseInt(String(ctx.variants.accent ?? '#2f6fd1').replace('#', ''), 16);
        const hasLight = ctx.variants.searchlight !== false;
        const parts: Part[] = [
          box(1.6, 0.1, 1.6, 0x59606b, 0, 0, 0),
          box(1.4, 1.5, 1.4, 0xd8dde3, 0, 0.1, 0),
          box(1.42, 0.18, 1.42, accent, 0, 0.55, 0),
          box(1.1, 0.5, 1.44, 0x223040, 0, 0.88, 0),
          box(1.44, 0.5, 1.1, 0x223040, 0, 0.88, 0),
          box(1.75, 0.12, 1.75, 0x3b4048, 0, 1.6, 0),
        ];
        if (hasLight) {
          parts.push(
            cyl(0.12, 0.18, 0x2b3038, 0, 1.72, 0, 10),
            cyl(0.18, 0.26, 0x8d949e, 0, 1.9, 0.05, 12),
            disc(0.16, 0.04, 0xffe066, 0, 2.02, 0.18, 12),
          );
        }
        const m = makeKitMesh(parts);
        const g = new THREE.Group();
        g.add(m);
        return {
          root: g,
          recipe: [
            'box(1.6, 0.1, 1.6, 0x59606b) // Concrete plinth',
            'box(1.4, 1.5, 1.4, 0xd8dde3) // Cabin walls',
            'box(1.42, 0.18, 1.42, accent) // Hazard band',
            'box(1.75, 0.12, 1.75, 0x3b4048) // Overhang roof',
          ],
          dispose: () => m.geometry.dispose(),
        };
      },
    },
    {
      id: 'lib:industrial_forklift',
      library: 'kit-library',
      name: 'Warehouse Forklift (Parametric)',
      category: 'vehicles',
      subcategory: 'V2 Procedural Kit Library',
      tags: ['kit-library', 'parametric', 'vehicle', 'industrial'],
      sourceFile: 'src/render/kit.ts',
      builderName: 'box() + rod() + cyl() + merge()',
      description: 'Code-generated warehouse forklift with adjustable mast fork height, pallet load, and body paint.',
      footprint: [2, 2],
      variants: [
        {
          key: 'liftHeight',
          label: 'Fork Lift Height',
          kind: 'select',
          options: [
            { value: 0.12, label: 'Lowered (0.12)' },
            { value: 0.55, label: 'Mid Lift (0.55)' },
            { value: 1.05, label: 'High Lift (1.05)' },
          ],
          defaultValue: 0.55,
        },
        {
          key: 'pallet',
          label: 'Loaded Crate on Forks',
          kind: 'boolean',
          defaultValue: true,
        },
        {
          key: 'paint',
          label: 'Body Paint',
          kind: 'color',
          defaultValue: '#e8b828',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const bodyC = parseInt(String(ctx.variants.paint ?? '#e8b828').replace('#', ''), 16);
        const fy = Number(ctx.variants.liftHeight ?? 0.55);
        const hasPallet = ctx.variants.pallet !== false;
        const parts: Part[] = [
          box(0.95, 0.48, 1.35, bodyC, 0, 0.18, -0.15),
          box(0.9, 0.35, 0.45, 0x3b4048, 0, 0.45, -0.6),
          box(0.38, 0.12, 0.36, 0x1e2228, 0, 0.68, -0.15),
          box(0.38, 0.32, 0.08, 0x1e2228, 0, 0.8, -0.31),
          cyl(0.03, 0.36, 0x2b3038, 0, 0.66, 0.25, 8),
          ...[-0.4, 0.4].flatMap((x) => [
            box(0.05, 0.95, 0.05, 0x2b3038, x, 0.66, 0.35),
            box(0.05, 0.95, 0.05, 0x2b3038, x, 0.66, -0.55),
            box(0.05, 0.05, 0.95, 0x2b3038, x, 1.58, -0.1),
          ]),
          box(0.85, 0.04, 0.95, 0x2b3038, 0, 1.6, -0.1),
          box(0.08, 1.55, 0.08, 0x3b4048, -0.28, 0.15, 0.58),
          box(0.08, 1.55, 0.08, 0x3b4048, 0.28, 0.15, 0.58),
          box(0.64, 0.22, 0.06, 0x59606b, 0, fy, 0.62),
          box(0.1, 0.04, 0.75, 0x8d949e, -0.2, fy, 0.98),
          box(0.1, 0.04, 0.75, 0x8d949e, 0.2, fy, 0.98),
          rod(0.22, 0.18, 0x1a1c20, -0.46, 0.22, 0.3, 12),
          rod(0.22, 0.18, 0x1a1c20, 0.46, 0.22, 0.3, 12),
          rod(0.18, 0.16, 0x1a1c20, -0.44, 0.18, -0.58, 12),
          rod(0.18, 0.16, 0x1a1c20, 0.44, 0.18, -0.58, 12),
        ];
        if (hasPallet) {
          parts.push(
            box(0.76, 0.08, 0.7, 0x8a5a2e, 0, fy + 0.04, 0.98),
            box(0.68, 0.52, 0.62, 0xb8874e, 0, fy + 0.12, 0.98),
            box(0.7, 0.04, 0.64, 0x8a5a2e, 0, fy + 0.36, 0.98),
          );
        }
        const m = makeKitMesh(parts);
        const g = new THREE.Group();
        g.add(m);
        return {
          root: g,
          recipe: [
            'box(0.95, 0.48, 1.35, paint) // Counterweight chassis',
            'box(0.08, 1.55, 0.08, 0x3b4048) × 2 // Twin hydraulic mast rails',
            'box(0.1, 0.04, 0.75, 0x8d949e) × 2 // Steel forks at liftHeight',
            'rod(0.22, 0.18, 0x1a1c20) × 4 // Axles & tires',
          ],
          dispose: () => m.geometry.dispose(),
        };
      },
    },
    {
      id: 'lib:arcade_cabinet',
      library: 'kit-library',
      name: 'Retro Recreation Arcade Cabinet (Parametric)',
      category: 'props',
      subcategory: 'V2 Procedural Kit Library',
      tags: ['kit-library', 'parametric', 'prop', 'electric', 'lit-at-night'],
      sourceFile: 'src/render/kit.ts',
      builderName: 'box() + cyl() + disc() + merge()',
      description: 'Common-room upright arcade machine built from kit.ts primitives with customizable cabinet color and lit marquee.',
      footprint: [1, 1],
      variants: [
        {
          key: 'cabinet',
          label: 'Cabinet Side Color',
          kind: 'color',
          defaultValue: '#2b3a67',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const cab = parseInt(String(ctx.variants.cabinet ?? '#2b3a67').replace('#', ''), 16);
        const parts: Part[] = [
          box(0.68, 0.72, 0.62, cab, 0, 0, 0),
          box(0.68, 0.64, 0.48, cab, 0, 0.72, -0.07),
          box(0.7, 0.08, 0.66, 0x1e2228, 0, 0.68, 0.04),
          cyl(0.015, 0.08, 0x9aa2ad, -0.16, 0.76, 0.22, 6),
          disc(0.03, 0.03, 0xd23f36, -0.16, 0.83, 0.22, 8),
          cyl(0.015, 0.08, 0x9aa2ad, 0.12, 0.76, 0.22, 6),
          disc(0.03, 0.03, 0x3a8ed8, 0.12, 0.83, 0.22, 8),
          box(0.54, 0.38, 0.04, 0x101824, 0, 0.8, 0.16),
          box(0.46, 0.3, 0.045, 0x3fd4b0, 0, 0.84, 0.165),
          box(0.68, 0.16, 0.56, cab, 0, 1.32, -0.03),
          box(0.62, 0.12, 0.03, 0xffd166, 0, 1.34, 0.25),
        ];
        const m = makeKitMesh(parts);
        const g = new THREE.Group();
        g.add(m);
        return {
          root: g,
          recipe: [
            'box(0.68, 0.72, 0.62, cabinet) // Lower coin cabinet',
            'box(0.7, 0.08, 0.66, 0x1e2228) // Control deck',
            'box(0.46, 0.3, 0.045, 0x3fd4b0) // CRT screen bezel',
            'box(0.62, 0.12, 0.03, 0xffd166) // Top marquee header',
          ],
          dispose: () => m.geometry.dispose(),
        };
      },
    },
    {
      id: 'lib:water_tower',
      library: 'kit-library',
      name: 'Timber & Hooped Water Tower (Parametric)',
      category: 'architecture',
      subcategory: 'V2 Procedural Kit Library',
      tags: ['kit-library', 'parametric', 'architecture', 'tower'],
      sourceFile: 'src/render/kit.ts',
      builderName: 'cyl() + box() + ConeGeometry + merge()',
      description: 'Procedural wooden stave water tower on cross-braced timber stilts with iron hoops and conical roof.',
      footprint: [2, 2],
      variants: [
        {
          key: 'wood',
          label: 'Timber Stain',
          kind: 'color',
          defaultValue: '#8a5a36',
        },
      ],
      build: (ctx: BuildContext): BuiltModel => {
        const wood = parseInt(String(ctx.variants.wood ?? '#8a5a36').replace('#', ''), 16);
        const parts: Part[] = [
          ...[-0.55, 0.55].flatMap((sx) => [-0.55, 0.55].map((sz) => cyl(0.08, 1.6, 0x5e422b, sx, 0, sz, 6))),
          box(1.2, 0.07, 0.07, 0x5e422b, 0, 0.75, -0.55),
          box(1.2, 0.07, 0.07, 0x5e422b, 0, 0.75, 0.55),
          box(0.07, 0.07, 1.2, 0x5e422b, -0.55, 0.75, 0),
          box(0.07, 0.07, 1.2, 0x5e422b, 0.55, 0.75, 0),
          cyl(0.82, 0.1, 0x5e422b, 0, 1.55, 0, 14),
          cyl(0.72, 1.25, wood, 0, 1.65, 0, 16),
          ...[1.8, 2.2, 2.6].map((y) => cyl(0.74, 0.04, 0x2b3038, 0, y, 0, 16)),
          paint(new THREE.ConeGeometry(0.84, 0.5, 16).translate(0, 3.15, 0), 0x4a515c),
        ];
        const m = makeKitMesh(parts);
        const g = new THREE.Group();
        g.add(m);
        return {
          root: g,
          recipe: [
            'cyl(0.08, 1.6, 0x5e422b) × 4 // Support stilts',
            'cyl(0.72, 1.25, wood, 0, 1.65, 0, 16) // Stave barrel',
            'cyl(0.74, 0.04, 0x2b3038) × 3 // Iron tension hoops',
            'ConeGeometry(0.84, 0.5, 16) // Conical roof cap',
          ],
          dispose: () => m.geometry.dispose(),
        };
      },
    },
  ];
}

let cachedCatalog: ModelEntry[] | null = null;

/** Returns the full ordered catalog of 3D models. */
export function getCatalog(): ModelEntry[] {
  if (!cachedCatalog) {
    cachedCatalog = [
      ...buildPropEntries(),
      ...buildDecorEntries(),
      ...buildItemEntries(),
      ...buildCharacterEntries(),
      ...buildAnimalEntries(),
      ...buildVehicleEntries(),
      ...buildFixtureEntries(),
      ...buildArchitectureEntries(),
      ...buildKitLibraryEntries(),
    ];
  }
  return cachedCatalog;
}

/** Computes mesh/vertex/triangle counts, bounding box dimensions (in tiles), and extracted vertex color swatches. */
export function computeModelStats(root: THREE.Object3D): ModelStats {
  root.updateMatrixWorld(true);
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  const box3 = new THREE.Box3();
  const colorSet = new Set<string>();
  const tempColor = new THREE.Color();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    const inst = obj as THREE.InstancedMesh;
    const count = inst.isInstancedMesh ? inst.count : 1;
    if (count <= 0) return;
    meshes++;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (pos) {
      vertices += pos.count * count;
      const idx = geo.getIndex();
      triangles += (idx ? idx.count / 3 : pos.count / 3) * count;
    }
    const col = geo.getAttribute('color');
    if (col && colorSet.size < 12) {
      const step = Math.max(1, Math.floor(col.count / 24));
      for (let i = 0; i < col.count && colorSet.size < 12; i += step) {
        tempColor.setRGB(col.getX(i), col.getY(i), col.getZ(i));
        colorSet.add(`#${tempColor.getHexString()}`);
      }
    }
  });

  box3.setFromObject(root);
  const size = new THREE.Vector3();
  if (!box3.isEmpty()) box3.getSize(size);

  return {
    meshes,
    vertices: Math.round(vertices),
    triangles: Math.round(triangles),
    width: Number(size.x.toFixed(2)),
    height: Number(size.y.toFixed(2)),
    depth: Number(size.z.toFixed(2)),
    colors: [...colorSet],
  };
}
