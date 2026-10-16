const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/js/ui.js', 'utf8');
const start = source.indexOf('export function reconcileChildren(');
const end = source.indexOf('\nfunction append(', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end).replace('export ', ''), context);
const reconcile = context.reconcileChildren;

class Node {
  constructor(text) { this.text = text; this.parent = null; }
  get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
}
class Container {
  constructor(...nodes) { this.children = nodes; this.moves = []; nodes.forEach(n => { n.parent = this; }); }
  get firstChild() { return this.children[0] || null; }
  insertBefore(node, ref) {
    if (node === ref) return;
    if (node.parent) this.moves.push(node);
    node.remove();
    const i = ref ? this.children.indexOf(ref) : this.children.length;
    assert.ok(i >= 0, 'reference node must be attached');
    this.children.splice(i, 0, node); node.parent = this;
  }
  replaceChild(node, old) { this.insertBefore(node, old); old.remove(); }
}

test('editing hi to hiii preserves every later bubble without detaching it', () => {
  const before = new Node('earlier message'), hi = new Node('hi');
  const later = Array.from({ length: 100 }, (_, i) => new Node('later ' + i));
  const box = new Container(before, hi, ...later);
  const edited = new Node('hiii');
  reconcile(box, [before, edited, ...later]);
  assert.deepEqual(box.children, [before, edited, ...later]);
  assert.deepEqual(box.moves, []);
  assert.equal(hi.parent, null);
  for (const text of ['hello again', 'longer edited message', 'hi']) {
    const next = new Node(text);
    reconcile(box, [before, next, ...later]);
    assert.deepEqual(box.children, [before, next, ...later]);
    assert.deepEqual(box.moves, []);
  }
});

test('deletions, insertions, reordering and clearing preserve exact message order', () => {
  const a = new Node('a'), b = new Node('b'), c = new Node('c'), d = new Node('d');
  const box = new Container(a, b, c);
  for (const desired of [[a, c], [d, a, c], [c, a, d], [new Node('edited c'), a, d], []]) {
    reconcile(box, desired);
    assert.deepEqual(box.children, desired);
  }
});

test('text edits invalidate cached bubbles even when editedAt has not changed', () => {
  const app = fs.readFileSync('public/js/app.js', 'utf8');
  const expression = app.match(/const key = (\[m\.id,.*?\.join\('\|'\));/)[1];
  const context = vm.createContext({ m: { id: 1, text: 'hi', editedAt: 1234 }, first: true, last: true, status: 'Sent', scamV: 0, user: () => ({}) });
  const before = vm.runInContext(expression, context);
  context.m.text = 'hiii';
  assert.notEqual(vm.runInContext(expression, context), before);
});
