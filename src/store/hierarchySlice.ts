/**
 * Hierarchy slice — tree structure, node CRUD, seed/clear.
 */
import type { StateCreator } from 'zustand';
import type { HierarchyNode } from '../domain/types';
import type { Store } from './types';
import { clone, findNode, detach, seedInitialExpanded, uid } from './helpers';
import {
  SEED_NORMALIZATION_RULES,
  SEED_REFERENCES,
  buildSeedHierarchy,
} from '../data/seed';
import { PROSTOEV_CLASSIFIER } from '../data/prostoev';

export type HierarchySlice = Pick<
  Store,
  | 'hierarchy'
  | 'setHierarchy'
  | 'resetToSeed'
  | 'clearAll'
  | 'renameNode'
  | 'updateNode'
  | 'addChildNode'
  | 'deleteNode'
>;

export const createHierarchySlice: StateCreator<Store, [], [], HierarchySlice> = (
  set,
  get,
) => {
  const seed = buildSeedHierarchy();

  return {
    hierarchy: seed.hierarchy,

    setHierarchy(h, models) {
      set({
        hierarchy: h,
        models,
        selectedNodeId: h.id,
        selectedModelId: undefined,
        expandedIds: new Set([h.id]),
      });
    },

    resetToSeed() {
      const s = buildSeedHierarchy();
      set({
        hierarchy: s.hierarchy,
        models: s.models,
        classifier: PROSTOEV_CLASSIFIER,
        rules: SEED_NORMALIZATION_RULES,
        references: SEED_REFERENCES,
        selectedNodeId: s.hierarchy.id,
        selectedModelId: undefined,
        expandedIds: seedInitialExpanded(s.hierarchy),
      });
    },

    clearAll() {
      const root: HierarchyNode = {
        id: 'root-empty',
        type: 'enterprise',
        name: 'Иерархия',
        levelLabel: 'Предприятие',
        children: [],
      };
      set({
        hierarchy: root,
        models: [],
        selectedNodeId: root.id,
        selectedModelId: undefined,
        expandedIds: new Set([root.id]),
      });
    },

    renameNode(id, name) {
      const h = clone(get().hierarchy);
      const n = findNode(h, id);
      if (n) n.name = name;
      set({ hierarchy: h });
    },

    updateNode(id, patch) {
      const h = clone(get().hierarchy);
      const n = findNode(h, id);
      if (n) Object.assign(n, patch);
      set({ hierarchy: h });
    },

    addChildNode(parentId, type, name) {
      const h = clone(get().hierarchy);
      const p = findNode(h, parentId);
      if (!p) return;
      p.children.push({
        id: uid(type),
        type,
        name,
        children: [],
      });
      const ids = new Set(get().expandedIds);
      ids.add(parentId);
      set({ hierarchy: h, expandedIds: ids });
    },

    deleteNode(id) {
      if (id === get().hierarchy.id) return;
      const h = clone(get().hierarchy);
      const ids: string[] = [];
      detach(h, id, ids);
      const models = get().models.filter((m) => !ids.includes(m.nodeId));
      set({
        hierarchy: h,
        models,
        selectedNodeId: ids.includes(get().selectedNodeId ?? '')
          ? h.id
          : get().selectedNodeId,
      });
    },
  };
};
