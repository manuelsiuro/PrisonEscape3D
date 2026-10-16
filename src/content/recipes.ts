import { KEY_ITEM_COLORS } from './items';

/**
 * The crafting handbook (GDD §8.1). Up to three ingredients, in any order; an ingredient
 * may be one of several items (`'plastic_comb|toothbrush'`). Crafting needs at least `int`
 * Intellect. Recipes are stored by their place in this list (the handbook in saves), so
 * **only append**. Key molds give the real key back (`keep`), as in §8.2.
 */
export interface RecipeDef {
  result: string;
  ingredients: readonly string[];
  int: number;
  /** Ingredients handed back after crafting (the guard key pressed into putty). */
  keep?: readonly string[];
}

const r = (result: string, int: number, ...ingredients: string[]): RecipeDef => ({ result, ingredients, int });

export const RECIPES: readonly RecipeDef[] = [
  r('molten_plastic', 30, 'plastic_comb|toothbrush', 'lighter'),
  r('putty', 40, 'talcum', 'toothpaste'),
  r('papier_mache', 30, 'toilet_paper', 'glue'),
  r('tool_handle', 30, 'timber', 'metal_file'),
  r('bed_dummy', 30, 'pillow', 'pillow', 'bed_sheet'),
  r('sheet_rope', 20, 'bed_sheet', 'bed_sheet'),
  r('poster', 20, 'magazine', 'duct_tape'),
  r('fake_vent', 30, 'papier_mache', 'papier_mache'),
  r('fake_wall', 50, 'papier_mache', 'papier_mache', 'ink'),
  r('fake_fence', 40, 'wire', 'wire', 'wire'),
  r('timber_brace', 20, 'timber', 'timber'),
  r('pouch', 50, 'foil', 'duct_tape'),
  r('flimsy_shovel', 40, 'tool_handle', 'sheet_metal', 'duct_tape'),
  r('light_shovel', 60, 'flimsy_shovel', 'sheet_metal', 'duct_tape'),
  r('sturdy_shovel', 80, 'light_shovel', 'sheet_metal', 'duct_tape'),
  r('flimsy_pickaxe', 40, 'tool_handle', 'crowbar', 'duct_tape'),
  r('light_pickaxe', 60, 'flimsy_pickaxe', 'timber', 'duct_tape'),
  r('sturdy_pickaxe', 80, 'light_pickaxe', 'timber', 'duct_tape'),
  r('flimsy_cutters', 40, 'metal_file', 'metal_file', 'duct_tape'),
  r('light_cutters', 60, 'flimsy_cutters', 'metal_file', 'duct_tape'),
  r('sturdy_cutters', 80, 'light_cutters', 'metal_file', 'duct_tape'),
  r('multitool', 90, 'sturdy_shovel', 'sturdy_pickaxe', 'duct_tape'),
  r('powered_screwdriver', 70, 'screwdriver', 'battery', 'wire'),
  ...KEY_ITEM_COLORS.map(([c]): RecipeDef => ({ result: `mold_${c}`, ingredients: ['putty', `key_${c}`], int: 50, keep: [`key_${c}`] })),
  ...KEY_ITEM_COLORS.map(([c]) => r(`plastic_key_${c}`, 60, `mold_${c}`, 'molten_plastic')),
  r('sock_mace', 20, 'sock', 'soap'),
  r('super_sock_mace', 40, 'sock', 'battery'),
  r('comb_blade', 30, 'plastic_comb', 'razor_blade'),
  r('bat', 40, 'timber', 'duct_tape'),
  r('spiked_bat', 60, 'bat', 'nail_file|wire', 'duct_tape'),
  r('nunchucks', 70, 'timber', 'timber', 'wire'),
  r('razor_whip', 80, 'timber', 'wire', 'razor_blade'),
  r('molten_chocolate', 40, 'plastic_cup', 'chocolate', 'lighter'),
  r('cushioned_outfit', 40, 'inmate_outfit', 'pillow', 'duct_tape'),
  r('plated_outfit', 70, 'inmate_outfit', 'sheet_metal', 'duct_tape'),
  r('grappling_hook', 60, 'crowbar', 'crowbar', 'duct_tape'),
  r('grapnel', 60, 'grappling_hook', 'rope|sheet_rope'),
  r('raft', 70, 'balsa', 'bed_sheet', 'rope'),
  // P14: noise to order.
  r('firecracker', 40, 'foil', 'toilet_paper', 'lighter'),
  r('alarm_clock', 30, 'battery', 'wire', 'plastic_cup'),
];

/** The item ids an ingredient accepts. */
export const choices = (ingredient: string): string[] => ingredient.split('|');
