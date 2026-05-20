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
  enterprise: ['plant', 'workshop', 'group'],
  plant: ['workshop', 'site', 'group'],
  workshop: ['site', 'group'],
  site: ['group', 'equipment'],
  group: ['group', 'equipment'],
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
            <button
              onClick={startEdit}
              title="Изменить имя и параметры узла."
            >
              Редактировать
            </button>
            {CHILD_TYPES[node.type].map((t) => (
              <button
                key={t}
                title={`Добавить вложенный узел типа «${TYPE_LABEL[t]}».`}
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
                title="Удалить узел и всё вложенное в него (с подтверждением)."
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
            <button onClick={save} title="Сохранить изменения.">Сохранить</button>
            <button onClick={() => setEditing(false)} title="Отменить редактирование.">Отмена</button>
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
                        title="Удалить этот атрибут."
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
                      title="Добавить пустую пару «Ключ — Значение» в атрибуты узла."
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
      <NodePprCard nodeId={node.id} />
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

/**
 * Сводный график ППР на уровне узла иерархии (парк-уровень, п.6.4 ТЗ —
 * «Сформировать графики ППР» для всех ТОР узла). Раскладывает события
 * по месяцам исходя из периодичностей ВВ каждой модели и режима 24 ч/сут.
 */
function NodePprCard({ nodeId }: { nodeId: string }) {
  const hierarchy = useStore((s) => s.hierarchy);
  const models = useStore((s) => s.models);
  const list = modelsForNode({ hierarchy, models }, nodeId);
  const [startStr, setStartStr] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [horizonYears, setHorizonYears] = useState(1);

  const allActs = list.flatMap((m) =>
    (m.actions ?? [])
      .filter((a) => typeof a.periodHours === 'number' && (a.periodHours as number) > 0)
      .map((a) => ({ model: m, action: a })),
  );
  if (list.length === 0) {
    return null;
  }
  if (allActs.length === 0) {
    return (
      <div className="card">
        <h3>Сводный график ППР · {list.length} ТОР</h3>
        <div className="muted small">
          Нет ВВ с периодичностью. Заполните «ВВ» на моделях, чтобы увидеть
          сводный план.
        </div>
      </div>
    );
  }
  const hoursPerDay = 24;
  const start = new Date(startStr);
  const horizonDays = horizonYears * 365;
  type Ev = {
    modelCode: string;
    modelId: string;
    actionName: string;
    date: Date;
  };
  const events: Ev[] = [];
  for (const { model, action } of allActs) {
    const periodDays = (action.periodHours as number) / hoursPerDay;
    let day = periodDays;
    while (day <= horizonDays) {
      const d = new Date(start);
      d.setDate(d.getDate() + Math.round(day));
      events.push({
        modelCode: model.normalizedCode || model.rawCode,
        modelId: model.id,
        actionName: action.name,
        date: d,
      });
      day += periodDays;
    }
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  const byYearMonth = new Map<string, Ev[]>();
  for (const e of events) {
    const k = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`;
    (byYearMonth.get(k) ?? byYearMonth.set(k, []).get(k)!).push(e);
  }

  return (
    <div className="card">
      <h3>
        Сводный график ППР · {list.length} ТОР · {allActs.length} ВВ
      </h3>
      <div className="row-flex" style={{ gap: 8, marginBottom: 8 }}>
        <label className="row-flex" style={{ gap: 4 }}>
          Старт
          <input
            type="date"
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
          />
        </label>
        <label className="row-flex" style={{ gap: 4 }}>
          Горизонт, лет
          <select
            value={horizonYears}
            onChange={(e) => setHorizonYears(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={5}>5</option>
          </select>
        </label>
        <span className="muted small">
          Событий: {events.length} · режим: 24 ч/сут
        </span>
      </div>
      <table className="models">
        <thead>
          <tr>
            <th style={{ width: 90 }}>Месяц</th>
            <th>События (ТОР · ВВ)</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(byYearMonth.entries()).map(([ym, evs]) => (
            <tr key={ym}>
              <td className="mono">{ym}</td>
              <td>
                {evs.map((e, i) => (
                  <span
                    key={i}
                    className="chip"
                    title={`${e.modelCode} · ${e.actionName} · ${e.date.toLocaleDateString('ru')}`}
                    style={{ marginRight: 4, marginBottom: 2, display: 'inline-block' }}
                  >
                    {e.date.getDate().toString().padStart(2, '0')}.
                    {String(e.date.getMonth() + 1).padStart(2, '0')} ·{' '}
                    {e.modelCode} · {e.actionName}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
