/**
 * Pure utility helpers shared across store slices.
 * Extracted from the monolithic store.ts for reusability and testability.
 */
import type { HierarchyNode } from '../domain/types';

/** Canonical key for model-code matching (uppercase, no whitespace). */
export function canon(s: string): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Deep-clone via JSON round-trip. */
export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** Walk every node in the hierarchy tree (depth-first). */
export function walk(
  n: HierarchyNode,
  f: (x: HierarchyNode) => void,
): void {
  f(n);
  n.children.forEach((c) => walk(c, f));
}

/** Find a node by ID (depth-first). */
export function findNode(
  n: HierarchyNode,
  id: string,
): HierarchyNode | undefined {
  if (n.id === id) return n;
  for (const c of n.children) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return undefined;
}

/** Detach a node from the tree, collecting all removed IDs. */
export function detach(
  n: HierarchyNode,
  id: string,
  removed: string[],
): boolean {
  const idx = n.children.findIndex((c) => c.id === id);
  if (idx >= 0) {
    walk(n.children[idx], (x) => removed.push(x.id));
    n.children.splice(idx, 1);
    return true;
  }
  for (const c of n.children) if (detach(c, id, removed)) return true;
  return false;
}

/** Expand the first two levels of the hierarchy into a Set of IDs. */
export function seedInitialExpanded(h: HierarchyNode): Set<string> {
  const ids = new Set<string>([h.id]);
  for (const c of h.children) {
    ids.add(c.id);
    for (const c2 of c.children) ids.add(c2.id);
  }
  return ids;
}

/** Collect names of ancestor nodes as a path string (for classification context). */
export function collectNodePath(
  root: HierarchyNode,
  targetId: string,
): string | undefined {
  const collectParentNames = (
    node: HierarchyNode,
    tId: string,
    path: string[],
  ): string[] | null => {
    if (node.id === tId) return [...path, node.name];
    for (const child of node.children) {
      const result = collectParentNames(child, tId, [...path, node.name]);
      if (result) return result;
    }
    return null;
  };
  const pathNames = collectParentNames(root, targetId, []);
  if (pathNames && pathNames.length > 0) {
    return pathNames.filter(Boolean).join(' / ');
  }
  return undefined;
}

/** Generate a unique ID with a given prefix. */
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
