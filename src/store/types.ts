/**
 * Store interface — the shape of the combined zustand store.
 *
 * Kept in a separate file so slices can reference the full type
 * without circular imports.
 */
import type {
  Classifier,
  ClassificationProposal,
  EquipmentModel,
  FailureRecord,
  HierarchyNode,
  NormalizationRules,
  ReferenceData,
  TechCardRow,
} from '../domain/types';
import type { ClassificationRow } from '../parsers/classification';
import type { ActionsImportRow } from '../parsers/actions';
import type { CharsImportRow } from '../parsers/charsImport';
import type { ReferenceKind } from '../parsers/references';

export interface Store {
  // ── Data ──────────────────────────────────────────────────
  hierarchy: HierarchyNode;
  models: EquipmentModel[];
  classifier: Classifier;
  rules: NormalizationRules;
  references: ReferenceData;

  // ── UI state ─────────────────────────────────────────────
  selectedNodeId?: string;
  selectedModelId?: string;
  expandedIds: Set<string>;

  // ── Hierarchy ────────────────────────────────────────────
  setHierarchy(h: HierarchyNode, models: EquipmentModel[]): void;
  resetToSeed(): void;
  clearAll(): void;
  renameNode(id: string, name: string): void;
  updateNode(id: string, patch: Partial<HierarchyNode>): void;
  addChildNode(parentId: string, type: HierarchyNode['type'], name: string): void;
  deleteNode(id: string): void;

  // ── UI navigation ────────────────────────────────────────
  selectNode(id: string | undefined): void;
  selectModel(id: string | undefined): void;
  toggleExpand(id: string): void;
  expandAll(): void;
  collapseAll(): void;

  // ── Classifier / Rules / References ──────────────────────
  setClassifier(c: Classifier): void;
  setRules(r: NormalizationRules): void;
  applyReference(kind: ReferenceKind, data: Partial<ReferenceData>): {
    kind: ReferenceKind;
    count: number;
  };

  // ── Models CRUD ──────────────────────────────────────────
  addModel(nodeId: string, rawCode: string): void;
  updateModel(id: string, patch: Partial<EquipmentModel>): void;
  deleteModel(id: string): void;

  // ── Bulk operations ──────────────────────────────────────
  normalizeAll(scope?: ReadonlySet<string>): { done: number };
  classifyByClassifier(scope?: ReadonlySet<string>): {
    matched: number;
    suggested: number;
    total: number;
  };
  applyClassification(rows: ClassificationRow[]): {
    matched: number;
    total: number;
    unmatched: string[];
  };
  acceptProposal(modelId: string, proposal: ClassificationProposal): void;
  applyActions(rows: ActionsImportRow[]): {
    matched: number;
    total: number;
    items: number;
  };
  applyCharacteristics(rows: CharsImportRow[]): {
    matched: number;
    total: number;
    items: number;
  };

  // ── Tech cards ───────────────────────────────────────────
  upsertTechCardRow(
    modelId: string,
    row: Partial<TechCardRow> & { id?: string },
  ): void;
  deleteTechCardRow(modelId: string, rowId: string): void;
  dedupeTechCard(modelId: string): number;
  setTechCard(modelId: string, rows: TechCardRow[]): void;

  // ── Reliability ──────────────────────────────────────────
  setFailures(modelId: string, failures: FailureRecord[]): void;
}
