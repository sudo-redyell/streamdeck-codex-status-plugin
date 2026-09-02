'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ACTIONS, parseArgs } = require('../plugin/io.github.streamdeck-codex-status.sdPlugin/index');

test('OpenDeck 시작 인자를 파싱한다', () => {
  assert.deepEqual(parseArgs([
    '-port', '12345', '-pluginUUID', 'plugin-id', '-registerEvent', 'registerPlugin'
  ]), {
    port: '12345',
    pluginUUID: 'plugin-id',
    registerEvent: 'registerPlugin'
  });
});

test('세 기능의 라이트·다크 액션을 모두 등록한다', () => {
  assert.equal(ACTIONS.size, 6);
  assert.deepEqual(
    [...ACTIONS.values()].map(({ kind, theme }) => `${kind}:${theme}`).sort(),
    [
      'sessions:dark',
      'sessions:light',
      'status:dark',
      'status:light',
      'summary:dark',
      'summary:light'
    ]
  );
});
