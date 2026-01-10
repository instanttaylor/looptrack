const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { sync, loadAllData, getMachineId, getCloudDir, saveCloudDir, DATA_DIR } = require('./src/sync');
const { syncWithCloud } = require('./src/cloudSync');

const app = express();
const PORT = process.env.PORT || 3456;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CLAUDE_SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

app.use(express.json());
app.use(express.static('public'));

// Load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading config:', err.message);
  }
  return { projectGroups: {} };
}

// Save config
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Get group for a project path
function getProjectGroup(projectPath, groups) {
  for (const [groupName, paths] of Object.entries(groups)) {
    if (paths.some(p => projectPath && projectPath.startsWith(p))) {
      return groupName;
    }
  }
  return null;
}

// API: Get usage data with config (aggregates all machines)
app.get('/api/data', (req, res) => {
  try {
    const data = loadAllData();
    const config = loadConfig();
    const currentMachine = getMachineId();
    res.json({ ...data, config, currentMachine });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get list of machines
app.get('/api/machines', (req, res) => {
  try {
    const { machines } = loadAllData();
    const currentMachine = getMachineId();
    res.json({ machines, currentMachine });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get config
app.get('/api/config', (req, res) => {
  try {
    res.json(loadConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save config
app.post('/api/config', (req, res) => {
  try {
    const config = req.body;
    saveConfig(config);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Trigger sync
app.post('/api/sync', async (req, res) => {
  try {
    await sync();
    // Return aggregated data from all machines
    const data = loadAllData();
    const config = loadConfig();
    const currentMachine = getMachineId();
    res.json({ ...data, config, currentMachine });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Daily breakdown
app.get('/api/daily', (req, res) => {
  try {
    const data = loadAllData();
    const config = loadConfig();
    const sessions = Object.values(data.sessions || {});

    // Group by date
    const daily = {};
    sessions.forEach(s => {
      const date = (s.lastActivity || s.startTime || s.date || '').split('T')[0];
      if (!date) return;

      if (!daily[date]) {
        daily[date] = {
          date,
          sessions: 0,
          totalCost: 0,
          inputTokens: 0,
          outputTokens: 0,
          projects: {},
          groups: {}
        };
      }

      daily[date].sessions++;
      daily[date].totalCost += s.totalCost || s.cost || 0;
      daily[date].inputTokens += s.inputTokens || 0;
      daily[date].outputTokens += s.outputTokens || 0;

      // Track by project
      const projectPath = s.projectPath || 'Unknown';
      const projectName = projectPath.split('/').pop() || projectPath;
      if (!daily[date].projects[projectPath]) {
        daily[date].projects[projectPath] = { name: projectName, path: projectPath, cost: 0, sessions: 0 };
      }
      daily[date].projects[projectPath].cost += s.totalCost || s.cost || 0;
      daily[date].projects[projectPath].sessions++;

      // Track by group
      const group = getProjectGroup(projectPath, config.projectGroups) || 'Ungrouped';
      if (!daily[date].groups[group]) {
        daily[date].groups[group] = { cost: 0, sessions: 0 };
      }
      daily[date].groups[group].cost += s.totalCost || s.cost || 0;
      daily[date].groups[group].sessions++;
    });

    // Sort by date descending
    const sorted = Object.values(daily).sort((a, b) => b.date.localeCompare(a.date));

    res.json({ daily: sorted, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get summary stats
app.get('/api/summary', (req, res) => {
  try {
    const data = loadAllData();
    const config = loadConfig();
    const sessions = Object.values(data.sessions || {});

    const summary = {
      totalSessions: sessions.length,
      totalCost: sessions.reduce((sum, s) => sum + (s.totalCost || s.cost || 0), 0),
      totalInputTokens: sessions.reduce((sum, s) => sum + (s.inputTokens || s.input_tokens || 0), 0),
      totalOutputTokens: sessions.reduce((sum, s) => sum + (s.outputTokens || s.output_tokens || 0), 0),
      projects: [...new Set(sessions.map(s => s.projectPath || s.project))].filter(Boolean),
      lastSync: data.lastSync
    };

    res.json({ ...summary, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get Claude settings
app.get('/api/claude-settings', (req, res) => {
  try {
    let settings = { cleanupPeriodDays: 30 }; // default
    if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf8'));
    }
    res.json({
      cleanupPeriodDays: settings.cleanupPeriodDays || 30,
      path: CLAUDE_SETTINGS_FILE
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update Claude settings
app.post('/api/claude-settings', (req, res) => {
  try {
    let settings = {};
    if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf8'));
    }

    if (req.body.cleanupPeriodDays !== undefined) {
      settings.cleanupPeriodDays = parseInt(req.body.cleanupPeriodDays, 10);
    }

    // Ensure directory exists
    const dir = path.dirname(CLAUDE_SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    res.json({ success: true, cleanupPeriodDays: settings.cleanupPeriodDays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get cloud sync folder
app.get('/api/cloud-dir', (req, res) => {
  try {
    const cloudDir = getCloudDir();
    res.json({
      cloudDir: cloudDir || null,
      isConfigured: !!cloudDir
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set cloud sync folder directly
app.post('/api/cloud-dir', (req, res) => {
  try {
    const { cloudDir } = req.body;
    if (!cloudDir) {
      return res.status(400).json({ error: 'cloudDir required' });
    }

    // Validate the path exists and is a directory
    if (!fs.existsSync(cloudDir)) {
      return res.status(400).json({ error: 'Directory does not exist' });
    }
    const stat = fs.statSync(cloudDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    saveCloudDir(cloudDir);

    // Immediately sync with the new cloud folder
    const machineId = getMachineId();
    if (machineId) {
      syncWithCloud(DATA_DIR, cloudDir, machineId);
    }

    res.json({ cloudDir, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Open native folder picker (macOS)
app.post('/api/cloud-dir/pick', (req, res) => {
  const script = `osascript -e 'POSIX path of (choose folder with prompt "Choose cloud sync folder for LoopTrack")'`;

  exec(script, (err, stdout, stderr) => {
    if (err) {
      // User cancelled or error
      return res.json({ cancelled: true });
    }

    const folder = stdout.trim();
    if (!folder) {
      return res.json({ cancelled: true });
    }

    try {
      saveCloudDir(folder);

      // Immediately sync with the new cloud folder
      const machineId = getMachineId();
      if (machineId) {
        syncWithCloud(DATA_DIR, folder, machineId);
      }

      res.json({ cloudDir: folder, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// API: Clear cloud sync folder
app.delete('/api/cloud-dir', (req, res) => {
  try {
    saveCloudDir(null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LoopTrack running at http://localhost:${PORT}`);
});
