import { describe, it, expect } from 'vitest';
import {
  canon,
  clone,
  walk,
  findNode,
  detach,
  seedInitialExpanded,
  collectNodePath,
  uid,
} from '../store/helpers';
import type { HierarchyNode } from '../domain/types';

const tree: HierarchyNode = {
  id: 'root',
  type: 'enterprise',
  name: 'Root',
  children: [
    {
      id: 'shop1',
      type: 'workshop',
      name: 'Shop 1',
      children: [
        { id: 'site1', type: 'site', name: 'Site 1', children: [] },
        { id: 'site2', type: 'site', name: 'Site 2', children: [] },
      ],
    },
    {
      id: 'shop2',
      type: 'workshop',
      name: 'Shop 2',
      children: [],
    },
  ],
};

describe('canon', () => {
  it('uppercases and strips whitespace', () => {
    expect(canon(' hello World ')).toBe('HELLOWORLD');
  });
  it('handles null/undefined', () => {
    expect(canon(null as unknown as string)).toBe('');
  });
});

describe('clone', () => {
  it('deep-clones an object', () => {
    const obj = { a: { b: [1, 2, 3] } };
    const copy = clone(obj);
    expect(copy).toEqual(obj);
    expect(copy).not.toBe(obj);
    expect(copy.a).not.toBe(obj.a);
  });
});

describe('walk', () => {
  it('visits every node', () => {
    const ids: string[] = [];
    walk(tree, (n) => ids.push(n.id));
    expect(ids).toEqual(['root', 'shop1', 'site1', 'site2', 'shop2']);
  });
});

describe('findNode', () => {
  it('finds a node by id', () => {
    expect(findNode(tree, 'site1')?.name).toBe('Site 1');
  });
  it('returns undefined for missing id', () => {
    expect(findNode(tree, 'nonexistent')).toBeUndefined();
  });
});

describe('detach', () => {
  it('removes a subtree and collects ids', () => {
    const t = clone(tree);
    const removed: string[] = [];
    detach(t, 'shop1', removed);
    expect(removed).toContain('shop1');
    expect(removed).toContain('site1');
    expect(removed).toContain('site2');
    expect(t.children.length).toBe(1);
    expect(t.children[0].id).toBe('shop2');
  });
});

describe('seedInitialExpanded', () => {
  it('returns first two levels', () => {
    const ids = seedInitialExpanded(tree);
    expect(ids.has('root')).toBe(true);
    expect(ids.has('shop1')).toBe(true);
    expect(ids.has('site1')).toBe(true); // depth 2 = children of children
    expect(ids.has('shop2')).toBe(true);
  });
});

describe('collectNodePath', () => {
  it('returns ancestor path as string', () => {
    const path = collectNodePath(tree, 'site1');
    expect(path).toBe('Root / Shop 1 / Site 1');
  });
  it('returns undefined for missing target', () => {
    expect(collectNodePath(tree, 'missing')).toBeUndefined();
  });
});

describe('uid', () => {
  it('generates unique ids with prefix', () => {
    const a = uid('test');
    const b = uid('test');
    expect(a).toMatch(/^test-/);
    expect(a).not.toBe(b);
  });
});
