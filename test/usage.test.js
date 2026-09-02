'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  SessionUsageTracker,
  TokenUsageMonitor,
  tokenDelta
} = require('../plugin/io.github.streamdeck-codex-status.sdPlugin/lib/usage');

function tokenRecord(timestamp, total, last = total) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: total.input,
          cached_input_tokens: total.cached || 0,
          cache_write_input_tokens: total.cacheWrite || 0,
          output_tokens: total.output,
          reasoning_output_tokens: total.reasoning || 0,
          total_tokens: total.input + total.output
        },
        last_token_usage: {
          input_tokens: last.input,
          cached_input_tokens: last.cached || 0,
          cache_write_input_tokens: last.cacheWrite || 0,
          output_tokens: last.output,
          reasoning_output_tokens: last.reasoning || 0,
          total_tokens: last.input + last.output
        }
      }
    }
  };
}

test('누적 토큰의 증가·중복·리셋을 올바르게 계산한다', () => {
  const previous = { inputTokens: 80, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 100 };
  const current = { inputTokens: 120, cachedInputTokens: 30, cacheWriteInputTokens: 0, outputTokens: 30, reasoningOutputTokens: 8, totalTokens: 150 };
  const last = { inputTokens: 40, cachedInputTokens: 10, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 3, totalTokens: 50 };
  assert.equal(tokenDelta(current, previous, last).totalTokens, 50);
  assert.equal(tokenDelta(previous, previous, last).totalTokens, 0);
  assert.deepEqual(tokenDelta(last, current, last), last);
});

test('부분 JSONL은 완성된 뒤 한 번만 집계한다', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-token-partial-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout-partial.jsonl');
  const record = JSON.stringify(tokenRecord('2026-09-01T03:00:00Z', { input: 80, output: 20 }));
  await fs.writeFile(file, record.slice(0, 50));
  const tracker = new SessionUsageTracker();
  assert.equal((await tracker.refresh(file)).dailyBuckets.size, 0);
  await fs.appendFile(file, `${record.slice(50)}\n`);
  const entry = await tracker.refresh(file);
  const total = [...entry.dailyBuckets.values()][0].get('unknown').totalTokens;
  assert.equal(total, 100);
  assert.equal((await tracker.refresh(file)).dailyBuckets.size, 1);
});

test('월·일 전체와 최근 세션을 증분 집계한다', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-token-monitor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, '.codex');
  const firstDirectory = path.join(codexHome, 'sessions', '2026', '08', '31');
  const secondDirectory = path.join(codexHome, 'sessions', '2026', '09', '01');
  await fs.mkdir(firstDirectory, { recursive: true });
  await fs.mkdir(secondDirectory, { recursive: true });
  const first = path.join(firstDirectory, 'rollout-first.jsonl');
  const second = path.join(secondDirectory, 'rollout-second.jsonl');
  const firstRows = [
    { timestamp: '2026-08-31T10:00:00+09:00', type: 'session_meta', payload: { id: 'first', cwd: '/workspace/alpha' } },
    { timestamp: '2026-08-31T10:00:01+09:00', type: 'turn_context', payload: { model: 'gpt-5.6-terra' } },
    tokenRecord('2026-08-31T10:00:02+09:00', { input: 80, output: 20 }),
    tokenRecord('2026-09-01T08:00:00+09:00', { input: 120, output: 30 }, { input: 40, output: 10 }),
    tokenRecord('2026-09-01T08:00:01+09:00', { input: 120, output: 30 }, { input: 40, output: 10 })
  ];
  const secondRows = [
    { timestamp: '2026-09-01T09:00:00+09:00', type: 'session_meta', payload: { id: 'second', cwd: '/workspace/beta' } },
    { timestamp: '2026-09-01T09:00:01+09:00', type: 'turn_context', payload: { model: 'gpt-5.6-luna' } },
    tokenRecord('2026-09-01T09:00:02+09:00', { input: 80, output: 20 })
  ];
  await fs.writeFile(first, `${firstRows.map(JSON.stringify).join('\n')}\n`);
  await fs.writeFile(second, `${secondRows.map(JSON.stringify).join('\n')}\n`);

  const monitor = new TokenUsageMonitor({
    codexHome,
    liveSessionFinder: async () => ({ processCount: 1, sessionPaths: [first] }),
    now: () => new Date('2026-09-01T12:00:00+09:00'),
    pricing: { fallbackModel: 'gpt-5.6-terra', krwPerUsd: 1_000 }
  });
  const initial = await monitor.getSnapshot();
  assert.equal(initial.monthly.usage.totalTokens, 150);
  assert.equal(initial.daily.usage.totalTokens, 150);
  assert.equal(initial.sessions.length, 2);
  assert.equal(initial.sessions[0].name, 'beta');

  await fs.appendFile(first, `${JSON.stringify(tokenRecord(
    '2026-09-01T12:00:01+09:00',
    { input: 160, output: 40 },
    { input: 40, output: 10 }
  ))}\n`);
  const updated = await monitor.getSnapshot();
  assert.equal(updated.daily.usage.totalTokens, 200);
  assert.equal(updated.sessions[0].name, 'alpha');
});
