type Node = { id: string; name: string; parentId: string | null; icon?: string | null; sortOrder?: number };

/** Libellé complet d'un élément d'arborescence : « Garage › Étagère 1 ». */
export function pathLabel<T extends Node>(items: T[], id: string | null | undefined): string {
  if (!id) return "";
  const byId = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  let cur = byId.get(id);
  for (let guard = 0; cur && guard < 20; guard++) {
    parts.unshift(cur.name || "Sans nom");
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

/** Aplatit l'arbre en liste ordonnée avec profondeur (pour les sélecteurs). */
export function flattenTree<T extends Node>(items: T[]): (T & { depth: number })[] {
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<string | null, T[]>();
  for (const i of items) {
    const key = i.parentId && ids.has(i.parentId) ? i.parentId : null;
    children.set(key, [...(children.get(key) ?? []), i]);
  }
  const out: (T & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      out.push({ ...c, depth });
      if (depth < 10) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Ids d'un élément et de tous ses descendants (filtrer « Garage » inclut ses étagères). */
export function descendantIds<T extends Node>(items: T[], id: string): Set<string> {
  const set = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of items) {
      if (i.parentId && set.has(i.parentId) && !set.has(i.id)) {
        set.add(i.id);
        grew = true;
      }
    }
  }
  return set;
}
