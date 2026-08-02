// 驱动公共工具：等待、注入、CDP 文件上传、模拟输入。
// 所有图片上传走 CDP DOM.setFileInputFiles —— 原始文件路径直达，零转码零压缩。

// 发布进程控制门闸：main 侧 setPublishControl 注入，wait/jsWait 每步都会检查。
// paused=true 时在此悬停；aborted=true 时抛错终止当前驱动。
let publishControl = { paused: false, aborted: false };
function setPublishControl(c) { publishControl = c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gate() {
  while (publishControl.paused && !publishControl.aborted) await sleep(300);
  if (publishControl.aborted) {
    const e = new Error('已被用户终止');
    e.aborted = true;
    throw e;
  }
}
const wait = async (ms) => { await gate(); await sleep(ms); await gate(); };

// 轮询执行 expr（页面 JS），直到返回真值或超时。返回该真值。
async function jsWait(wc, expr, { timeout = 20000, interval = 400, label = expr.slice(0, 60) } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const v = await wc.executeJavaScript(`(() => { try { return (${expr}); } catch (e) { return null; } })()`);
      if (v) return v;
    } catch (e) { lastErr = e; }
    await wait(interval);
  }
  throw new Error(`等待超时: ${label}${lastErr ? ' / ' + lastErr.message : ''}`);
}

// 在任意 frame 里找到符合 markExpr 的 file input，打标记后用 CDP 塞入本地文件。
// markExpr 在每个 frame 执行，需自行 setAttribute('data-fw-upload','1') 并返回 true。
async function setFileInput(wc, markExpr, filePaths) {
  let marked = false;
  for (const frame of wc.mainFrame.framesInSubtree) {
    try {
      if (await frame.executeJavaScript(`(() => { try { return (${markExpr}); } catch (e) { return false; } })()`)) {
        marked = true;
        break;
      }
    } catch (_) { /* 跨域 frame 可能拒绝，继续找 */ }
  }
  if (!marked) throw new Error('未找到图片上传输入框');

  const dbg = wc.debugger;
  const attached = dbg.isAttached();
  if (!attached) dbg.attach('1.3');
  try {
    await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const { searchId, resultCount } = await dbg.sendCommand('DOM.performSearch', {
      query: "input[data-fw-upload='1']",
      includeUserAgentShadowDOM: true,
    });
    if (!resultCount) throw new Error('CDP 未定位到已标记的上传输入框');
    const { nodeIds } = await dbg.sendCommand('DOM.getSearchResults', {
      searchId, fromIndex: 0, toIndex: 1,
    });
    await dbg.sendCommand('DOM.setFileInputFiles', { files: filePaths, nodeId: nodeIds[0] });
  } finally {
    if (!attached) dbg.detach();
  }
}

// 逐字符发送真实按键事件（触发话题下拉等依赖可信输入的交互）。
async function typeChars(wc, text, delayMs = 40) {
  for (const ch of text) {
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    await wait(delayMs);
  }
}

async function pressKey(wc, keyCode) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'char', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await wait(120);
}

// 聚焦元素并把光标放到内容末尾（不插入文本）。
async function focusEnd(wc, findExpr, label) {
  wc.focus(); // 视图必须先拿到焦点，否则 insertText/按键事件落空
  const ok = await wc.executeJavaScript(`(() => {
    const el = (${findExpr});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.focus();
    if (el.isContentEditable) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(el); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
    return true;
  })()`);
  if (!ok) throw new Error(`找不到输入元素: ${label || findExpr.slice(0, 60)}`);
  await wait(250);
}

// 聚焦 + 插入文本 + 校验；insertText 失败自动回退 execCommand。
async function focusAndInsert(wc, findExpr, text, label) {
  await focusEnd(wc, findExpr, label);
  wc.insertText(text);
  await wait(500);
  const probe = JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 8));
  const verifyExpr = `(() => { const el = (${findExpr}); return !!el && (el.value || el.textContent || '').replace(/\\s+/g, ' ').includes(${probe}); })()`;
  if (await wc.executeJavaScript(verifyExpr)) return;
  await wc.executeJavaScript(`(() => { const el = (${findExpr}); el.focus(); return document.execCommand('insertText', false, ${JSON.stringify(text)}); })()`);
  await wait(500);
  if (!(await wc.executeJavaScript(verifyExpr))) throw new Error(`文本插入失败（两种方式都没写进去）: ${label}`);
}

// 抓页面上的 toast/提示文本，用于失败诊断。
async function readToasts(wc) {
  try {
    return await wc.executeJavaScript(`[...document.querySelectorAll('[class*="toast" i], [class*="message" i], [class*="tip" i]')]
      .map(el => el.textContent.trim()).filter(t => t && t.length < 80).slice(0, 5).join(' | ')`);
  } catch (_) { return ''; }
}

// 页面 JS 点击第一个匹配元素（含按文本查找按钮）。
async function jsClick(wc, findExpr, label) {
  const ok = await wc.executeJavaScript(`(() => {
    const el = (${findExpr});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到可点击元素: ${label || findExpr.slice(0, 60)}`);
}

module.exports = { wait, jsWait, setFileInput, typeChars, pressKey, jsClick, focusEnd, focusAndInsert, readToasts, setPublishControl };
