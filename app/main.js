// 引导壳：优先从开发目录加载最新代码（Claude Code 改完即生效，无需重装），
// 开发目录不存在（如 Windows 机器）时回退到包内置副本。
// 覆盖顺序：环境变量 FREEWALK_DEV > userData/dev-path.txt > 默认开发目录。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const DEFAULT_DEV = path.join(os.homedir(), 'Claude', 'apps', 'mansaku-freewalk', 'app');

function resolveDevDir() {
  if (process.env.FREEWALK_DEV) return process.env.FREEWALK_DEV;
  try {
    const cfg = path.join(app.getPath('userData'), 'dev-path.txt');
    if (fs.existsSync(cfg)) return fs.readFileSync(cfg, 'utf8').trim();
  } catch (_) { /* userData 不可用时忽略 */ }
  return DEFAULT_DEV;
}

const devDir = resolveDevDir();
const devImpl = path.join(devDir, 'main-impl.js');

if (path.resolve(devDir) !== __dirname && fs.existsSync(devImpl)) {
  try {
    global.FW_SOURCE = `开发目录（实时同步）: ${devDir}`;
    require(devImpl);
  } catch (e) {
    console.error('[freewalk] 开发目录代码加载失败，回退内置版本:', e);
    global.FW_SOURCE = `内置（开发目录加载失败: ${e.message}）`;
    require('./main-impl.js');
  }
} else {
  global.FW_SOURCE = path.resolve(devDir) === __dirname ? '开发目录（npm start）' : '内置';
  require('./main-impl.js');
}
