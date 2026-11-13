/**
 * A world made for City Escape (its definition's id says so): the view leaves out what only a prison
 * has (the ring road's line). Alone in its file: the view reads it without the city's code coming along.
 */
export const isCity = (def: { id: string }) => def.id.startsWith('city-');
