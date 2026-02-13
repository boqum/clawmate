#!/usr/bin/env node
/**
 * "Launch pet" handler logic
 *
 * 1. Detect OS
 * 2. Check if ClawMate is installed
 * 3. If not installed -> install
 * 4. Launch Electron app
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function launch(context) {
  const log = context?.log || console.log;
  const platform = os.platform();
  const appRoot = path.resolve(__dirname, '..', '..');

  // Check Electron installation
  const nodeModulesPath = path.join(appRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    log('Installing dependencies...');
    try {
      const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
      execSync(`${npmCmd} install`, {
        cwd: appRoot,
        stdio: 'inherit',
        timeout: 120000,
      });
      log('Dependencies installed!');
    } catch (err) {
      return {
        success: false,
        message: `Dependency installation failed: ${err.message}`,
      };
    }
  }

  // Launch Electron app
  try {
    const electronBin = platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(electronBin, ['electron', appRoot], {
      detached: true,
      stdio: 'ignore',
      cwd: appRoot,
      env: { ...process.env },
    });
    child.unref();

    const mode = context?.params?.mode || 'pet';
    const modeName = mode === 'pet' ? 'Clawby' : 'Claw';

    return {
      success: true,
      message: `ClawMate (${modeName}) has appeared on your desktop! \uD83E\uDD9E`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Launch failed: ${err.message}`,
    };
  }
}

// CLI entry point
if (require.main === module) {
  launch().then((result) => {
    console.log(result.message);
    if (!result.success) process.exit(1);
  });
}

module.exports = { execute: launch };
