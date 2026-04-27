import { useStore } from '../store';
import type { HierarchyNode } from '../domain/types';

const TYPE_LABEL: Record<HierarchyNode['type'], string> = {
  enterprise: 'Предприятие',
  plant: 'Завод',
  workshop: 'Цех',
  site: 'Участок',
  group: 'Группа',
  equipment: 'Оборудование',
};

export function Tree() {
  const hierarchy = useStore((s) => s.hierarchy);
  return (
    <ul className="tree">
      <TreeItem node={hierarchy} depth={0} />
    </ul>
  );
}

function TreeItem({ node, depth }: { node: HierarchyNode; depth: number }) {
  const expanded = useStore((s) => s.expandedIds.has(node.id));
  const selected = useStore((s) => s.selectedNodeId === node.id);
  const toggle = useStore((s) => s.toggleExpand);
  const select = useStore((s) => s.selectNode);
  const hasChildren = node.children.length > 0;
  const modelCount = countModels(node);

  return (
    <li>
      <div
        className={'row' + (selected ? ' sel' : '')}
        style={{ paddingLeft: depth * 12 }}
        onClick={() => select(node.id)}
      >
        <span
          className="caret"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggle(node.id);
          }}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className={`type t-${node.type}`}>{node.levelLabel || TYPE_LABEL[node.type]}</span>
        <span className="name">{node.name}</span>
        {modelCount > 0 && <span className="count">{modelCount}</span>}
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function countModels(n: HierarchyNode): number {
  let total = n.modelIds?.length ?? 0;
  const stack = [...n.children];
  while (stack.length) {
    const x = stack.pop()!;
    total += x.modelIds?.length ?? 0;
    stack.push(...x.children);
  }
  return total;
}
