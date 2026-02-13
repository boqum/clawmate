/**
 * "펫 깔아줘" 처리 로직
 *
 * 1. OS 감지
 * 2. ClawMate 설치 여부 확인
 * 3. 미설치 시 → 설치
 * 4. Electron 앱 실행
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

module.exports = {
  async execute(context) {
    const platform = os.platform();
    const appRoot = path.resolve(__dirname, '..', '..');

    // Electron 설치 확인
    const nodeModulesPath = path.join(appRoot, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      context.log('의존성 설치 중...');
      try {
        const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
        execSync(`${npmCmd} install`, {
          cwd: appRoot,
          stdio: 'pipe',
          timeout: 120000,
        });
        context.log('의존성 설치 완료!');
      } catch (err) {
        return {
          success: false,
          message: `의존성 설치 실패: ${err.message}`,
        };
      }
    }

    // Electron 앱 실행
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
      const modeName = mode === 'pet' ? 'Clawby' : 'OpenClaw';

      return {
        success: true,
        message: `ClawMate(${modeName})가 바탕화면에 나타났습니다! 🦞`,
      };
    } catch (err) {
      return {
        success: false,
        message: `실행 실패: ${err.message}`,
      };
    }
  },
};
