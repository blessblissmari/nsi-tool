/**
 * Combined zustand store — assembles all slices with persist middleware.
 *
 * Previously a monolithic 857-line file, now split into focused slices:
 *   - hierarchySlice — tree structure, node CRUD
 *   - modelsSlice    — equipment models, normalization, classification, tech cards
 *   - dataSlice      — classifier, rules, references
 *   - uiSlice        — selection, expand/collapse
 *   - migrate        — schema migrations v1→v6
 *   - helpers        — pure utility functions (canon, clone, walk, findNode…)
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { HierarchyNode, TOR, EquipmentModel } from '../domain/types';
import type { Store } from './types';
import { createHierarchySlice } from './hierarchySlice';
import { createModelsSlice } from './modelsSlice';
import { createDataSlice } from './dataSlice';
import { createUiSlice } from './uiSlice';
import { migrateStore } from './migrate';
import { walk, findNode } from './helpers';

export type { Store } from './types';

export const useStore = create<Store>()(
  persist(
    (...args) => ({
      ...createHierarchySlice(...args),
      ...createModelsSlice(...args),
      ...createDataSlice(...args),
      ...createUiSlice(...args),
    }),
    {
      name: 'nsi_store_v1',
      version: 6,
      migrate: migrateStore,
      storage: createJSONStorage(() => localStorage, {
        replacer: (_k, v) =>
          v instanceof Set ? { __set: Array.from(v) } : v,
        reviver: (_k, v) => {
          if (
            v &&
            typeof v === 'object' &&
            Array.isArray((v as { __set?: unknown[] }).__set)
          ) {
            return new Set((v as { __set: string[] }).__set);
          }
          return v;
        },
      }),
      partialize: (s) => ({
        hierarchy: s.hierarchy,
        models: s.models,
        classifier: s.classifier,
        rules: s.rules,
        references: s.references,
        expandedIds: s.expandedIds,
      }),
    },
  ),
);

// ── Derived selectors (previously at bottom of store.ts) ────

/** All classified models (TOR records) under a hierarchy node. */
export function torsForNode(
  store: Pick<Store, 'hierarchy' | 'models'>,
  nodeId: string,
): TOR[] {
  const node = findNode(store.hierarchy, nodeId);
  if (!node) return [];
  const ids = new Set<string>();
  walk(node, (n) => n.modelIds?.forEach((id) => ids.add(id)));
  return store.models
    .filter((m) => ids.has(m.id))
    .filter((m) => m.className && m.subclassName && m.normalizedCode)
    .map<TOR>((m) => ({
      id: m.id,
      className: m.className!,
      subclassName: m.subclassName!,
      modelCode: m.normalizedCode!,
      modelId: m.id,
    }));
}

/** All models under a hierarchy node (recursive). */
export function modelsForNode(
  store: Pick<Store, 'hierarchy' | 'models'>,
  nodeId: string,
): EquipmentModel[] {
  const node = findNode(store.hierarchy, nodeId);
  if (!node) return [];
  const ids = new Set<string>();
  walk(node, (n) => n.modelIds?.forEach((id) => ids.add(id)));
  return store.models.filter((m) => ids.has(m.id));
}
