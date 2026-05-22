/**
 * UI slice — selection, tree expand/collapse.
 */
import type { StateCreator } from 'zustand';
import type { Store } from './types';
import { walk, seedInitialExpanded } from './helpers';
import { buildSeedHierarchy } from '../data/seed';

export type UiSlice = Pick<
  Store,
  | 'selectedNodeId'
  | 'selectedModelId'
  | 'expandedIds'
  | 'selectNode'
  | 'selectModel'
  | 'toggleExpand'
  | 'expandAll'
  | 'collapseAll'
>;

export const createUiSlice: StateCreator<Store, [], [], UiSlice> = (
  set,
  get,
) => {
  const seed = buildSeedHierarchy();

  return {
    selectedNodeId: seed.hierarchy.id,
    selectedModelId: undefined,
    expandedIds: seedInitialExpanded(seed.hierarchy),

    selectNode(id) {
      set({ selectedNodeId: id, selectedModelId: undefined });
    },

    selectModel(id) {
      set({ selectedModelId: id });
    },

    toggleExpand(id) {
      const ids = new Set(get().expandedIds);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      set({ expandedIds: ids });
    },

    expandAll() {
      const all = new Set<string>();
      walk(get().hierarchy, (n) => all.add(n.id));
      set({ expandedIds: all });
    },

    collapseAll() {
      set({ expandedIds: new Set([get().hierarchy.id]) });
    },
  };
};
