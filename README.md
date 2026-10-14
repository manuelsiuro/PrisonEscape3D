# Prison Escape 3D

Play the model prisoner, plan the perfect escape: a 3D take on *The Escapists* for phones and
desktops, in the browser. Vite + TypeScript + Three.js, everything procedural (no asset files).

**Play**: https://manuelsiuro.github.io/PrisonEscape3D/

## Status

P0 (v0.1): Center Perks, the first prison, rendered from its ASCII map. Walk around with
the keyboard or a touch stick, with a day/night clock. The routine, items, guards and escapes
arrive phase by phase. See [docs/PLAN.md](docs/PLAN.md).

## Commands

```sh
npm run dev       # dev server on port 5310 (also on your network, for phones)
npm test          # headless tests;  npm test -- -u  accepts new snapshots
npm run build     # type-check and build to dist/
npx tsx scripts/dev/icon.ts && npm run icons   # redraw the app icons
npm version minor && git push --follow-tags origin main   # release
```

## Controls

- **Keyboard**: WASD or arrows to walk, mouse wheel to zoom, Escape to pause.
- **Touch**: drag anywhere to walk (a stick appears under your thumb), pinch to zoom.

## Layout

| Path | What |
|---|---|
| `src/sim/` | Deterministic simulation: `Sim`, `Recorder` (command log + keyframes), world, systems |
| `src/content/` | Prisons (ASCII maps, zones, props), zone and prop tables |
| `src/render/` | Three.js view: instanced tiles, props, characters, wall cutaway, day/night |
| `src/input/` | Keyboard and touch → one direction per step |
| `src/ui/` | HUD and screens (title, pause) |
| `scripts/` | Tests (`*test*.ts`) and dev tools |
| `docs/` | Design document, tech plan, project plan |
