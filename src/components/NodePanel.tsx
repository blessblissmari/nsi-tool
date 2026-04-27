import { useStore, modelsForNode } from '../store';
import type { HierarchyNode, NodeType } from '../domain/types';
import { useState } from 'react';
import { ModelsTable } from './ModelsTable';

const TYPE_LABEL: Record<NodeType, string> = {
  enterprise: 'Предприятие',
  plant: 'Завод',
  workshop: 'Цех',
  site: 'Участок',
  group: 'Группа',
  equipment: 'Оборудование',
};

const CHILD_TYPES: Record<NodeType, NodeType[]> = {
  enterprise: ['plant'],
  plant: ['workshop', 'group'],
  workshop: ['site', 'group'],
  site: ['group'],
  group: ['group'],
  equipment: [],
};

function findNode(n: HierarchyNode, id: string): HierarchyNode | undefined {
  if (n.id === id) return n;
  for (const c of n.children) {
    const r = findNode(c, id);
    if (r) return r;
  }
}

export function NodePanel() {
  const nodeId = useStore((s) => s.selectedNodeId);
  const hierarchy = useStore((s) => s.hierarchy);
  const node = nodeId ? findNode(hierarchy, nodeId) : undefined;
  const renameNode = useStore((s) => s.renameNode);
  const updateNode = useStore((s) => s.updateNode);
  const addChildNode = useStore((s) => s.addChildNode);
  const deleteNode = useStore((s) => s.deleteNode);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    attrs: Array<[string, string]>;
  }>({ name: '', description: '', attrs: [] });

  if (!node) return <div className="panel empty">Выберите узел в иерархии</div>;

  const startEdit = () => {
    setDraft({
      name: node.name,
      description: node.description ?? '',
      attrs: Object.entries(node.attributes ?? {}),
    });
    setEditing(true);
  };
  const save = () => {
    renameNode(node.id, draft.name);
    const attrs: Record<string, string> = {};
    for (const [k, v] of draft.attrs) if (k.trim()) attrs[k.trim()] = v;
    updateNode(node.id, {
      description: draft.description,
      attributes: attrs,
    });
    setEditing(false);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className={`type t-${node.type}`}>{node.levelLabel || TYPE_LABEL[node.type]}</span>
        {!editing ? (
          <h2 className="title">{node.name}</h2>
        ) : (
          <input
            className="title-input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        )}
        <div className="spacer" />
        {!editing ? (
          <>
            <button onClick={startEdit}>Редактировать</button>
            {CHILD_TYPES[node.type].map((t) => (
              <button
                key={t}
                onClick={() => {
                  const name = prompt(`Имя нового узла «${TYPE_LABEL[t]}»`);
                  if (name) addChildNode(node.id, t, name);
                }}
              >
                + {TYPE_LABEL[t]}
              </button>
            ))}
            {node.type !== 'enterprise' && (
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`Удалить «${node.name}» и всё внутри?`))
                    deleteNode(node.id);
                }}
              >
                Удалить
              </button>
            )}
          </>
        ) : (
          <>
            <button onClick={save}>Сохранить</button>
            <button onClick={() => setEditing(false)}>Отмена</button>
          </>
        )}
      </div>

      <div className="card">
        <h3>Карточка узла</h3>
        {!editing ? (
          <>
            {node.description && <p className="desc">{node.description}</p>}
            <table className="kv">
              <tbody>
                {Object.entries(node.attributes ?? {}).map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
                {!node.attributes ||
                Object.keys(node.attributes).length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted">
                      Атрибуты не заполнены
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <label>
              Описание
              <textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            <table className="kv">
              <thead>
                <tr>
                  <th>Поле</th>
                  <th>Значение</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draft.attrs.map(([k, v], i) => (
                  <tr key={i}>
                    <td>
                      <input
                        value={k}
                        onChange={(e) => {
                          const a = [...draft.attrs];
                          a[i] = [e.target.value, v];
                          setDraft({ ...draft, attrs: a });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={v}
                        onChange={(e) => {
                          const a = [...draft.attrs];
                          a[i] = [k, e.target.value];
                          setDraft({ ...draft, attrs: a });
                        }}
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          const a = draft.attrs.filter((_, j) => j !== i);
                          setDraft({ ...draft, attrs: a });
                        }}
                      >
                        −
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3}>
                    <button
                      onClick={() =>
                        setDraft({
                          ...draft,
                          attrs: [...draft.attrs, ['', '']],
                        })
                      }
                    >
                      + поле
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>

      <ModelsList nodeId={node.id} />
    </div>
  );
}

function ModelsList({ nodeId }: { nodeId: string }) {
  const hierarchy = useStore((s) => s.hierarchy);
  const models = useStore((s) => s.models);
  const list = modelsForNode({ hierarchy, models }, nodeId);
  const node = findNode(hierarchy, nodeId)!;
  const directOnly = node.type === 'group' || node.type === 'equipment';

  return (
    <div className="card">
      <h3>
        {directOnly ? 'Модели и ТОР' : 'ТОР под узлом (включая вложенные)'} (
        {list.length})
      </h3>
      <ModelsTable models={list} nodeId={nodeId} />
    </div>
  );
}
