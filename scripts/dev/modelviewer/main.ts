import * as THREE from 'three';
import { Character } from '../../../src/render/Character';
import { box, kitMaterial, merge } from '../../../src/render/kit';
import { CATEGORIES, computeModelStats, getCatalog, LIBRARIES } from './catalog';
import type { BuildContext, BuiltModel, CatalogLibraryId, ModelCategory, ModelEntry, ModelStats } from './types';

interface ViewerState {
  library: CatalogLibraryId;
  category: ModelCategory | 'all';
  tag: string | null;
  search: string;
  selectedId: string;
  viewMode: 'stage' | 'grid';
  variants: Record<string, Record<string, string | number | boolean>>;
  // Stage settings
  turntable: boolean;
  playing: boolean;
  showGrid: boolean;
  showWall: 'auto' | 'on' | 'off';
  showMannequin: boolean;
  showBounds: boolean;
  wireframe: boolean;
  lighting: 'day' | 'night' | 'clay';
  cameraPreset: 'studio' | 'iso' | 'front' | 'side' | 'top';
}

const FEATURED_TAGS = [
  'interactive',
  'animated',
  'contraband',
  'tool',
  'weapon',
  'key',
  'wall-mounted',
  'lit-at-night',
  'six-hunter',
  'escape',
  'jobs',
  'gym',
  'holiday',
  'theme-aware',
  'parametric',
];

export function initModelViewer() {
  const catalog = getCatalog();
  const byId = new Map<string, ModelEntry>(catalog.map((e) => [e.id, e]));

  const initialHash = decodeURIComponent(location.hash.slice(1));
  const defaultEntry = byId.get(initialHash) ?? catalog[0];

  const state: ViewerState = {
    library: 'all',
    category: 'all',
    tag: null,
    search: '',
    selectedId: defaultEntry.id,
    viewMode: 'stage',
    variants: {},
    turntable: false,
    playing: true,
    showGrid: true,
    showWall: 'auto',
    showMannequin: false,
    showBounds: false,
    wireframe: false,
    lighting: 'day',
    cameraPreset: 'studio',
  };

  for (const entry of catalog) {
    const map: Record<string, string | number | boolean> = {};
    for (const v of entry.variants ?? []) map[v.key] = v.defaultValue;
    state.variants[entry.id] = map;
  }

  const viewportEl = document.getElementById('stage-viewport')!;
  const canvasEl = document.getElementById('stage-canvas') as HTMLCanvasElement;
  const gridContainerEl = document.getElementById('catalog-grid-view')!;
  const libraryTabsEl = document.getElementById('library-tabs')!;
  const categoryListEl = document.getElementById('category-list')!;
  const tagCloudEl = document.getElementById('tag-cloud')!;
  const modelListEl = document.getElementById('model-list')!;
  const resultCountEl = document.getElementById('result-count')!;
  const searchInputEl = document.getElementById('search-input') as HTMLInputElement;
  const inspectorEl = document.getElementById('inspector-content')!;
  const hudTitleEl = document.getElementById('hud-title')!;
  const hudSubEl = document.getElementById('hud-sub')!;
  const hudDimsEl = document.getElementById('hud-dims')!;

  const renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);

  const hemiLight = new THREE.HemisphereLight(0xf4f7ff, 0x3b4252, 0.85);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.55);
  sunLight.position.set(5, 9, 6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 30;
  const sc = 4.5;
  sunLight.shadow.camera.left = -sc;
  sunLight.shadow.camera.right = sc;
  sunLight.shadow.camera.top = sc;
  sunLight.shadow.camera.bottom = -sc;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  const rimLight = new THREE.DirectionalLight(0x90b4ff, 0.45);
  rimLight.position.set(-6, 4, -5);
  scene.add(rimLight);

  const stageHelpers = new THREE.Group();
  scene.add(stageHelpers);

  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.26 }));
  shadowFloor.position.y = -0.002;
  shadowFloor.receiveShadow = true;
  stageHelpers.add(shadowFloor);

  const gridHelper = new THREE.GridHelper(12, 12, 0x4b6bfb, 0x2d3548);
  gridHelper.position.y = 0.001;
  (gridHelper.material as THREE.Material).transparent = true;
  (gridHelper.material as THREE.Material).opacity = 0.55;
  stageHelpers.add(gridHelper);

  const footprintPad = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x4b6bfb,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  footprintPad.position.y = 0.002;
  stageHelpers.add(footprintPad);

  const refWallMat = kitMaterial.clone();
  refWallMat.transparent = true;
  refWallMat.opacity = 0.45;
  const refWall = new THREE.Mesh(
    merge([box(2.2, 1.4, 0.14, 0x6b7280, 0, 0, -0.57), box(2.24, 0.05, 0.18, 0x9aa2ad, 0, 1.4, -0.57)]),
    refWallMat,
  );
  refWall.receiveShadow = true;
  stageHelpers.add(refWall);

  const mannequinChar = new Character({ outfit: 0x5c7cfa, skin: 0xd0d8e8, hair: 0x3b4866, hairStyle: 0 }, 99);
  mannequinChar.pose(0, 0, 0, false, 0.016, 0, false);
  mannequinChar.root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.material) {
      const cloned = (m.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
      cloned.transparent = true;
      cloned.opacity = 0.42;
      m.material = cloned;
    }
  });
  mannequinChar.root.visible = false;
  scene.add(mannequinChar.root);

  const boundsBox = new THREE.Box3();
  const boundsHelper = new THREE.Box3Helper(boundsBox, new THREE.Color(0xf6b73c));
  boundsHelper.visible = false;
  scene.add(boundsHelper);

  const clayMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8dee9,
    roughness: 0.62,
    metalness: 0.05,
  });

  const orbit = {
    theta: 0.58,
    phi: 0.98,
    radius: 3.6,
    target: new THREE.Vector3(0, 0.5, 0),
    goalTheta: 0.58,
    goalPhi: 0.98,
    goalRadius: 3.6,
    goalTarget: new THREE.Vector3(0, 0.5, 0),
    dragging: false,
    panning: false,
    lastX: 0,
    lastY: 0,
  };

  const modelHolder = new THREE.Group();
  scene.add(modelHolder);
  let activeBuilt: BuiltModel | null = null;
  let activeStats: ModelStats = { meshes: 0, vertices: 0, triangles: 0, width: 0, height: 0, depth: 0, colors: [] };
  const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  function applyShadingOverrides() {
    if (!activeBuilt) return;
    activeBuilt.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material);
      const orig = originalMaterials.get(mesh)!;
      const origMats = Array.isArray(orig) ? orig : [orig];
      for (const m of origMats) {
        if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = state.lighting !== 'clay' && state.wireframe;
      }
      if (state.lighting === 'clay') {
        clayMaterial.wireframe = state.wireframe;
        mesh.material = clayMaterial;
      } else {
        mesh.material = orig;
      }
    });
  }

  function applyLightingMode() {
    const night = state.lighting === 'night';
    if (night) {
      hemiLight.color.setHex(0x4a6fa5);
      hemiLight.groundColor.setHex(0x121624);
      hemiLight.intensity = 0.45;
      sunLight.color.setHex(0x8ab4f8);
      sunLight.intensity = 0.65;
      rimLight.color.setHex(0xffb86c);
      rimLight.intensity = 0.55;
    } else {
      hemiLight.color.setHex(0xf4f7ff);
      hemiLight.groundColor.setHex(0x3b4252);
      hemiLight.intensity = 0.85;
      sunLight.color.setHex(0xfff6e5);
      sunLight.intensity = 1.55;
      rimLight.color.setHex(0x90b4ff);
      rimLight.intensity = 0.45;
    }
    applyShadingOverrides();
  }

  function fitCameraToModel(entry: ModelEntry, stats: ModelStats, snap = false) {
    const maxDim = Math.max(0.65, stats.width, stats.height, stats.depth);
    const boxCenter = new THREE.Vector3(0, Math.max(0.15, stats.height * 0.45), 0);
    if (!boundsBox.isEmpty()) {
      boundsBox.getCenter(boxCenter);
    }
    orbit.goalTarget.copy(boxCenter);
    orbit.goalRadius = Math.max(1.4, maxDim * 2.05);

    if (state.cameraPreset === 'iso') {
      orbit.goalTheta = 0;
      orbit.goalPhi = Math.atan2(24, 38);
      orbit.goalRadius = Math.max(2.1, maxDim * 2.45);
    } else if (state.cameraPreset === 'front') {
      orbit.goalTheta = 0;
      orbit.goalPhi = Math.PI / 2 - 0.08;
    } else if (state.cameraPreset === 'side') {
      orbit.goalTheta = Math.PI / 2;
      orbit.goalPhi = Math.PI / 2 - 0.08;
    } else if (state.cameraPreset === 'top') {
      orbit.goalTheta = 0;
      orbit.goalPhi = 0.08;
    } else {
      orbit.goalTheta = entry.wallMounted ? 0.32 : 0.58;
      orbit.goalPhi = entry.wallMounted ? 1.18 : 1.02;
    }

    if (snap) {
      orbit.theta = orbit.goalTheta;
      orbit.phi = orbit.goalPhi;
      orbit.radius = orbit.goalRadius;
      orbit.target.copy(orbit.goalTarget);
    }
  }

  function updateStageHelpers(entry: ModelEntry, stats: ModelStats) {
    gridHelper.visible = state.showGrid;
    footprintPad.visible = state.showGrid;
    const [fw, fd] = entry.footprint ?? [1, 1];
    footprintPad.scale.set(fw, fd, 1);

    const wallOn = state.showWall === 'on' || (state.showWall === 'auto' && !!entry.wallMounted);
    refWall.visible = wallOn;
    refWall.scale.x = Math.max(1, fw / 1.8);

    mannequinChar.root.visible = state.showMannequin && !entry.id.startsWith('char:');
    mannequinChar.root.position.set(Math.max(0.75, stats.width / 2 + 0.55), 0, 0);

    boundsHelper.visible = state.showBounds;
    if (activeBuilt) {
      boundsBox.setFromObject(activeBuilt.root);
    }
  }

  function loadModel(id: string, snapCamera = false) {
    const entry = byId.get(id);
    if (!entry) return;
    state.selectedId = id;
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);

    if (activeBuilt) {
      modelHolder.remove(activeBuilt.root);
      activeBuilt.dispose?.();
      activeBuilt = null;
    }
    originalMaterials.clear();

    const ctx: BuildContext = {
      variants: state.variants[id] ?? {},
      night: state.lighting === 'night' ? 1 : 0,
      power: 1,
    };

    activeBuilt = entry.build(ctx);
    modelHolder.add(activeBuilt.root);
    modelHolder.rotation.y = 0;

    activeBuilt.animate?.(0, 0.016, ctx);
    activeStats = computeModelStats(activeBuilt.root);

    const b = new THREE.Box3().setFromObject(activeBuilt.root);
    if (!b.isEmpty() && entry.category === 'items') {
      const center = new THREE.Vector3();
      b.getCenter(center);
      activeBuilt.root.position.set(-center.x, -b.min.y, -center.z);
    }

    boundsBox.setFromObject(activeBuilt.root);
    applyLightingMode();
    updateStageHelpers(entry, activeStats);
    if (snapCamera) fitCameraToModel(entry, activeStats, true);

    hudTitleEl.textContent = entry.name;
    hudSubEl.textContent = `${entry.id} · ${entry.subcategory} · ${entry.sourceFile}`;
    hudDimsEl.textContent = `${activeStats.width} × ${activeStats.height} × ${activeStats.depth} tiles · ${activeStats.triangles.toLocaleString()} tris`;

    renderInspector(entry, activeStats);
    highlightSelectedInList();
  }

  function getFilteredEntries(): ModelEntry[] {
    const q = state.search.trim().toLowerCase();
    return catalog.filter((e) => {
      if (state.library !== 'all' && e.library !== state.library) return false;
      if (state.category !== 'all' && e.category !== state.category) return false;
      if (state.tag && !e.tags.includes(state.tag)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        Boolean(e.nameFr && e.nameFr.toLowerCase().includes(q)) ||
        e.id.toLowerCase().includes(q) ||
        e.subcategory.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((t) => `#${t.toLowerCase()}`.includes(q))
      );
    });
  }

  function renderSidebar() {
    libraryTabsEl.innerHTML = '';
    for (const lib of LIBRARIES) {
      const count = catalog.filter((e) => lib.id === 'all' || e.library === lib.id).length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `lib-tab ${state.library === lib.id ? 'active' : ''}`;
      btn.innerHTML = `<span class="lib-tab-name">${lib.name}</span><span class="lib-tab-count">${count}</span>`;
      btn.addEventListener('click', () => {
        state.library = lib.id;
        renderAllLists();
      });
      libraryTabsEl.appendChild(btn);
    }

    categoryListEl.innerHTML = '';
    for (const cat of CATEGORIES) {
      const count = catalog.filter(
        (e) => (state.library === 'all' || e.library === state.library) && (cat.id === 'all' || e.category === cat.id),
      ).length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cat-btn ${state.category === cat.id ? 'active' : ''}`;
      btn.dataset.category = cat.id;
      btn.innerHTML = `
        <span class="cat-icon">${cat.icon}</span>
        <span class="cat-label">${cat.label}</span>
        <span class="cat-count">${count}</span>
      `;
      btn.addEventListener('click', () => {
        state.category = cat.id;
        renderAllLists();
      });
      categoryListEl.appendChild(btn);
    }

    tagCloudEl.innerHTML = '';
    for (const tag of FEATURED_TAGS) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `tag-pill ${state.tag === tag ? 'active' : ''}`;
      pill.textContent = `#${tag}`;
      pill.addEventListener('click', () => {
        state.tag = state.tag === tag ? null : tag;
        renderAllLists();
      });
      tagCloudEl.appendChild(pill);
    }
  }

  function renderModelList(filtered: ModelEntry[]) {
    resultCountEl.textContent = `${filtered.length} object${filtered.length === 1 ? '' : 's'}`;
    modelListEl.innerHTML = '';

    if (!filtered.length) {
      modelListEl.innerHTML = `<div class="empty-state">No 3D objects match your filter.</div>`;
      return;
    }

    const groups = new Map<string, ModelEntry[]>();
    for (const e of filtered) {
      let g = groups.get(e.subcategory);
      if (!g) groups.set(e.subcategory, (g = []));
      g.push(e);
    }

    for (const [sub, items] of groups) {
      const header = document.createElement('div');
      header.className = 'subcat-header';
      header.innerHTML = `<span>${sub}</span><span>${items.length}</span>`;
      modelListEl.appendChild(header);

      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `model-row ${item.id === state.selectedId ? 'active' : ''}`;
        row.dataset.modelId = item.id;
        const badge = item.library === 'kit-library' ? '<span class="badge-v2">V2</span>' : '';
        const contra = item.tags.includes('contraband') ? '<span class="dot-contra" title="Contraband"></span>' : '';
        row.innerHTML = `
          <div class="model-row-main">
            <span class="model-row-name">${item.name}</span>
            ${badge}${contra}
          </div>
          <div class="model-row-meta">${item.id}</div>
        `;
        row.addEventListener('click', () => {
          loadModel(item.id, true);
          if (state.viewMode === 'grid') setViewMode('stage');
        });
        modelListEl.appendChild(row);
      }
    }
  }

  function highlightSelectedInList() {
    for (const el of modelListEl.querySelectorAll<HTMLElement>('.model-row')) {
      el.classList.toggle('active', el.dataset.modelId === state.selectedId);
    }
    for (const el of gridContainerEl.querySelectorAll<HTMLElement>('.grid-card')) {
      el.classList.toggle('active', el.dataset.modelId === state.selectedId);
    }
  }

  const thumbCache = new Map<string, string>();
  let thumbRenderer: THREE.WebGLRenderer | null = null;
  let thumbScene: THREE.Scene | null = null;
  let thumbCamera: THREE.PerspectiveCamera | null = null;

  function renderThumbnail(entry: ModelEntry): string {
    const hit = thumbCache.get(entry.id);
    if (hit) return hit;

    if (!thumbRenderer) {
      thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbRenderer.setSize(220, 165);
      thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
      thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      thumbScene = new THREE.Scene();
      const h = new THREE.HemisphereLight(0xf4f7ff, 0x3b4252, 0.95);
      const d = new THREE.DirectionalLight(0xfff6e5, 1.5);
      d.position.set(4, 7, 5);
      thumbScene.add(h, d);
      thumbCamera = new THREE.PerspectiveCamera(34, 220 / 165, 0.1, 80);
    }

    const built = entry.build({ variants: state.variants[entry.id] ?? {}, night: 0, power: 1 });
    built.animate?.(0, 0.016, { variants: state.variants[entry.id] ?? {}, night: 0, power: 1 });
    thumbScene!.add(built.root);

    const b = new THREE.Box3().setFromObject(built.root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    if (!b.isEmpty()) {
      b.getSize(size);
      b.getCenter(center);
    }
    const maxDim = Math.max(0.55, size.x, size.y, size.z);
    const dist = maxDim * 1.95;
    const angle = entry.wallMounted ? 0.35 : 0.62;
    thumbCamera!.position.set(center.x + Math.sin(angle) * dist, center.y + maxDim * 0.85, center.z + Math.cos(angle) * dist);
    thumbCamera!.lookAt(center);
    const prevWire = kitMaterial.wireframe;
    kitMaterial.wireframe = false;
    thumbRenderer.render(thumbScene!, thumbCamera!);
    kitMaterial.wireframe = prevWire;
    const dataUrl = thumbRenderer.domElement.toDataURL('image/png');

    thumbScene!.remove(built.root);
    built.dispose?.();
    thumbCache.set(entry.id, dataUrl);
    return dataUrl;
  }

  let gridObserver: IntersectionObserver | null = null;

  function renderGridView(filtered: ModelEntry[]) {
    if (state.viewMode !== 'grid') return;
    gridObserver?.disconnect();
    gridContainerEl.innerHTML = '';

    gridObserver = new IntersectionObserver(
      (entries) => {
        for (const io of entries) {
          if (!io.isIntersecting) continue;
          const card = io.target as HTMLElement;
          const id = card.dataset.modelId!;
          const img = card.querySelector<HTMLImageElement>('img.grid-thumb');
          const entry = byId.get(id);
          if (img && !img.src && entry) {
            img.src = renderThumbnail(entry);
          }
          gridObserver?.unobserve(card);
        }
      },
      { root: gridContainerEl, rootMargin: '160px' },
    );

    for (const entry of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `grid-card ${entry.id === state.selectedId ? 'active' : ''}`;
      card.dataset.modelId = entry.id;
      card.innerHTML = `
        <div class="grid-thumb-wrap">
          <img class="grid-thumb" alt="${entry.name}" />
          ${entry.library === 'kit-library' ? '<span class="grid-badge-v2">V2 LIB</span>' : ''}
        </div>
        <div class="grid-card-body">
          <div class="grid-card-title">${entry.name}</div>
          <div class="grid-card-meta">${entry.subcategory} · <code>${entry.id}</code></div>
        </div>
      `;
      card.addEventListener('click', () => {
        loadModel(entry.id, true);
        setViewMode('stage');
      });
      gridContainerEl.appendChild(card);
      gridObserver.observe(card);
    }
  }

  function renderInspector(entry: ModelEntry, stats: ModelStats) {
    const varValues = state.variants[entry.id] ?? {};
    inspectorEl.innerHTML = '';

    const overview = document.createElement('div');
    overview.className = 'insp-section';
    overview.innerHTML = `
      <div class="insp-header">
        <div class="insp-badges">
          <span class="insp-badge ${entry.library === 'kit-library' ? 'v2' : 'game'}">${entry.library === 'kit-library' ? 'V2 KIT LIBRARY' : 'GAME MODEL'}</span>
          <span class="insp-badge cat">${entry.category.toUpperCase()}</span>
        </div>
        <h2 class="insp-title">${entry.name}</h2>
        ${entry.nameFr && entry.nameFr !== entry.name ? `<div class="insp-fr">FR: ${entry.nameFr}</div>` : ''}
        <p class="insp-desc">${entry.description}</p>
      </div>
    `;
    inspectorEl.appendChild(overview);

    if (entry.variants && entry.variants.length > 0) {
      const varSec = document.createElement('div');
      varSec.className = 'insp-section';
      varSec.innerHTML = `
        <div class="insp-sec-head">
          <span>Variants & Parameters</span>
          <button type="button" class="insp-reset-btn" id="reset-variants-btn">Reset</button>
        </div>
      `;
      const controlsWrap = document.createElement('div');
      controlsWrap.className = 'insp-controls';

      for (const ctrl of entry.variants) {
        const row = document.createElement('label');
        row.className = 'ctrl-row';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'ctrl-label';
        labelSpan.textContent = ctrl.label;
        row.appendChild(labelSpan);

        const cur = varValues[ctrl.key] ?? ctrl.defaultValue;

        if (ctrl.kind === 'select') {
          const sel = document.createElement('select');
          sel.className = 'ctrl-select';
          for (const opt of ctrl.options ?? []) {
            const o = document.createElement('option');
            o.value = String(opt.value);
            o.textContent = opt.label;
            if (String(opt.value) === String(cur)) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener('change', () => {
            const raw = sel.value;
            const matched = ctrl.options?.find((o) => String(o.value) === raw);
            varValues[ctrl.key] = matched ? matched.value : raw;
            thumbCache.delete(entry.id);
            loadModel(entry.id, false);
          });
          row.appendChild(sel);
        } else if (ctrl.kind === 'boolean') {
          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.className = 'ctrl-checkbox';
          chk.checked = Boolean(cur);
          chk.addEventListener('change', () => {
            varValues[ctrl.key] = chk.checked;
            thumbCache.delete(entry.id);
            loadModel(entry.id, false);
          });
          row.appendChild(chk);
        } else if (ctrl.kind === 'color') {
          const col = document.createElement('input');
          col.type = 'color';
          col.className = 'ctrl-color';
          col.value = String(cur);
          col.addEventListener('input', () => {
            varValues[ctrl.key] = col.value;
            thumbCache.delete(entry.id);
            loadModel(entry.id, false);
          });
          row.appendChild(col);
        }

        controlsWrap.appendChild(row);
      }

      varSec.appendChild(controlsWrap);
      inspectorEl.appendChild(varSec);

      varSec.querySelector('#reset-variants-btn')?.addEventListener('click', () => {
        for (const c of entry.variants ?? []) varValues[c.key] = c.defaultValue;
        thumbCache.delete(entry.id);
        loadModel(entry.id, false);
      });
    }

    const [fw, fd] = entry.footprint ?? [1, 1];
    const statsSec = document.createElement('div');
    statsSec.className = 'insp-section';
    statsSec.innerHTML = `
      <div class="insp-sec-head"><span>Geometry & Stage Metrics</span></div>
      <div class="stats-grid">
        <div class="stat-box">
          <span class="stat-val">${stats.triangles.toLocaleString()}</span>
          <span class="stat-lbl">Triangles</span>
        </div>
        <div class="stat-box">
          <span class="stat-val">${stats.vertices.toLocaleString()}</span>
          <span class="stat-lbl">Vertices</span>
        </div>
        <div class="stat-box">
          <span class="stat-val">${stats.meshes}</span>
          <span class="stat-lbl">Mesh Calls</span>
        </div>
        <div class="stat-box">
          <span class="stat-val">${fw} × ${fd}</span>
          <span class="stat-lbl">Tile Footprint</span>
        </div>
      </div>
      <div class="dims-bar">
        <span>Width (X): <b>${stats.width}</b></span>
        <span>Height (Y): <b>${stats.height}</b></span>
        <span>Depth (Z): <b>${stats.depth}</b></span>
      </div>
    `;
    inspectorEl.appendChild(statsSec);

    if (stats.colors.length > 0) {
      const palSec = document.createElement('div');
      palSec.className = 'insp-section';
      palSec.innerHTML = `<div class="insp-sec-head"><span>Vertex Color Palette</span></div>`;
      const swatchRow = document.createElement('div');
      swatchRow.className = 'swatch-row';
      for (const hex of stats.colors) {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'color-swatch';
        sw.style.backgroundColor = hex;
        sw.title = `${hex} (click to copy)`;
        sw.addEventListener('click', () => {
          void navigator.clipboard?.writeText(hex);
        });
        swatchRow.appendChild(sw);
      }
      palSec.appendChild(swatchRow);
      inspectorEl.appendChild(palSec);
    }

    const codeSec = document.createElement('div');
    codeSec.className = 'insp-section';
    const recipeHtml = activeBuilt?.recipe?.length
      ? `<div class="insp-recipe-title">Kit Procedural Recipe</div><pre class="insp-code">${activeBuilt.recipe.join('\n')}</pre>`
      : '';
    codeSec.innerHTML = `
      <div class="insp-sec-head"><span>Code Provenance & Tags</span></div>
      <div class="code-meta">
        <div><span class="meta-k">ID:</span> <code>${entry.id}</code></div>
        <div><span class="meta-k">Source:</span> <code>${entry.sourceFile}</code></div>
        <div><span class="meta-k">Builder:</span> <code>${entry.builderName}</code></div>
      </div>
      ${recipeHtml}
      <div class="insp-tags" id="insp-tags"></div>
    `;
    inspectorEl.appendChild(codeSec);

    const tagsWrap = codeSec.querySelector('#insp-tags')!;
    for (const t of entry.tags) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tag-pill ${state.tag === t ? 'active' : ''}`;
      btn.textContent = `#${t}`;
      btn.addEventListener('click', () => {
        state.tag = state.tag === t ? null : t;
        renderAllLists();
      });
      tagsWrap.appendChild(btn);
    }
  }

  function renderAllLists() {
    renderSidebar();
    const filtered = getFilteredEntries();
    renderModelList(filtered);
    renderGridView(filtered);
  }

  function setViewMode(mode: 'stage' | 'grid') {
    state.viewMode = mode;
    document.getElementById('mode-stage-btn')?.classList.toggle('active', mode === 'stage');
    document.getElementById('mode-grid-btn')?.classList.toggle('active', mode === 'grid');
    gridContainerEl.hidden = mode !== 'grid';
    if (mode === 'grid') renderGridView(getFilteredEntries());
  }

  function syncToolbarButtons() {
    document.getElementById('btn-turntable')?.classList.toggle('active', state.turntable);
    document.getElementById('btn-play')?.classList.toggle('active', state.playing);
    document.getElementById('btn-grid')?.classList.toggle('active', state.showGrid);
    document.getElementById('btn-wall')?.classList.toggle('active', state.showWall === 'on');
    document.getElementById('btn-mannequin')?.classList.toggle('active', state.showMannequin);
    document.getElementById('btn-bounds')?.classList.toggle('active', state.showBounds);
    document.getElementById('btn-wireframe')?.classList.toggle('active', state.wireframe);
    for (const mode of ['day', 'night', 'clay'] as const) {
      document.getElementById(`light-${mode}`)?.classList.toggle('active', state.lighting === mode);
    }
    for (const cam of ['studio', 'iso', 'front', 'side', 'top'] as const) {
      document.getElementById(`cam-${cam}`)?.classList.toggle('active', state.cameraPreset === cam);
    }
  }

  document.getElementById('mode-stage-btn')?.addEventListener('click', () => setViewMode('stage'));
  document.getElementById('mode-grid-btn')?.addEventListener('click', () => setViewMode('grid'));

  document.getElementById('btn-turntable')?.addEventListener('click', () => {
    state.turntable = !state.turntable;
    syncToolbarButtons();
  });
  document.getElementById('btn-play')?.addEventListener('click', () => {
    state.playing = !state.playing;
    syncToolbarButtons();
  });
  document.getElementById('btn-grid')?.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    updateStageHelpers(byId.get(state.selectedId)!, activeStats);
    syncToolbarButtons();
  });
  document.getElementById('btn-wall')?.addEventListener('click', () => {
    state.showWall = state.showWall === 'on' ? 'off' : 'on';
    updateStageHelpers(byId.get(state.selectedId)!, activeStats);
    syncToolbarButtons();
  });
  document.getElementById('btn-mannequin')?.addEventListener('click', () => {
    state.showMannequin = !state.showMannequin;
    updateStageHelpers(byId.get(state.selectedId)!, activeStats);
    syncToolbarButtons();
  });
  document.getElementById('btn-bounds')?.addEventListener('click', () => {
    state.showBounds = !state.showBounds;
    updateStageHelpers(byId.get(state.selectedId)!, activeStats);
    syncToolbarButtons();
  });
  document.getElementById('btn-wireframe')?.addEventListener('click', () => {
    state.wireframe = !state.wireframe;
    applyShadingOverrides();
    syncToolbarButtons();
  });

  for (const mode of ['day', 'night', 'clay'] as const) {
    document.getElementById(`light-${mode}`)?.addEventListener('click', () => {
      state.lighting = mode;
      applyLightingMode();
      syncToolbarButtons();
    });
  }

  for (const preset of ['studio', 'iso', 'front', 'side', 'top'] as const) {
    document.getElementById(`cam-${preset}`)?.addEventListener('click', () => {
      state.cameraPreset = preset;
      fitCameraToModel(byId.get(state.selectedId)!, activeStats, false);
      syncToolbarButtons();
    });
  }

  document.getElementById('btn-fit')?.addEventListener('click', () => {
    fitCameraToModel(byId.get(state.selectedId)!, activeStats, false);
  });

  document.getElementById('btn-snapshot')?.addEventListener('click', () => {
    renderer.render(scene, camera);
    const a = document.createElement('a');
    a.href = canvasEl.toDataURL('image/png');
    a.download = `${state.selectedId.replace(':', '-')}.png`;
    a.click();
  });

  const themeBtn = document.getElementById('ui-theme-btn');
  themeBtn?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
  });

  searchInputEl.addEventListener('input', () => {
    state.search = searchInputEl.value;
    renderAllLists();
  });

  canvasEl.addEventListener('pointerdown', (e) => {
    canvasEl.setPointerCapture(e.pointerId);
    orbit.dragging = true;
    orbit.panning = e.button === 2 || e.shiftKey || e.metaKey;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
  });

  canvasEl.addEventListener('pointermove', (e) => {
    if (!orbit.dragging) return;
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;

    if (orbit.panning) {
      const panScale = orbit.goalRadius * 0.0018;
      const right = new THREE.Vector3(Math.cos(orbit.theta), 0, -Math.sin(orbit.theta));
      orbit.goalTarget.addScaledVector(right, -dx * panScale);
      orbit.goalTarget.y = Math.max(0, orbit.goalTarget.y + dy * panScale);
    } else {
      orbit.goalTheta -= dx * 0.0075;
      orbit.goalPhi = Math.max(0.08, Math.min(Math.PI / 2 - 0.02, orbit.goalPhi - dy * 0.0065));
    }
  });

  const endDrag = () => {
    orbit.dragging = false;
  };
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

  canvasEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      orbit.goalRadius = Math.max(0.7, Math.min(28, orbit.goalRadius * factor));
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      searchInputEl.focus();
      searchInputEl.select();
    } else if (e.key === ' ') {
      e.preventDefault();
      state.turntable = !state.turntable;
      syncToolbarButtons();
    } else if (e.key === 'f' || e.key === 'F') {
      fitCameraToModel(byId.get(state.selectedId)!, activeStats, false);
    } else if (e.key === 'g' || e.key === 'G') {
      document.getElementById('btn-grid')?.click();
    } else if (e.key === 'w' || e.key === 'W') {
      document.getElementById('btn-wall')?.click();
    } else if (e.key === 'm' || e.key === 'M') {
      document.getElementById('btn-mannequin')?.click();
    } else if (e.key === 'b' || e.key === 'B') {
      document.getElementById('btn-bounds')?.click();
    } else if (e.key === 'x' || e.key === 'X') {
      document.getElementById('btn-wireframe')?.click();
    } else if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      const list = getFilteredEntries();
      const idx = list.findIndex((item) => item.id === state.selectedId);
      if (idx >= 0 && idx + 1 < list.length) loadModel(list[idx + 1].id, true);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      const list = getFilteredEntries();
      const idx = list.findIndex((item) => item.id === state.selectedId);
      if (idx > 0) loadModel(list[idx - 1].id, true);
    }
  });

  function handleResize() {
    const rect = viewportEl.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', handleResize);
  new ResizeObserver(handleResize).observe(viewportEl);

  renderAllLists();
  loadModel(state.selectedId, true);
  orbit.theta = orbit.goalTheta;
  orbit.phi = orbit.goalPhi;
  orbit.radius = orbit.goalRadius;
  orbit.target.copy(orbit.goalTarget);
  syncToolbarButtons();
  handleResize();

  (window as unknown as Record<string, unknown>).__modelViewer = {
    catalog,
    state,
    loadModel,
    setViewMode,
    getFilteredEntries,
  };

  let lastTime = performance.now() / 1000;
  let animClock = 0;

  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.001, now - lastTime));
    lastTime = now;

    if (state.playing) {
      animClock += dt;
      activeBuilt?.animate?.(animClock, dt, {
        variants: state.variants[state.selectedId] ?? {},
        night: state.lighting === 'night' ? 1 : 0,
        power: 1,
      });
    }

    if (state.turntable && !orbit.dragging) {
      orbit.goalTheta += dt * 0.55;
    }

    const damp = Math.min(1, dt * 14);
    orbit.theta += (orbit.goalTheta - orbit.theta) * damp;
    orbit.phi += (orbit.goalPhi - orbit.phi) * damp;
    orbit.radius += (orbit.goalRadius - orbit.radius) * damp;
    orbit.target.lerp(orbit.goalTarget, damp);

    const sinPhi = Math.sin(orbit.phi);
    camera.position.set(
      orbit.target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
      orbit.target.y + orbit.radius * Math.cos(orbit.phi),
      orbit.target.z + orbit.radius * sinPhi * Math.cos(orbit.theta),
    );
    camera.lookAt(orbit.target);

    if (state.viewMode === 'stage') {
      renderer.render(scene, camera);
    }
  }
  requestAnimationFrame(tick);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initModelViewer());
  } else {
    initModelViewer();
  }
}
