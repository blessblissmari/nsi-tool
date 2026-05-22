/**
 * Backward-compatible re-export.
 *
 * The store has been split into focused slices under src/store/.
 * This file re-exports everything so existing imports continue to work.
 */
export { useStore, torsForNode, modelsForNode } from './store/index';
export type { Store } from './store/types';
