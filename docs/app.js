'use strict';
/* 漫展自由行助手 · 手机版
   数据全部留在本机浏览器（IndexedDB），不上传任何服务器。
   图片以原始 File 存取，全程不解码不重编码，保持零压缩。 */

const $ = (s) => document.querySelector(s);
const MAX_IMAGES = 18;              // 小红书单帖上限
let CATS = {};                      // 与桌面版共用 categories.json
let pkgs = [];                      // 当前全部申请包（不含 blob 以外的加工）
let cur = null;                     // 当前编辑的包
let urls = [];                      // 缩略图的 object URL，重渲染时统一回收

// —— IndexedDB ——
const DB = 'freewalk', VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('packages')) d.createObjectStore('packages', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const idbGet = (s, k) => tx(s, 'readonly', (o) => o.get(k));
const idbAll = (s) => tx(s, 'readonly', (o) => o.getAll());
const idbPut = (s, v, k) => tx(s, 'readwrite', (o) => o.put(v, k));
const idbDel = (s, k) => tx(s, 'readwrite', (o) => o.delete(k));

const toast = (msg) => {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
};

// —— 个人资料 ——
const profile = () => ({
  cn: $('#cn').value.trim(), category: $('#category').value,
  device: $('#device').value.trim(), qq: $('#qq').value.trim(),
});
const catInfo = () => CATS[$('#category').value] || { field: '设备', placeholder: '', topic: '' };

function applyCategory() {
  const c = catInfo();
  $('#deviceLabel').textContent = c.field;
  $('#device').placeholder = c.placeholder;
}

async function initProfile() {
  CATS = await (await fetch('categories.json')).json();
  $('#category').innerHTML = Object.keys(CATS).map((k) => `<option>${k}</option>`).join('');
  const p = (await idbGet('kv', 'profile')) || {};
  $('#cn').value = p.cn || '';
  $('#category').value = CATS[p.category] ? p.category : Object.keys(CATS)[0];
  $('#device').value = p.device || '';
  $('#qq').value = p.qq || '';
  applyCategory();
}
['#cn', '#category', '#device', '#qq'].forEach((s) =>
  $(s).addEventListener('change', () => idbPut('kv', profile(), 'profile')));
$('#category').addEventListener('change', applyCategory);

// —— 图片 ——
function pickImages(group) {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = 'image/*';
  el.multiple = true;
  el.addEventListener('change', async () => {
    const files = [...el.files].map((f) => ({ name: f.name, type: f.type, blob: f }));
    cur[group].push(...files);
    renderGrids();
  });
  el.click();
}

function renderGrids() {
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  const tile = (item, label, group, i) => {
    const u = URL.createObjectURL(item.blob);
    urls.push(u);
    return `<div class="tile"><img src="${u}" alt="">
      <span class="ord">${label}</span>
      <span class="del" data-g="${group}" data-i="${i}">✕</span></div>`;
  };
  $('#officialGrid').innerHTML =
    cur.official.map((f, i) => tile(f, i + 1, 'official', i)).join('') +
    '<div class="tile add" data-add="official">＋</div>';
  $('#sceneGrid').innerHTML =
    cur.scene.map((f, i) => tile(f, '场' + (i + 1), 'scene', i)).join('') +
    '<div class="tile add" data-add="scene">＋</div>';

  const total = cur.official.length + cur.scene.length;
  $('#imgCount').textContent = `${total}/${MAX_IMAGES}`;
  $('#imgCount').style.color = total > MAX_IMAGES ? 'var(--accent)' : 'var(--dim)';
  updatePreview();
}
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) return pickImages(add.dataset.add);
  const del = e.target.closest('.del');
  if (del) { cur[del.dataset.g].splice(+del.dataset.i, 1); renderGrids(); }
});

// —— 文案：与桌面版 buildTexts 保持一致 ——
const normTopics = (v) => String(v || '').split(/[\s,，]+/).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean);

function texts() {
  const body = $('#body').value;
  const t = normTopics($('#topics').value);
  const join = (fmt) => (t.length ? body + '\n' + t.map(fmt).join(' ') : body);
  return {
    title: $('#title').value.slice(0, 20),
    xhs: join((x) => `#${x}[话题]#`),
    douyin: join((x) => `#${x}`),
    qzone: join((x) => `#${x}#`),
  };
}

function updatePreview() {
  $('#titleCnt').textContent = `${$('#title').value.length}/20`;
  $('#bodyCnt').textContent = `${$('#body').value.length}/1000`;
  const n = cur ? cur.official.length + cur.scene.length : 0;
  $('#preview').textContent = `【标题】${texts().title || '（空）'}\n\n${texts().xhs || '（正文为空）'}\n\n—— ${n} 张图，官图在前场照在后`;
}
['#title', '#body', '#topics'].forEach((s) => $(s).addEventListener('input', updatePreview));

$('#genTmpl').addEventListener('click', () => {
  const v = (s) => $(s).value.trim();
  if (!v('#f_name')) return toast('先填漫展名称');
  const p = profile();
  const c = catInfo();
  if (!p.cn || !p.device) return toast(`先填好 CN 和${c.field}`);
  $('#title').value = `${v('#f_name')}自由行申请`.slice(0, 20);
  $('#body').value =
`${v('#f_name')}${v('#f_batch')}自由行申请
${v('#f_city')}·${v('#f_venue')}
${v('#f_dates')} 我们不见不散！

CN: ${p.cn}
申请自由行类别: ${p.category}
申请日期: ${v('#f_apply')}
${c.field}: ${p.device}

本次我最期待在${v('#f_name')}打卡的内容是: ${v('#f_expect')}

需要${v('#f_likes')}👍+${v('#f_comments')}🍎 谢谢老大们！`;
  if (!$('#topics').value) {
    $('#topics').value = [v('#f_city') && v('#f_city') + '漫展', '互赞', '自由行', c.topic].filter(Boolean).join(' ');
  }
  if (!$('#pkgName').value) $('#pkgName').value = `${v('#f_name')}${v('#f_batch')}`;
  $('#tmplBox').open = false;
  updatePreview();
});

// —— 申请包 ——
const blank = () => ({ id: '', name: '', title: '', body: '', topics: '', official: [], scene: [] });

function loadIntoEditor(p) {
  cur = p;
  $('#pkgName').value = p.name || '';
  $('#title').value = p.title || '';
  $('#body').value = p.body || '';
  $('#topics').value = p.topics || '';
  renderGrids();
}

async function refreshPkgs(selectId) {
  pkgs = (await idbAll('packages')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('#pkgSelect').innerHTML = pkgs.length
    ? pkgs.map((p) => `<option value="${p.id}">${p.name || '未命名'}（${p.official.length}官图+${p.scene.length}场照）</option>`).join('')
    : '<option value="">（点 ＋ 新建）</option>';
  const id = selectId || $('#pkgSelect').value;
  if (id) { $('#pkgSelect').value = id; loadIntoEditor(pkgs.find((p) => p.id === id) || blank()); }
  else loadIntoEditor(blank());
}

$('#pkgSelect').addEventListener('change', () => {
  const p = pkgs.find((x) => x.id === $('#pkgSelect').value);
  if (p) loadIntoEditor(p);
});
$('#newPkg').addEventListener('click', () => { loadIntoEditor(blank()); toast('已清空，填完点保存'); });

$('#savePkg').addEventListener('click', async () => {
  if (!cur.official.length) return toast('至少加一张官图');
  if (cur.official.length + cur.scene.length > MAX_IMAGES) return toast(`最多 ${MAX_IMAGES} 张`);
  if (!$('#title').value && !$('#body').value) return toast('标题或正文至少填一个');
  const rec = {
    ...cur,
    id: cur.id || String(Date.now()),
    name: $('#pkgName').value || $('#title').value || '申请包',
    title: $('#title').value, body: $('#body').value, topics: $('#topics').value,
    createdAt: cur.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await idbPut('packages', rec);
  await refreshPkgs(rec.id);
  toast('已保存');
});

$('#delPkg').addEventListener('click', async () => {
  const id = $('#pkgSelect').value;
  if (!id) return;
  if (!confirm(`删除申请包「${pkgs.find((p) => p.id === id).name}」？`)) return;
  await idbDel('packages', id);
  await refreshPkgs();
  toast('已删除');
});

// —— 发布：分享 / 复制 / 存图 ——
const orderedFiles = () => [...cur.official, ...cur.scene]
  .map((f, i) => new File([f.blob], `${String(i + 1).padStart(2, '0')}_${f.name}`, { type: f.blob.type || 'image/jpeg' }));

// 系统分享只在手机浏览器里有；桌面浏览器直接把按钮标灰，避免点了没反应
if (!navigator.share) {
  $('#shareBtn').disabled = true;
  $('#shareBtn').textContent = '📤 此浏览器不支持系统分享（手机上可用）';
}
$('#shareBtn').addEventListener('click', async () => {
  const t = texts();
  const files = orderedFiles();
  if (!files.length && !t.xhs) return toast('还没有内容可分享');
  const data = { title: t.title, text: t.xhs };
  // 有的浏览器只肯分享文本，带上文件会直接抛错，所以先问一次
  if (files.length && navigator.canShare && navigator.canShare({ files })) data.files = files;
  try {
    await navigator.share(data);
  } catch (err) {
    if (err && err.name === 'AbortError') return;          // 用户自己取消，不当错误
    toast('分享失败：' + err.message);
  }
});

$('.platforms').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-pf]');
  if (!b) return;
  const t = texts();
  const text = b.dataset.pf === 'title' ? t.title : t[b.dataset.pf];
  if (!text) return toast('内容为空');
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch (_) {
    toast('复制失败，长按上方预览手动选');
  }
});

$('#saveImgs').addEventListener('click', () => {
  const files = orderedFiles();
  if (!files.length) return toast('没有图片');
  files.forEach((f, i) => setTimeout(() => {
    const u = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = u; a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
  }, i * 350));                                            // 逐张触发，浏览器才不会只存下第一张
  toast(`正在保存 ${files.length} 张`);
});

// —— PWA ——
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  installEvt = null;
  $('#installBtn').hidden = true;
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// —— 近期漫展：读 CI 每天更新的快照（浏览器直连会员购接口会被 CORS 挡） ——
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadShows() {
  const box = $('#shows');
  let data;
  try {
    data = await (await fetch('shows.json', { cache: 'no-cache' })).json();
  } catch (_) {
    box.innerHTML = '<p class="hint">漫展列表还没生成，或当前离线。</p>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data.shows || []).filter((s) => !s.end || s.end >= today);
  if (!rows.length) {
    box.innerHTML = '<p class="hint">这三个城市暂时没有在售的漫展。</p>';
    return;
  }
  // 已经开展的标「进行中」，一个月内开展的标「将近」，都用醒目描边
  const tagOf = (s) => {
    if (s.start && s.start <= today) return '进行中';
    const d = (new Date(s.start) - new Date()) / 86400000;
    return d <= 30 ? '将近' : '';
  };
  box.innerHTML = rows.map((s) => {
    const tag = tagOf(s);
    return `
    <div class="show${tag ? ' soon' : ''}">
      <a href="${esc(s.url)}" target="_blank" rel="noopener">${tag ? `<span class="tag">${tag}</span>` : ''}${esc(s.name)}</a>
      <div class="meta">${esc(s.city)} · ${esc(s.venue)}</div>
      <div class="meta">${esc(s.start)} ~ ${esc(s.end)} · ${esc(s.price)}</div>
    </div>`;
  }).join('') +
    `<p class="stamp">数据来自 B站会员购，每天自动更新 · 快照时间 ${esc(data.updated || '未知')}</p>`;
}

(async () => {
  await initProfile();
  await refreshPkgs();
  loadShows();
})();
