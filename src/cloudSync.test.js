import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import functions we'll implement
import { syncToCloud, syncFromCloud, syncWithCloud } from './cloudSync';

// Test helpers
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'looptrack-test-'));
}

function writeUsageFile(dir, machineId, data) {
  const file = path.join(dir, `usage-${machineId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function readUsageFile(dir, machineId) {
  const file = path.join(dir, `usage-${machineId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listUsageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.startsWith('usage-') && f.endsWith('.json'));
}

// Test fixtures
const machineA = 'machine-a';
const machineB = 'machine-b';

const sampleDataA = {
  sessions: {
    'session-1': { sessionId: 'session-1', projectPath: '/proj/a', inputTokens: 100, outputTokens: 50, totalCost: 0.01, syncedAt: '2025-01-01T10:00:00Z' },
    'session-2': { sessionId: 'session-2', projectPath: '/proj/b', inputTokens: 200, outputTokens: 100, totalCost: 0.02, syncedAt: '2025-01-01T11:00:00Z' }
  },
  lastSync: '2025-01-01T12:00:00Z'
};

const sampleDataB = {
  sessions: {
    'session-3': { sessionId: 'session-3', projectPath: '/proj/c', inputTokens: 300, outputTokens: 150, totalCost: 0.03, syncedAt: '2025-01-02T10:00:00Z' }
  },
  lastSync: '2025-01-02T12:00:00Z'
};

describe('syncToCloud', () => {
  let localDir, cloudDir;

  beforeEach(() => {
    localDir = createTempDir();
    cloudDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(cloudDir, { recursive: true, force: true });
  });

  it('copies local machine file to cloud folder', () => {
    writeUsageFile(localDir, machineA, sampleDataA);

    syncToCloud(localDir, cloudDir, machineA);

    const cloudData = readUsageFile(cloudDir, machineA);
    expect(cloudData).toEqual(sampleDataA);
  });

  it('creates cloud folder if it does not exist', () => {
    const newCloudDir = path.join(cloudDir, 'nested', 'cloud');
    fs.rmSync(cloudDir, { recursive: true });

    writeUsageFile(localDir, machineA, sampleDataA);

    syncToCloud(localDir, newCloudDir, machineA);

    expect(fs.existsSync(newCloudDir)).toBe(true);
    const cloudData = readUsageFile(newCloudDir, machineA);
    expect(cloudData).toEqual(sampleDataA);
  });

  it('overwrites older cloud file with newer local file', () => {
    const olderData = { sessions: { old: { sessionId: 'old' } }, lastSync: '2024-01-01T00:00:00Z' };
    writeUsageFile(cloudDir, machineA, olderData);
    writeUsageFile(localDir, machineA, sampleDataA);

    syncToCloud(localDir, cloudDir, machineA);

    const cloudData = readUsageFile(cloudDir, machineA);
    expect(cloudData).toEqual(sampleDataA);
  });

  it('handles missing local file gracefully', () => {
    // No local file exists
    expect(() => syncToCloud(localDir, cloudDir, machineA)).not.toThrow();
    expect(listUsageFiles(cloudDir)).toHaveLength(0);
  });
});

describe('syncFromCloud', () => {
  let localDir, cloudDir;

  beforeEach(() => {
    localDir = createTempDir();
    cloudDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(cloudDir, { recursive: true, force: true });
  });

  it('copies other machines files from cloud to local', () => {
    writeUsageFile(cloudDir, machineB, sampleDataB);

    syncFromCloud(localDir, cloudDir, machineA);

    const localData = readUsageFile(localDir, machineB);
    expect(localData).toEqual(sampleDataB);
  });

  it('does not overwrite local machine file from cloud', () => {
    // Local has our data
    writeUsageFile(localDir, machineA, sampleDataA);
    // Cloud has an older version of our data
    const olderData = { sessions: { old: { sessionId: 'old' } }, lastSync: '2024-01-01T00:00:00Z' };
    writeUsageFile(cloudDir, machineA, olderData);

    syncFromCloud(localDir, cloudDir, machineA);

    // Local should still have our original data, not the cloud version
    const localData = readUsageFile(localDir, machineA);
    expect(localData).toEqual(sampleDataA);
  });

  it('handles empty cloud folder', () => {
    expect(() => syncFromCloud(localDir, cloudDir, machineA)).not.toThrow();
    expect(listUsageFiles(localDir)).toHaveLength(0);
  });

  it('handles non-existent cloud folder', () => {
    fs.rmSync(cloudDir, { recursive: true });
    expect(() => syncFromCloud(localDir, cloudDir, machineA)).not.toThrow();
  });

  it('handles corrupt JSON files in cloud gracefully', () => {
    // Write valid file
    writeUsageFile(cloudDir, machineB, sampleDataB);
    // Write corrupt file
    fs.writeFileSync(path.join(cloudDir, 'usage-corrupt.json'), 'not valid json {{{');

    expect(() => syncFromCloud(localDir, cloudDir, machineA)).not.toThrow();
    // Valid file should still be copied
    const localData = readUsageFile(localDir, machineB);
    expect(localData).toEqual(sampleDataB);
  });

  it('skips files that are not usage-*.json', () => {
    writeUsageFile(cloudDir, machineB, sampleDataB);
    fs.writeFileSync(path.join(cloudDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(cloudDir, 'readme.txt'), 'hello');

    syncFromCloud(localDir, cloudDir, machineA);

    const files = fs.readdirSync(localDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`usage-${machineB}.json`);
  });
});

describe('syncWithCloud (full cycle)', () => {
  let localDir, cloudDir;

  beforeEach(() => {
    localDir = createTempDir();
    cloudDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(cloudDir, { recursive: true, force: true });
  });

  it('pushes local to cloud then pulls cloud to local', () => {
    // Local has machine A data
    writeUsageFile(localDir, machineA, sampleDataA);
    // Cloud has machine B data
    writeUsageFile(cloudDir, machineB, sampleDataB);

    syncWithCloud(localDir, cloudDir, machineA);

    // Cloud should have both
    expect(readUsageFile(cloudDir, machineA)).toEqual(sampleDataA);
    expect(readUsageFile(cloudDir, machineB)).toEqual(sampleDataB);

    // Local should have both
    expect(readUsageFile(localDir, machineA)).toEqual(sampleDataA);
    expect(readUsageFile(localDir, machineB)).toEqual(sampleDataB);
  });

  it('results in local having all sessions from all machines', () => {
    writeUsageFile(localDir, machineA, sampleDataA);
    writeUsageFile(cloudDir, machineB, sampleDataB);

    syncWithCloud(localDir, cloudDir, machineA);

    const localFiles = listUsageFiles(localDir);
    expect(localFiles).toContain(`usage-${machineA}.json`);
    expect(localFiles).toContain(`usage-${machineB}.json`);
  });

  it('results in cloud having current machine file', () => {
    writeUsageFile(localDir, machineA, sampleDataA);

    syncWithCloud(localDir, cloudDir, machineA);

    expect(readUsageFile(cloudDir, machineA)).toEqual(sampleDataA);
  });

  it('works when cloud folder is empty', () => {
    writeUsageFile(localDir, machineA, sampleDataA);

    expect(() => syncWithCloud(localDir, cloudDir, machineA)).not.toThrow();
    expect(readUsageFile(cloudDir, machineA)).toEqual(sampleDataA);
  });

  it('works when local folder is empty', () => {
    writeUsageFile(cloudDir, machineB, sampleDataB);

    expect(() => syncWithCloud(localDir, cloudDir, machineA)).not.toThrow();
    expect(readUsageFile(localDir, machineB)).toEqual(sampleDataB);
  });

  it('works when cloud folder does not exist', () => {
    const newCloudDir = path.join(cloudDir, 'new-cloud');
    writeUsageFile(localDir, machineA, sampleDataA);

    expect(() => syncWithCloud(localDir, newCloudDir, machineA)).not.toThrow();
    expect(readUsageFile(newCloudDir, machineA)).toEqual(sampleDataA);
  });
});
