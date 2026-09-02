'use strict';

const AZURE_RETAIL_SOURCE =
  'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview';

// Azure Retail Prices API, Korea Central, Global Standard, Short Context,
// USD/1M tokens. 2026-08-31에 조회했으며 SKU별 effective date를 함께 보존합니다.
const DEFAULT_RATES = Object.freeze({
  'gpt-5.6-sol': Object.freeze({ input: 5, cachedInput: 0.5, output: 30, effectiveDate: '2026-07-01' }),
  'gpt-5.6-terra': Object.freeze({ input: 2, cachedInput: 0.2, output: 12, effectiveDate: '2026-08-01' }),
  'gpt-5.6-luna': Object.freeze({ input: 0.2, cachedInput: 0.02, output: 1.2, effectiveDate: '2026-08-01' })
});

const DEFAULT_KRW_PER_USD = 1447.35;
const DEFAULT_FALLBACK_MODEL = 'gpt-5.6-terra';

function numberFromEnvironment(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePricingModel(model) {
  const text = String(model || '').toLowerCase().replace(/[._/-]+/g, ' ');
  const version = '\\b5\\s*6\\b';
  if (new RegExp(`${version}.*\\bsol\\b|\\bsol\\b.*${version}`).test(text)) return 'gpt-5.6-sol';
  if (new RegExp(`${version}.*\\bluna\\b|\\bluna\\b.*${version}`).test(text)) return 'gpt-5.6-luna';
  if (new RegExp(`${version}.*\\bterra\\b|\\bterra\\b.*${version}`).test(text)) return 'gpt-5.6-terra';
  return null;
}

function getPricingOptions(environment = process.env) {
  const requestedFallback = normalizePricingModel(
    environment.CODEX_STATUS_DEFAULT_AZURE_MODEL || DEFAULT_FALLBACK_MODEL
  );
  return {
    fallbackModel: requestedFallback || DEFAULT_FALLBACK_MODEL,
    krwPerUsd: numberFromEnvironment(environment.CODEX_STATUS_KRW_PER_USD, DEFAULT_KRW_PER_USD),
    source: AZURE_RETAIL_SOURCE
  };
}

function resolveRate(model, options = getPricingOptions()) {
  const matchedModel = normalizePricingModel(model);
  const pricingModel = matchedModel || options.fallbackModel;
  return {
    estimatedFromFallback: matchedModel === null,
    pricingModel,
    rate: DEFAULT_RATES[pricingModel]
  };
}

function calculateCost(usage, model, options = getPricingOptions()) {
  const resolved = resolveRate(model, options);
  if (!resolved.rate) {
    return { estimatedFromFallback: true, priced: false, pricingModel: null, totalKrw: 0, totalUsd: 0 };
  }

  const cachedInput = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const cacheWrite = Math.min(Math.max(0, usage.inputTokens - cachedInput), usage.cacheWriteInputTokens);
  const regularInput = Math.max(0, usage.inputTokens - cachedInput - cacheWrite);
  const perMillion = (tokens, price) => tokens * price / 1_000_000;
  const totalUsd =
    perMillion(regularInput, resolved.rate.input) +
    perMillion(cachedInput, resolved.rate.cachedInput) +
    // Azure 카탈로그에 cache-write 전용 meter가 없으므로 일반 입력 단가를 적용합니다.
    perMillion(cacheWrite, resolved.rate.input) +
    // output_tokens는 reasoning_output_tokens를 포함하므로 한 번만 과금합니다.
    perMillion(usage.outputTokens, resolved.rate.output);

  return {
    estimatedFromFallback: resolved.estimatedFromFallback,
    priced: true,
    pricingModel: resolved.pricingModel,
    totalKrw: totalUsd * options.krwPerUsd,
    totalUsd
  };
}

module.exports = {
  AZURE_RETAIL_SOURCE,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_KRW_PER_USD,
  DEFAULT_RATES,
  calculateCost,
  getPricingOptions,
  normalizePricingModel,
  resolveRate
};
