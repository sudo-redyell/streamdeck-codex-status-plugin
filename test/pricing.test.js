'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_KRW_PER_USD,
  calculateCost,
  getPricingOptions,
  normalizePricingModel
} = require('../plugin/io.github.streamdeck-codex-status.sdPlugin/lib/pricing');

test('GPT-5.6 모델 별칭을 Azure 가격 SKU로 정규화한다', () => {
  assert.equal(normalizePricingModel('gpt-5.6-sol-global'), 'gpt-5.6-sol');
  assert.equal(normalizePricingModel('azure/5_6_terra'), 'gpt-5.6-terra');
  assert.equal(normalizePricingModel('luna-5.6'), 'gpt-5.6-luna');
  assert.equal(normalizePricingModel('future-model'), null);
});

test('캐시·일반 입력과 출력을 중복 없이 과금한다', () => {
  const usage = {
    inputTokens: 1_000_000,
    cachedInputTokens: 600_000,
    cacheWriteInputTokens: 300_000,
    outputTokens: 100_000,
    reasoningOutputTokens: 40_000,
    totalTokens: 1_100_000
  };
  const cost = calculateCost(usage, 'gpt-5.6-terra', {
    fallbackModel: 'gpt-5.6-terra',
    krwPerUsd: 1_000
  });
  assert.equal(cost.priced, true);
  assert.equal(cost.estimatedFromFallback, false);
  assert.ok(Math.abs(cost.totalUsd - 2.12) < 1e-9);
  assert.ok(Math.abs(cost.totalKrw - 2_120) < 1e-9);
});

test('알 수 없는 모델은 설정된 GPT-5.6 SKU로 추정하고 표시한다', () => {
  const options = getPricingOptions({
    CODEX_STATUS_DEFAULT_AZURE_MODEL: 'gpt-5.6-luna',
    CODEX_STATUS_KRW_PER_USD: '1500'
  });
  const cost = calculateCost({
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 1_000_000
  }, 'unknown', options);
  assert.equal(cost.pricingModel, 'gpt-5.6-luna');
  assert.equal(cost.estimatedFromFallback, true);
  assert.equal(cost.totalKrw, 300);
  assert.equal(getPricingOptions({}).krwPerUsd, DEFAULT_KRW_PER_USD);
});
