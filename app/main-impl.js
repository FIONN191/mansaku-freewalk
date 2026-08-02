const { app, BrowserWindow, WebContentsView, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

// —— smoke test：CI/打包前快速验证主进程能起来 ——
if (process.argv.includes('--smoke-test')) {
  app.whenReady().then(() => { console.log('SMOKE_OK'); app.quit(); });
  return;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SIDEBAR = 400;

const drivers = {
  xhs: require('./drivers/xiaohongshu'),
  douyin: require('./drivers/douyin'),
  qzone: require('./drivers/qzone'),
};

const PLATFORMS = {
  xhs: { name: '小红书', home: 'https://creator.xiaohongshu.com/publish/publish?source=official' },
  douyin: { name: '抖音', home: 'https://creator.douyin.com/creator-micro/home' },
  qzone: { name: 'QQ空间', home: 'https://qzone.qq.com' },
};

let win = null;
const views = {};
let activeView = null;

const pkgRoot = () => path.join(app.getPath('userData'), 'packages');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

function log(msg) {
  if (win && !win.isDestroyed()) win.webContents.send('log', msg);
  console.log('[freewalk]', msg);
}

// —— QQ空间登录态持久化：腾讯登录发的是会话 cookie，应用退出即失效，须手动存盘/恢复 ——
const qzoneCookieFile = () => path.join(app.getPath('userData'), 'qzone-cookies.json');
let qzoneSaveTimer = null;

let lastQzoneSaveSig = '';
async function saveQzoneCookies() {
  try {
    const v = views.qzone;
    if (!v) return;
    const cookies = await v.webContents.session.cookies.get({});
    // 只有包含真正的登录凭证才落盘，防止登录页的无效 cookie 覆盖好存档
    const hasCred = cookies.some((c) => ['p_skey', 'skey', 'p_uin', 'uin'].includes(c.name) && c.value);
    if (!hasCred) return;
    const sig = cookies.map((c) => c.name + '=' + c.value.slice(0, 6)).sort().join('|');
    if (sig === lastQzoneSaveSig) return; // 内容没变不重复写/刷日志
    fs.writeFileSync(qzoneCookieFile(), JSON.stringify(cookies));
    lastQzoneSaveSig = sig;
    log(`QQ空间：✓ 登录态已保存到本地（${cookies.length} 条 cookie），重启应用后自动恢复`);
  } catch (_) { /* 保存失败不影响使用 */ }
}

async function restoreQzoneCookies(ses) {
  try {
    if (!fs.existsSync(qzoneCookieFile())) return;
    const cookies = JSON.parse(fs.readFileSync(qzoneCookieFile(), 'utf8'));
    for (const c of cookies) {
      try {
        await ses.cookies.set({
          url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
          // 会话 cookie 强制转持久（30 天），这是登录态能活过重启的关键
          expirationDate: c.expirationDate || Math.floor(Date.now() / 1000) + 30 * 86400,
        });
      } catch (_) { /* 单条失败跳过 */ }
    }
    const hasCred = cookies.some((c) => ['p_skey', 'skey', 'p_uin', 'uin'].includes(c.name) && c.value);
    log(hasCred
      ? `QQ空间：已恢复上次登录态（${cookies.length} 条 cookie）`
      : 'QQ空间：本地存档不含登录凭证，需要扫码登录一次（登录后会自动保存）');
  } catch (_) { /* 无存档或损坏则走正常登录 */ }
}

function getView(id) {
  if (views[id]) return views[id];
  const v = new WebContentsView({
    webPreferences: { partition: `persist:${id}`, contextIsolation: true, nodeIntegration: false },
  });
  v.webContents.setUserAgent(UA);
  views[id] = v;
  if (id === 'qzone') {
    restoreQzoneCookies(v.webContents.session).then(() => v.webContents.loadURL(PLATFORMS[id].home));
    v.webContents.on('did-navigate', () => saveQzoneCookies());
    v.webContents.on('did-navigate-in-page', () => saveQzoneCookies());
    v.webContents.on('did-frame-navigate', () => saveQzoneCookies());
    if (!qzoneSaveTimer) qzoneSaveTimer = setInterval(saveQzoneCookies, 5 * 60 * 1000);
  } else {
    v.webContents.loadURL(PLATFORMS[id].home);
  }
  return v;
}

function layoutView() {
  if (!activeView || !win) return;
  const [w, h] = win.getContentSize();
  activeView.setBounds({ x: SIDEBAR, y: 0, width: Math.max(w - SIDEBAR, 0), height: h });
}

function showPlatform(id) {
  const v = getView(id);
  if (activeView && activeView !== v) win.contentView.removeChildView(activeView);
  if (activeView !== v) win.contentView.addChildView(v);
  activeView = v;
  layoutView();
  return PLATFORMS[id].name;
}

// —— 申请包 ——
function listPackages() {
  fs.mkdirSync(pkgRoot(), { recursive: true });
  return fs.readdirSync(pkgRoot())
    .filter((d) => fs.existsSync(path.join(pkgRoot(), d, 'package.json')))
    .map((d) => ({ id: d, ...JSON.parse(fs.readFileSync(path.join(pkgRoot(), d, 'package.json'), 'utf8')) }));
}

function copyVerbatim(srcList, dir, base) {
  fs.mkdirSync(dir, { recursive: true });
  return srcList.map((src, i) => {
    const dst = path.join(dir, `${String(i + 1).padStart(2, '0')}${path.extname(src)}`);
    fs.copyFileSync(src, dst);
    if (md5(src) !== md5(dst)) throw new Error(`图片复制校验失败: ${src}`);
    return path.relative(base, dst);
  });
}

function savePackage(data, imagePaths, scenePaths) {
  const id = `${Date.now()}_${data.name.replace(/[^\w一-龥]/g, '')}`;
  const base = path.join(pkgRoot(), id);
  const images = copyVerbatim(imagePaths, path.join(base, 'images'), base);
  const scenePhotos = copyVerbatim(scenePaths, path.join(base, 'scene'), base);
  const meta = { ...data, images, scenePhotos, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify(meta, null, 2));
  return id;
}

// 话题净化：兼容空格/逗号分隔、带 # 前缀的输入（含老预设里的脏数据）
function normTopics(arr) {
  return (arr || [])
    .flatMap((t) => String(t).split(/[\s,，]+/))
    .map((s) => s.replace(/^#+/, '').trim())
    .filter(Boolean);
}

function buildTexts(p, profile) {
  // 自定义模式：标题正文照用户写的原样发，不套模板
  if (p.mode === 'custom') {
    const topics = normTopics(p.topics);
    const body = p.customBody || '';
    return {
      title: (p.customTitle || '').slice(0, 20),
      body,
      topics,
      qzoneText: topics.length ? `${body}\n${topics.map((t) => `#${t}#`).join(' ')}` : body,
    };
  }
  const topics = normTopics(p.topics);
  const body = `${p.name}${p.batch}自由行申请\n${p.city}·${p.venue}\n${p.dates} 我们不见不散！\n\nCN: ${profile.cn}\n申请自由行类别: 摄影\n申请日期: ${p.applyDates}\n摄影设备: ${profile.device}\n\n本次我最期待在${p.name}打卡的内容是: ${p.expect}\n\n需要${p.likes}👍+${p.comments}🍎 谢谢老大们！`;
  return {
    title: `${p.name}自由行申请`.slice(0, 20),
    body,
    topics,
    qzoneText: `${body}\n${topics.map((t) => `#${t}#`).join(' ')}`,
  };
}

// —— 个人资料：CN/设备/QQ 号只落盘到本机 userData，源码与仓库里不留任何真实信息 ——
const profileFile = () => path.join(app.getPath('userData'), 'profile.json');
const EMPTY_PROFILE = { cn: '', device: '', qq: '' };

function readProfile() {
  try {
    return { ...EMPTY_PROFILE, ...JSON.parse(fs.readFileSync(profileFile(), 'utf8')) };
  } catch (_) {
    return { ...EMPTY_PROFILE }; // 首次运行/文件损坏 → 空白，等用户填
  }
}

// —— IPC ——
ipcMain.handle('platform:show', (_e, id) => showPlatform(id));
ipcMain.handle('profile:get', () => readProfile());
ipcMain.handle('profile:set', (_e, profile) => {
  fs.writeFileSync(profileFile(), JSON.stringify({ ...EMPTY_PROFILE, ...profile }, null, 2));
});
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
ipcMain.handle('package:list', () => listPackages());

ipcMain.handle('package:pick-images', async (_e, kind) => {
  const r = await dialog.showOpenDialog(win, {
    title: kind === 'scene' ? '按发布顺序选择场照（排在官图之后）' : '按发布顺序选择官图（可多选）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('package:create', (_e, { data, imagePaths, scenePaths }) => {
  const id = savePackage(data, imagePaths, scenePaths || []);
  log(`申请包已保存: ${data.name}（${imagePaths.length} 张官图 + ${(scenePaths || []).length} 张场照，md5 校验通过）`);
  return id;
});

// 预览：返回元数据 + 三平台实际发布文案 + 图片绝对路径（渲染缩略图用）
ipcMain.handle('package:preview', (_e, { id, profile }) => {
  const dir = path.join(pkgRoot(), id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return {
    ...meta, id,
    texts: buildTexts(meta, profile),
    imageFiles: (meta.images || []).map((r) => path.join(dir, r)),
    sceneFiles: (meta.scenePhotos || []).map((r) => path.join(dir, r)),
  };
});

// 更新：文案字段直接覆盖；图片只有重新选了才整组替换，否则保留原图
ipcMain.handle('package:update', (_e, { id, data, imagePaths, scenePaths }) => {
  const base = path.join(pkgRoot(), id);
  const old = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  let images = old.images;
  let scenePhotos = old.scenePhotos || [];
  if (imagePaths && imagePaths.length) {
    fs.rmSync(path.join(base, 'images'), { recursive: true, force: true });
    images = copyVerbatim(imagePaths, path.join(base, 'images'), base);
  }
  if (scenePaths && scenePaths.length) {
    fs.rmSync(path.join(base, 'scene'), { recursive: true, force: true });
    scenePhotos = copyVerbatim(scenePaths, path.join(base, 'scene'), base);
  }
  const meta = { ...old, ...data, images, scenePhotos, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify(meta, null, 2));
  log(`申请包已更新: ${meta.name}（官图 ${images.length} 张 + 场照 ${scenePhotos.length} 张）`);
  return id;
});

// 可视化编辑器的保存：images/scenes 是按发布顺序的绝对路径（可混合包内旧图与新增图），
// 每次整组重建到临时目录再原子换入，全程字节级复制 + md5 校验。
function rebuildGroup(base, sub, absList) {
  const tmp = path.join(base, sub + '.tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  absList.forEach((src, i) => {
    const dst = path.join(tmp, `${String(i + 1).padStart(2, '0')}${path.extname(src)}`);
    fs.copyFileSync(src, dst);
    if (md5(src) !== md5(dst)) throw new Error(`图片复制校验失败: ${src}`);
  });
  fs.rmSync(path.join(base, sub), { recursive: true, force: true });
  fs.renameSync(tmp, path.join(base, sub));
  return absList.map((src, i) => path.join(sub, `${String(i + 1).padStart(2, '0')}${path.extname(src)}`));
}

ipcMain.handle('package:save', (_e, { id, data, images, scenes }) => {
  let old = {};
  if (!id) {
    id = `${Date.now()}_${(data.name || '申请包').replace(/[^\w一-龥]/g, '')}`;
    fs.mkdirSync(path.join(pkgRoot(), id), { recursive: true });
  } else {
    old = JSON.parse(fs.readFileSync(path.join(pkgRoot(), id, 'package.json'), 'utf8'));
  }
  const base = path.join(pkgRoot(), id);
  const meta = {
    ...old, ...data,
    images: rebuildGroup(base, 'images', images || []),
    scenePhotos: rebuildGroup(base, 'scene', scenes || []),
    createdAt: old.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify(meta, null, 2));
  log(`申请包已保存: ${meta.name}（官图 ${meta.images.length} + 场照 ${meta.scenePhotos.length}，md5 校验通过）`);
  return id;
});

ipcMain.handle('package:delete', (_e, id) => {
  fs.rmSync(path.join(pkgRoot(), id), { recursive: true, force: true });
  log('申请包已删除（仅删除包内副本，原始图片文件不受影响）');
});

// —— 发布进程控制：暂停/继续/终止 ——
const { setPublishControl } = require('./drivers/common');
let publishCtl = { paused: false, aborted: false };
ipcMain.handle('publish:pause', (_e, paused) => {
  publishCtl.paused = paused;
  log(paused ? '⏸ 已暂停（当前动作收尾后停住，点「继续」恢复）' : '▶ 已继续');
});
ipcMain.handle('publish:abort', () => {
  publishCtl.aborted = true;
  publishCtl.paused = false;
  log('⏹ 正在终止发布进程…');
});
ipcMain.handle('app:info', () => ({ source: global.FW_SOURCE || '内置', version: app.getVersion() }));

// 小程序快捷入口：有 #小程序:// 跳转链接的复制链接，没有的复制名称，然后拉起客户端。
// 链接贴进微信任意聊天发送即成可点击卡片（系统层无法直接 open，这是微信的限制）。
ipcMain.handle('miniapp:open', (_e, { host, name, token, all }) => {
  clipboard.writeText(token || name);
  const candidates = host === 'wechat' ? ['WeChat', '微信'] : ['QQ'];
  const tryOpen = (i) => {
    if (i >= candidates.length) {
      log(`❌ 未找到${host === 'wechat' ? '微信' : 'QQ'}客户端，请确认已安装`);
      return;
    }
    execFile('open', ['-a', candidates[i]], (err) => {
      if (err) return tryOpen(i + 1);
      if (all) {
        log(`已复制全部小程序链接并打开微信 —— 粘贴到「文件传输助手」，一行一条发送；以后点聊天记录里的卡片即一键直达`);
      } else if (token) {
        log(`已复制「${name}」跳转链接并打开微信 —— 粘贴到「文件传输助手」发送，点消息卡片直达小程序`);
      } else {
        log(`已复制「${name}」并打开${host === 'wechat' ? '微信' : 'QQ'} —— 在顶部搜索框 ⌘V 粘贴回车搜索小程序`);
      }
    });
  };
  tryOpen(0);
});

ipcMain.handle('publish:run', async (_e, { packageId, platforms, profile, confirmBeforeSubmit }) => {
  publishCtl = { paused: false, aborted: false };
  setPublishControl(publishCtl);
  const dir = path.join(pkgRoot(), packageId);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const texts = buildTexts(meta, profile);
  const payload = {
    ...texts,
    // 发布顺序：官图在前，场照在后，三平台一致
    images: [...meta.images, ...(meta.scenePhotos || [])].map((rel) => path.join(dir, rel)),
    qq: profile.qq,
  };
  const results = {};
  for (const id of platforms) {
    showPlatform(id);
    log(`\n===== ${PLATFORMS[id].name} 开始 =====`);
    try {
      const r = await drivers[id].publish(getView(id).webContents, payload, log, { confirmBeforeSubmit });
      results[id] = r.status;
    } catch (e) {
      if (e.aborted || publishCtl.aborted) {
        results[id] = 'aborted';
        log(`⏹ ${PLATFORMS[id].name} 已终止，跳过剩余平台`);
        break;
      }
      log(`❌ ${PLATFORMS[id].name} 失败: ${e.message}`);
      results[id] = 'failed: ' + e.message;
      try {
        const shot = await getView(id).webContents.capturePage();
        const p = path.join(app.getPath('userData'), 'logs', `${id}_${Date.now()}.png`);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, shot.toPNG());
        log(`  失败截图: ${p}`);
      } catch (_) { /* 截图失败不阻断 */ }
    }
  }
  log('\n全部平台处理完毕: ' + JSON.stringify(results));
  return results;
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: '漫展自由行助手',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layoutView);
  win.webContents.once('did-finish-load', () => {
    showPlatform('xhs');
    log(`代码来源: ${global.FW_SOURCE || '内置'}`);
  });

  // —— UI 自检模式：真实主进程+真实数据跑一遍编辑器，输出探针后自动退出 ——
  if (process.argv.includes('--ui-probe')) {
    const errs = [];
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errs.push(message); });
    setTimeout(async () => {
      try {
        const probe = await win.webContents.executeJavaScript(`({
          pkgOptions: document.querySelectorAll('#pkgSelect option').length,
          officialTiles: document.querySelectorAll('#officialGrid .tile').length,
          sceneTiles: document.querySelectorAll('#sceneGrid .tile').length,
          titleLen: document.querySelector('#ed_title').value.length,
          bodyLen: document.querySelector('#ed_body').value.length,
          imgCount: document.querySelector('#imgCount').textContent,
        })`);
        console.log('UI_PROBE:', JSON.stringify(probe));
      } catch (e) { console.log('UI_PROBE_FAIL:', e.message); }
      console.log(errs.length ? 'UI_ERRORS:\n' + errs.join('\n') : 'UI_NO_ERRORS');
      app.exit(0);
    }, 6000);
  }
});

app.on('before-quit', () => saveQzoneCookies());
app.on('window-all-closed', () => app.quit());
