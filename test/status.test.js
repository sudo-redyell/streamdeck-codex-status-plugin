'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CodexStatusMonitor } = require('../plugin/io.github.streamdeck-codex-status.sdPlugin/lib/status');

function lifecycle(type, turnId = 'turn-1') {
  return `${JSON.stringify({ type: 'event_msg', payload: { type, turn_id: turnId } })}\n`;
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-status-usage-'));
  const procRoot = path.join(root, 'proc');
  const processRoot = path.join(procRoot, '123');
  const fdRoot = path.join(processRoot, 'fd');
  const sessionRoot = path.join(root, 'sessions', '2026', '09', '01');
  const sessionPath = path.join(sessionRoot, 'rollout-test.jsonl');
  await fs.mkdir(fdRoot, { recursive: true });
  await fs.mkdir(sessionRoot, { recursive: true });
  await fs.writeFile(path.join(processRoot, 'comm'), 'codex\n');
  await fs.writeFile(sessionPath, lifecycle('task_started'));
  await fs.symlink(sessionPath, path.join(fdRoot, '9'));
  return { procRoot, root, sessionPath };
}

test('작업 중, 유휴, 오프라인 상태와 세션 수를 판정한다', async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  const monitor = new CodexStatusMonitor({ procRoot: data.procRoot });
  assert.deepEqual(await monitor.getStatus(), {
    state: 'working', activeTasks: 1, processCount: 1, sessionCount: 1
  });
  await fs.appendFile(data.sessionPath, lifecycle('task_complete'));
  assert.deepEqual(await monitor.getStatus(), {
    state: 'complete', activeTasks: 0, processCount: 1, sessionCount: 1
  });
  await fs.rm(path.join(data.procRoot, '123'), { recursive: true, force: true });
  assert.deepEqual(await monitor.getStatus(), {
    state: 'offline', activeTasks: 0, processCount: 0, sessionCount: 0
  });
});
