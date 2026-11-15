import { capEdges, speckle, texture } from '../../render/textures';

/**
 * The city's own surfaces (2.57): what its streets and buildings wear in place of the prisons' brick and
 * coping. The walls' are drawn pale, each building's colour laid over them (render/facades.ts).
 */
export const CITY_TEX = {
  /** The carriageway: old tarmac, darker than the pavement beside it. */
  road: () =>
    texture('cityRoad', 16, (c, n, r) => {
      speckle(c, n, r, '#43464b', '#3b3e43', '#4d5056', 0.34);
      c.fillStyle = '#5a5d63';
      for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
    }),
  /** The pavement: four slabs a tile, their joints dark, one of them cracked. */
  pavement: () =>
    texture('cityPavement', 16, (c, n, r) => {
      speckle(c, n, r, '#8f9194', '#86888b', '#999b9e', 0.26);
      c.fillStyle = '#6f7174';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, 0, 1, n);
      c.fillRect(0, n / 2, n, 1);
      c.fillRect(n / 2, 0, 1, n);
      c.fillStyle = '#a6a8ab';
      c.fillRect(1, 1, n / 2 - 1, 1);
      c.fillRect(n / 2 + 1, n / 2 + 1, n / 2 - 1, 1);
      c.fillStyle = '#74767a';
      c.fillRect(11, 3, 1, 2);
      c.fillRect(12, 5, 1, 2);
    }),
  /** A square's paving: warm stone in a chequer. */
  plaza: () =>
    texture('cityPlaza', 16, (c, n, r) => {
      speckle(c, n, r, '#a89f90', '#9d9485', '#b3aa9b', 0.2);
      c.fillStyle = 'rgba(70, 60, 48, 0.16)';
      c.fillRect(0, 0, n / 2, n / 2);
      c.fillRect(n / 2, n / 2, n / 2, n / 2);
      c.fillStyle = '#857d70';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, 0, 1, n);
      c.fillRect(0, n / 2, n, 1);
      c.fillRect(n / 2, 0, 1, n);
    }),
  /** A yard's ground: packed gravel and oil. */
  yard: () =>
    texture('cityYard', 16, (c, n, r) => {
      speckle(c, n, r, '#77736b', '#6b675f', '#858178', 0.42);
      c.fillStyle = 'rgba(30, 28, 26, 0.22)';
      c.fillRect(3, 9, 4, 2);
      c.fillRect(4, 8, 2, 4);
    }),
  /** Painted boards, for the houses: laps every four pixels, a plinth at the foot, the eaves' shadow at the top. */
  siding: () =>
    texture('citySiding', 16, (c, n, r) => {
      speckle(c, n, r, '#ece9e2', '#e2dfd8', '#f4f1ea', 0.1);
      c.fillStyle = '#c9c5bc';
      for (let y = 3; y < n; y += 4) c.fillRect(0, y, n, 1);
      wear(c, n, r);
    }),
  /** Render, for the shops and the wards: flat, stained under the eaves. */
  stucco: () =>
    texture('cityStucco', 16, (c, n, r) => {
      speckle(c, n, r, '#ebe8e1', '#dfdcd5', '#f3f0e9', 0.2);
      wear(c, n, r);
    }),
  /** Sheet metal, for the sheds: ribs every other pixel, rust at the foot. */
  metal: () =>
    texture('cityMetal', 16, (c, n, r) => {
      speckle(c, n, r, '#e4e4e2', '#d8d8d6', '#eeeeec', 0.08);
      c.fillStyle = '#c2c2c0';
      for (let x = 1; x < n; x += 4) c.fillRect(x, 0, 1, n);
      c.fillStyle = '#f6f6f4';
      for (let x = 3; x < n; x += 4) c.fillRect(x, 0, 1, n);
      c.fillStyle = 'rgba(120, 70, 40, 0.3)';
      for (let k = 0; k < 6; k++) c.fillRect(Math.floor(r() * n), n - 1 - Math.floor(r() * 4), 1, 2);
      c.fillStyle = 'rgba(40, 38, 36, 0.3)';
      c.fillRect(0, 0, n, 1);
    }),
  /** Cast panels, for the offices: a seam a tile, a band of dark glass across each. */
  panel: () =>
    texture('cityPanel', 16, (c, n, r) => {
      speckle(c, n, r, '#e6e6e4', '#dadad8', '#f0f0ee', 0.14);
      c.fillStyle = '#bdbdbb';
      c.fillRect(0, 0, 1, n);
      c.fillRect(0, 8, n, 1);
      c.fillStyle = 'rgba(40, 38, 36, 0.28)';
      c.fillRect(0, 0, n, 1);
      c.fillStyle = 'rgba(60, 56, 50, 0.2)';
      c.fillRect(0, n - 2, n, 2);
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), 1, 1, 2 + Math.floor(r() * 3));
    }),
  /** A roof's edge seen from above: pale, lit to the south and west as every cap is, a course along it. */
  cap: () =>
    texture('cityCap', 16, (c, n, r) => {
      speckle(c, n, r, '#dedede', '#d2d2d2', '#e8e8e8', 0.2);
      c.fillStyle = 'rgba(0, 0, 0, 0.1)';
      c.fillRect(0, 5, n, 1);
      c.fillRect(0, 10, n, 1);
      capEdges(c, n, '#f6f6f6', '#9c9c9c');
    }),
};

/** A wall's foot and top: a plinth splashed by the street, the shadow under its roof, a streak of damp. */
function wear(c: CanvasRenderingContext2D, n: number, r: () => number) {
  c.fillStyle = 'rgba(70, 64, 56, 0.3)';
  c.fillRect(0, n - 2, n, 2);
  c.fillStyle = 'rgba(40, 38, 36, 0.28)';
  c.fillRect(0, 0, n, 1);
  c.fillStyle = 'rgba(80, 74, 62, 0.16)';
  for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), 1, 1, 3 + Math.floor(r() * 5));
}
