// Self-check: pnpm tsx plugins/ocr-paddle/src/index.check.ts
import assert from 'node:assert/strict';
import { polygonToBox, toPaddleLang } from './index.js';

assert.deepEqual(
  polygonToBox([
    [10, 20],
    [50, 18],
    [52, 80],
    [9, 82],
  ]),
  { x: 9, y: 18, width: 43, height: 64 },
);
assert.equal(toPaddleLang('ja'), 'japan');
assert.equal(toPaddleLang('pt-BR'), 'pt');
assert.equal(toPaddleLang('es-MX'), 'es');
console.log('ocr-paddle ok');
