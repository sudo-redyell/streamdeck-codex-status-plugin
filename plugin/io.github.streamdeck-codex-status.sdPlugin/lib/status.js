'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SESSION_PATH_PATTERN =
  /\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-.*\.jsonl(?: \(deleted\))?$/;
const DELETED_FILE_SUFFIX = ' (deleted)';
const UNKNOWN_TURN = '__unknown_turn__';

class SessionTracker {
  constructor(fileSystem = fs) {
    this.fs = fileSystem;
    this.entries = new Map();
  }

  async isBusy(filePath) {
    let stat;
    try {
      stat = await this.fs.stat(filePath);
    } catch {
      this.entries.delete(filePath);
      return false;
    }

    let entry = this.entries.get(filePath);
    if (!entry || stat.size < entry.offset || stat.dev !== entry.device || stat.ino !== entry.inode) {
      entry = {
        activeTurn: null,
        device: stat.dev,
        inode: stat.ino,
        offset: 0,
        remainder: ''
      };
      this.entries.set(filePath, entry);
    }

    if (stat.size > entry.offset) {
      let handle;
      try {
        handle = await this.fs.open(filePath, 'r');
        const chunks = [];
        while (entry.offset < stat.size) {
          const length = Math.min(stat.size - entry.offset, 64 * 1024);
          const buffer = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(buffer, 0, length, entry.offset);
          if (bytesRead === 0) break;
          entry.offset += bytesRead;
          chunks.push(buffer.subarray(0, bytesRead));
        }
        this.#consume(entry, Buffer.concat(chunks).toString('utf8'));
      } catch {
        this.entries.delete(filePath);
        return false;
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch {
            // 프로세스 종료와 파일 읽기가 겹치면 FD가 먼저 닫힐 수 있습니다.
          }
        }
      }
    }

    return entry.activeTurn !== null;
  }

  forgetExcept(filePaths) {
    const activePaths = new Set(filePaths);
    for (const filePath of this.entries.keys()) {
      if (!activePaths.has(filePath)) this.entries.delete(filePath);
    }
  }

  #consume(entry, text) {
    const lines = `${entry.remainder}${text}`.split('\n');
    entry.remainder = lines.pop() || '';

    for (const line of lines) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type !== 'event_msg') continue;
      const eventType = record.payload?.type;
      const turnId = record.payload?.turn_id;

      if (eventType === 'task_started') {
        // 한 Codex 프로세스의 새 foreground turn은 고아 상태의 이전 turn을 대체합니다.
        entry.activeTurn = turnId || UNKNOWN_TURN;
      } else if (eventType === 'task_complete' || eventType === 'turn_aborted') {
        if (!turnId || entry.activeTurn === UNKNOWN_TURN || entry.activeTurn === turnId) {
          entry.activeTurn = null;
        }
      }
    }
  }
}

async function readText(fileSystem, filePath) {
  return String(await fileSystem.readFile(filePath, 'utf8')).trim();
}

async function findLiveCodexSessions(procRoot = '/proc', fileSystem = fs) {
  let processEntries;
  try {
    processEntries = await fileSystem.readdir(procRoot, { withFileTypes: true });
  } catch {
    return { processCount: 0, sessionPaths: [] };
  }

  const processIds = processEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name);

  const results = await Promise.all(processIds.map(async (processId) => {
    const processPath = path.join(procRoot, processId);
    try {
      if (await readText(fileSystem, path.join(processPath, 'comm')) !== 'codex') return null;

      const fdPath = path.join(processPath, 'fd');
      const fileDescriptors = await fileSystem.readdir(fdPath);
      const sessions = [];
      for (const descriptor of fileDescriptors) {
        try {
          const descriptorPath = path.join(fdPath, descriptor);
          const target = await fileSystem.readlink(descriptorPath);
          if (!SESSION_PATH_PATTERN.test(target)) continue;
          // 삭제된 rollout도 프로세스가 연 FD를 통해 종료 시점까지 읽을 수 있습니다.
          sessions.push(target.endsWith(DELETED_FILE_SUFFIX) ? descriptorPath : target);
        } catch {
          // /proc 순회 중 프로세스 또는 FD가 사라지는 경합은 정상 동작입니다.
        }
      }
      return sessions;
    } catch {
      return null;
    }
  }));

  const liveProcesses = results.filter((result) => result !== null);
  return {
    processCount: liveProcesses.length,
    sessionPaths: [...new Set(liveProcesses.flat())]
  };
}

class CodexStatusMonitor {
  constructor(options = {}) {
    this.fileSystem = options.fileSystem || fs;
    this.procRoot = options.procRoot || '/proc';
    this.tracker = options.tracker || new SessionTracker(this.fileSystem);
  }

  async getStatus() {
    const { processCount, sessionPaths } = await findLiveCodexSessions(this.procRoot, this.fileSystem);
    this.tracker.forgetExcept(sessionPaths);
    const busyResults = await Promise.all(sessionPaths.map(async (filePath) => {
      try {
        return await this.tracker.isBusy(filePath);
      } catch {
        return false;
      }
    }));
    const activeTasks = busyResults.filter(Boolean).length;
    const sessionCount = sessionPaths.length;

    if (activeTasks > 0) return { state: 'working', activeTasks, processCount, sessionCount };
    if (processCount > 0) return { state: 'complete', activeTasks: 0, processCount, sessionCount };
    return { state: 'offline', activeTasks: 0, processCount: 0, sessionCount: 0 };
  }
}

module.exports = { CodexStatusMonitor, SessionTracker, findLiveCodexSessions };
