const { test } = require('node:test');
const assert = require('node:assert/strict');
const { award, mutate, fresh } = require('../server/pet-shop');
const bad = message => new Error(message);
const now = Date.UTC(2026, 9, 18, 10);
test('PingCoins cooldowns, shared daily cap and reset', () => {
  const s = fresh();
  assert.equal(award(s, 'chat', now), 2);
  assert.equal(award(s, 'chat', now + 1), 0);
  assert.equal(award(s, 'call', now), 10);
  assert.equal(award(s, 'call', now + 60000), 0);
  for (let i = 1; i < 100; i++) award(s, 'chat', now + i * 60000);
  assert.equal(s.balance, 100);
  assert.equal(award(s, 'call', now + 100 * 60000), 0);
  assert.equal(award(s, 'chat', now + 86400000), 2);
  assert.equal(s.balance, 102);
});
test('purchases cannot overspend, trust client prices, or charge twice for the same pet', () => {
  const s = fresh();
  assert.throws(() => mutate(s, { action: 'buy', kind: 'cat', price: 0 }, bad), /earn more/);
  s.balance = 60;
  mutate(s, { action: 'buy', kind: 'cat', price: 0 }, bad);
  assert.equal(s.balance, 20);
  mutate(s, { action: 'buy', kind: 'cat' }, bad);
  assert.equal(s.balance, 20);
  assert.throws(() => mutate(s, { action: 'buy', kind: 'dog' }, bad));
  assert.throws(() => mutate(s, { action: 'equip', kind: 'constructor' }, bad));
  assert.throws(() => mutate(s, { action: 'equip', kind: 'dog' }, bad));
});
test('customization is per pet and outfits layer with sunglasses', () => {
  const s = fresh(); s.balance = 200;
  mutate(s, { action: 'buy', kind: 'cat' }, bad);
  mutate(s, { action: 'customize', color: 'rose', outfit: 'scarf', glasses: true, name: 'Peach' }, bad);
  mutate(s, { action: 'buy', kind: 'dog' }, bad);
  assert.equal(s.owned.dog.color, 'natural');
  assert.equal(s.owned.cat.name, 'Peach');
  assert.equal(s.owned.cat.outfit, 'scarf');
  assert.equal(s.owned.cat.glasses, true);
  for (const body of [{ color: '<script>' }, { outfit: 'unknown' }, { name: '' }, { glasses: 'yes' }]) {
    assert.throws(() => mutate(s, { action: 'customize', ...body }, bad));
  }
});
test('new wallets and their collections are independent', () => {
  const a = fresh(), b = fresh(); a.balance = 40;
  mutate(a, { action: 'buy', kind: 'cat' }, bad);
  assert.deepEqual(b.owned, {});
  assert.equal(b.active, null);
});
