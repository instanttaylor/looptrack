#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', 'data');
const IDENTITY_FILE = path.join(os.homedir(), '.looptrack', 'identity.json');
const OLD_DATA_FILE = path.join(DATA_DIR, 'usage.json');

// Get or create machine identity
function getMachineId() {
  try {
    if (fs.existsSync(IDENTITY_FILE)) {
      const identity = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
      return identity.machineId;
    }
  } catch (err) {
    console.error('Warning: Could not load identity:', err.message);
  }
  return null;
}

function saveMachineId(machineId) {
  const dir = path.dirname(IDENTITY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify({ machineId }, null, 2));
}

function getDefaultMachineId() {
  // Use hostname, sanitized for filename
  return os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

async function promptForMachineId() {
  const defaultId = getDefaultMachineId();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`Enter machine identifier [${defaultId}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultId);
    });
  });
}

function getDataFile(machineId) {
  return path.join(DATA_DIR, `usage-${machineId}.json`);
}

// Decode project path from sessionId (e.g., "-Users-taylor-Dev-myapp" -> "/Users/taylor/Dev/myapp")
function decodeProjectPath(sessionId) {
  if (!sessionId || !sessionId.startsWith('-')) return null;
  return sessionId.replace(/^-/, '/').replace(/-/g, '/');
}

// Extract project name from path
function getProjectName(projectPath) {
  if (!projectPath) return 'Unknown';
  return projectPath.split('/').pop() || projectPath;
}

function loadExistingData(machineId) {
  const dataFile = machineId ? getDataFile(machineId) : null;
  try {
    if (dataFile && fs.existsSync(dataFile)) {
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    }
  } catch (err) {
    console.error('Warning: Could not load existing data:', err.message);
  }
  return { sessions: {}, syncs: [] };
}

// Load all machine data files (for server aggregation)
function loadAllData() {
  const allSessions = {};
  const machines = [];

  try {
    if (!fs.existsSync(DATA_DIR)) return { sessions: {}, machines: [] };

    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('usage-') && f.endsWith('.json'));

    for (const file of files) {
      const machineId = file.replace('usage-', '').replace('.json', '');
      machines.push(machineId);

      try {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
        for (const [id, session] of Object.entries(data.sessions || {})) {
          allSessions[id] = { ...session, machineId };
        }
      } catch (err) {
        console.error(`Warning: Could not load ${file}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Warning: Could not read data directory:', err.message);
  }

  return { sessions: allSessions, machines };
}

function saveData(data, machineId) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const dataFile = getDataFile(machineId);
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function runCcusage() {
  try {
    // Get session data from ccusage
    const output = execSync('npx ccusage@latest session --json 2>/dev/null', {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(output);
  } catch (err) {
    console.error('Error running ccusage:', err.message);
    console.log('Make sure you have Claude Code installed and have some usage data.');
    return null;
  }
}

// Migrate old usage.json to new format
function migrateOldData(machineId) {
  if (fs.existsSync(OLD_DATA_FILE)) {
    const newFile = getDataFile(machineId);
    if (!fs.existsSync(newFile)) {
      console.log(`Migrating old usage.json to usage-${machineId}.json...`);
      fs.renameSync(OLD_DATA_FILE, newFile);
    }
  }
}

async function sync(providedMachineId) {
  // Get or create machine identity
  let machineId = providedMachineId || getMachineId();

  if (!machineId) {
    // First run - prompt for machine ID
    console.log('First time setup: Please identify this machine.');
    machineId = await promptForMachineId();
    saveMachineId(machineId);
    console.log(`Machine ID set to: ${machineId}`);

    // Migrate old data if exists
    migrateOldData(machineId);
  }

  console.log(`Syncing usage data for ${machineId}...`);

  const existing = loadExistingData(machineId);
  const ccusageData = runCcusage();

  if (!ccusageData || !ccusageData.sessions) {
    console.log('No data to sync.');
    return { ...existing, machineId };
  }

  // Merge sessions by ID
  const sessions = { ...existing.sessions };
  let newCount = 0;
  let updatedCount = 0;

  for (const session of ccusageData.sessions) {
    const id = session.sessionId || session.id || `${session.projectPath}-${session.startTime}`;
    if (!sessions[id]) {
      newCount++;
    } else {
      updatedCount++;
    }
    // Decode project path from sessionId if missing
    const projectPath = (session.projectPath && session.projectPath !== 'Unknown Project')
      ? session.projectPath
      : decodeProjectPath(session.sessionId);

    sessions[id] = {
      ...session,
      projectPath,
      projectName: getProjectName(projectPath),
      syncedAt: new Date().toISOString()
    };
  }

  const data = {
    sessions,
    syncs: [
      ...existing.syncs,
      {
        timestamp: new Date().toISOString(),
        newSessions: newCount,
        updatedSessions: updatedCount,
        totalSessions: Object.keys(sessions).length
      }
    ],
    lastSync: new Date().toISOString()
  };

  saveData(data, machineId);

  console.log(`Synced: ${newCount} new, ${updatedCount} updated, ${Object.keys(sessions).length} total sessions`);
  return { ...data, machineId };
}

// Run if called directly
if (require.main === module) {
  sync().catch(console.error);
}

module.exports = { sync, loadExistingData, loadAllData, getMachineId, getProjectName };
