const fs = require('fs');
const path = require('path');

/**
 * Push local machine's usage file to cloud folder
 * @param {string} localDataDir - Local data directory path
 * @param {string} cloudDir - Cloud/sync folder path
 * @param {string} machineId - Current machine identifier
 */
function syncToCloud(localDataDir, cloudDir, machineId) {
  const localFile = path.join(localDataDir, `usage-${machineId}.json`);
  const cloudFile = path.join(cloudDir, `usage-${machineId}.json`);

  // Create cloud folder if it doesn't exist
  if (!fs.existsSync(cloudDir)) {
    fs.mkdirSync(cloudDir, { recursive: true });
  }

  // Copy local file to cloud (if it exists)
  if (fs.existsSync(localFile)) {
    fs.copyFileSync(localFile, cloudFile);
  }
}

/**
 * Pull other machines' usage files from cloud to local
 * @param {string} localDataDir - Local data directory path
 * @param {string} cloudDir - Cloud/sync folder path
 * @param {string} machineId - Current machine identifier (skip this machine's file)
 */
function syncFromCloud(localDataDir, cloudDir, machineId) {
  // If cloud folder doesn't exist, nothing to pull
  if (!fs.existsSync(cloudDir)) return;

  // Create local folder if it doesn't exist
  if (!fs.existsSync(localDataDir)) {
    fs.mkdirSync(localDataDir, { recursive: true });
  }

  // Get all usage files from cloud
  const files = fs.readdirSync(cloudDir)
    .filter(f => f.startsWith('usage-') && f.endsWith('.json'));

  for (const file of files) {
    // Skip our own machine's file - we're the source of truth for that
    if (file === `usage-${machineId}.json`) continue;

    const cloudFile = path.join(cloudDir, file);
    const localFile = path.join(localDataDir, file);

    try {
      // Validate it's valid JSON before copying
      const content = fs.readFileSync(cloudFile, 'utf8');
      JSON.parse(content); // Will throw if invalid

      // Copy cloud file to local (other machine's data)
      fs.copyFileSync(cloudFile, localFile);
    } catch (err) {
      // Skip corrupt files silently
      console.error(`Failed to sync ${file}:`, err.message);
    }
  }
}

/**
 * Full two-way sync: push local to cloud, then pull cloud to local
 * @param {string} localDataDir - Local data directory path
 * @param {string} cloudDir - Cloud/sync folder path
 * @param {string} machineId - Current machine identifier
 */
function syncWithCloud(localDataDir, cloudDir, machineId) {
  // Push first (our data to cloud)
  syncToCloud(localDataDir, cloudDir, machineId);
  // Then pull (other machines' data from cloud)
  syncFromCloud(localDataDir, cloudDir, machineId);
}

module.exports = { syncToCloud, syncFromCloud, syncWithCloud };
