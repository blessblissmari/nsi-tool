/**
 * Data slice — classifier, normalization rules, references.
 */
import type { StateCreator } from 'zustand';
import type { Classifier, NormalizationRules, ReferenceData } from '../domain/types';
import type { ReferenceKind } from '../parsers/references';
import type { Store } from './types';
import {
  SEED_CLASSIFIER,
  SEED_NORMALIZATION_RULES,
  SEED_REFERENCES,
} from '../data/seed';

export type DataSlice = Pick<
  Store,
  'classifier' | 'rules' | 'references' | 'setClassifier' | 'setRules' | 'applyReference'
>;

export const createDataSlice: StateCreator<Store, [], [], DataSlice> = (
  set,
  get,
) => ({
  classifier: SEED_CLASSIFIER,
  rules: SEED_NORMALIZATION_RULES,
  references: SEED_REFERENCES,

  setClassifier(c: Classifier) {
    set({ classifier: c });
  },

  setRules(r: NormalizationRules) {
    set({ rules: r });
  },

  applyReference(kind: ReferenceKind, data: Partial<ReferenceData>) {
    const cur = get().references;
    const next: ReferenceData = { ...cur };
    let count = 0;
    if (kind === 'actionsRef' && data.actions) {
      next.actions = data.actions;
      count = data.actions.length;
    }
    if (kind === 'operationsRef' && data.operations) {
      next.operations = data.operations;
      count = data.operations.length;
    }
    if (kind === 'specialtiesRef' && data.specialties) {
      next.specialties = data.specialties;
      count = data.specialties.length;
    }
    if (kind === 'unitsRef' && data.units) {
      next.units = data.units;
      count = data.units.length;
    }
    set({ references: next });
    return { kind, count };
  },
});
