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

module.exports = {
  async execute(context) {
    const platform = os.platform();
    const appRoot = path.resolve(__dirname, '..', '..');

    // Check Electron installation
    const nodeModulesPath = path.join(appRoot, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      context.log('Installing dependencies...');
      try {
        const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
        execSync(`${npmCmd} install`, {
          cwd: appRoot,
          stdio: 'pipe',
          timeout: 120000,
        });
        context.log('Dependencies installed!');
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

      const mode = context.params?.mode || 'pet';
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
  },
};
