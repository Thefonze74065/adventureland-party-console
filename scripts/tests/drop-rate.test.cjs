const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDropRate, effectiveDropRate } = require('../../dashboard/features/party/drop-rate.ts');

test('probabilities cap at certainty while explicit stack quantities remain visible', () => {
  assert.equal(formatDropRate({rate:15,quantity:1}), '1/1\n(100%)');
  assert.equal(formatDropRate({rate:1,originRate:15,quantity:1,sourceType:'monster',acquisitionPath:['tombkey']}), '1/1\n(100%)');
  assert.equal(formatDropRate({rate:15,quantity:2}), '1/1\n(100%) ×2');
  assert.equal(formatDropRate({rate:1,quantity:15}), '1/1\n(100%) ×15');
});

test('fractional extra rolls, rare chances and indirect rewards retain their probabilities', () => {
  assert.equal(formatDropRate({rate:1.5,quantity:1}), '1/1\n(100%)');
  assert.equal(formatDropRate({rate:0.000125,quantity:1}), '1/8,000\n(0.0125%)');
  assert.equal(formatDropRate({rate:0,quantity:1}), '0/1\n(0%)');
  assert.equal(formatDropRate({rate:0.5,quantity:3}), '1/2\n(50%) ×3');
  assert.equal(effectiveDropRate({rate:0.25,originRate:15,quantity:1,sourceType:'monster',acquisitionPath:['box','reward']}), 0.25);
  assert.equal(effectiveDropRate({rate:0.1,originRate:15,quantity:1,sourceType:'world'}), 0.1);
});
