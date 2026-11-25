import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionLines } from './format.js';

test('descrição vira lista: uma linha por item, sem os traços digitados', () => {
  assert.deepEqual(descriptionLines('-200g\n- 250g\r\n•300g'), ['200g', '250g', '300g']);
  assert.deepEqual(descriptionLines('450g de frango frito empanado\n\n450g de batata frita '), ['450g de frango frito empanado', '450g de batata frita']);
  assert.deepEqual(descriptionLines('Massa crocante de churros'), ['Massa crocante de churros']);
  assert.deepEqual(descriptionLines(''), []);
  assert.deepEqual(descriptionLines(null), []);
});
