// QQ空间说说发布驱动 v0.2 —— 发布入口在「好友动态」页（infocenter）顶部的发布框，
// 不在个人主页。空间是老式多 iframe 结构，所有探测都跑遍全部 frame。
// 话题在 QQ 空间没有联想下拉，直接以 #话题# 文本随正文发出。
const { wait, setFileInput } = require('./common');

function publishUrl(qq) { return `https://user.qzone.qq.com/${qq}/infocenter`; }

async function checkLogin(wc) {
  const url = wc.getURL();
  if (!url.includes('user.qzone.qq.com') || url.includes('ptlogin')) return false;
  // URL 正常但页面内容可能是嵌入的扫码登录框
  const showsLogin = await wc.executeJavaScript(`(() => {
    if (document.querySelector('iframe[src*="ptlogin"]')) return true;
    return !!document.body && document.body.textContent.includes('快捷登录');
  })()`).catch(() => true);
  return !showsLogin;
}

// 在所有 frame 里执行表达式，返回第一个命中的 frame
async function findFrame(wc, expr) {
  for (const frame of wc.mainFrame.framesInSubtree) {
    try {
      if (await frame.executeJavaScript(`(() => { try { return (${expr}); } catch (e) { return false; } })()`)) return frame;
    } catch (_) { /* 跨域 frame 拒绝执行，跳过 */ }
  }
  return null;
}

// 定位发布框：可见编辑元素 + 8 层内有「发表」按钮的都是候选；
// 优先带「说说」占位符的，其次取页面最靠上的（好友动态顶部发布框）。
// 每次调用先清掉旧标记重新定位——图片面板展开会重渲染，旧节点可能已失效。
const MARK_BOX = `(() => {
  document.querySelectorAll('[data-fw-box], [data-fw-composer]').forEach(el => {
    el.removeAttribute('data-fw-box'); el.removeAttribute('data-fw-composer');
  });
  const cands = [];
  for (const el of document.querySelectorAll('.textinput, [contenteditable="true"], textarea')) {
    if (el.offsetParent === null) continue;
    let c = el.parentElement;
    for (let i = 0; i < 8 && c; i++, c = c.parentElement) {
      const pub = [...c.querySelectorAll('a, button, span, div')]
        .some(b => b.children.length === 0 && b.textContent.trim() === '发表');
      if (pub) {
        const hint = (el.getAttribute('data-placeholder') || '') + (c.textContent || '').slice(0, 200);
        cands.push({ el, c, top: el.getBoundingClientRect().top, saySay: /说说|新鲜事/.test(hint) ? 0 : 1 });
        break;
      }
    }
  }
  if (!cands.length) return false;
  cands.sort((a, b) => a.saySay - b.saySay || a.top - b.top);
  cands[0].el.setAttribute('data-fw-box', '1');
  cands[0].c.setAttribute('data-fw-composer', '1');
  return true;
})()`;

async function publish(wc, pkg, log, opts) {
  log('QQ空间：打开好友动态页…');
  await wc.loadURL(publishUrl(pkg.qq));
  await wait(5000);
  if (!(await checkLogin(wc))) throw new Error('QQ空间未登录，请先在右侧窗口登录后重试');

  log('QQ空间：定位顶部发布框…');
  let frame = await findFrame(wc, MARK_BOX);
  if (!frame) {
    // 发布框可能是折叠态，点一下占位区再找
    const placeholder = await findFrame(wc, `(() => {
      const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /新鲜事|说点什么/.test(e.textContent));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (placeholder) { await wait(1500); frame = await findFrame(wc, MARK_BOX); }
  }
  if (!frame) throw new Error('未找到好友动态页的发布框（页面结构可能更新，请把日志发给 Claude 调）');

  // 先点开发布框让容器进入编辑态（有些皮肤是折叠占位）
  await frame.executeJavaScript(`(() => {
    const box = document.querySelector('[data-fw-box]');
    box.scrollIntoView({ block: 'center' });
    box.click();
    box.focus();
    return true;
  })()`);
  await wait(800);

  // ⚠️ 顺序：先传图后写文案 —— 图片面板展开会重渲染发布框，先写的文字会丢
  log(`QQ空间：上传 ${pkg.images.length} 张原图（CDP 直传，不压缩）…`);
  // 图片按钮在发布框容器里找：title/class 含图片、照片、photo、pic 之一
  const camClicked = await frame.executeJavaScript(`(() => {
    const scope = document.querySelector('[data-fw-composer]') || document;
    const btn = [...scope.querySelectorAll('a, i, span, div, button')].find(el =>
      /图片|照片/.test(el.title || '') ||
      /photo|\\bpic\\b|image/i.test(el.className || '') ||
      (el.children.length === 0 && el.textContent.trim() === '图片'));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!camClicked) log('  ⚠️ 没找到图片按钮，尝试直接找上传输入框…');
  await wait(2000);
  await setFileInput(wc, `(() => {
    const input = [...document.querySelectorAll('input[type=file]')].find(el => !el.disabled);
    if (!input) return false;
    input.setAttribute('data-fw-upload', '1');
    return true;
  })()`, pkg.images);

  log('QQ空间：等待图片上传完成…');
  const deadline = Date.now() + Math.max(20000, pkg.images.length * 6000);
  let uploaded = 0;
  while (Date.now() < deadline) {
    uploaded = await frame.executeJavaScript(`(() => {
      const scope = document.querySelector('[data-fw-composer]') || document;
      return [...scope.querySelectorAll('img')].filter(i => i.offsetParent !== null && i.naturalWidth > 0 && i.width > 30).length;
    })()`).catch(() => 0);
    if (uploaded >= pkg.images.length) break;
    await wait(1500);
  }
  log(`  检测到 ${uploaded}/${pkg.images.length} 张缩略图${uploaded < pkg.images.length ? '（可能仍在上传，稍候再发）' : ''}`);
  if (uploaded < pkg.images.length) await wait(5000);

  // 图片面板展开后发布框可能已重渲染 —— 重新定位再写文案
  log('QQ空间：输入文案…');
  frame = (await findFrame(wc, MARK_BOX)) || frame;
  await frame.executeJavaScript(`(() => {
    const box = document.querySelector('[data-fw-box]');
    if (!box) return false;
    box.scrollIntoView({ block: 'center' });
    box.click();
    box.focus();
    if (box.isContentEditable) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(box); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
    return true;
  })()`);
  wc.focus(); // 视图必须持有焦点，insertText 才会落到发布框
  await wait(600);
  const textProbe = JSON.stringify(pkg.qzoneText.trim().slice(0, 6));
  const verifyExpr = `(() => {
    const box = document.querySelector('[data-fw-box]');
    return !!box && (box.value || box.textContent || '').includes(${textProbe});
  })()`;
  wc.insertText(pkg.qzoneText);
  await wait(800);
  if (!(await frame.executeJavaScript(verifyExpr).catch(() => false))) {
    log('  insertText 未生效，改用 execCommand 回退…');
    await frame.executeJavaScript(`(() => {
      const box = document.querySelector('[data-fw-box]');
      box.focus();
      return document.execCommand('insertText', false, ${JSON.stringify(pkg.qzoneText)});
    })()`);
    await wait(800);
  }
  // 硬校验：文案必须真的在发布框里，否则宁可失败也不发光图说说
  if (!(await frame.executeJavaScript(verifyExpr).catch(() => false))) {
    throw new Error('文案写入发布框失败，已终止（不会发出无文案的说说）——请把日志和失败截图发我');
  }
  log('  ✓ 文案已写入并校验通过');

  if (opts.confirmBeforeSubmit) {
    log('QQ空间：内容已就绪，按设置暂停在发布前 —— 请人工点击「发表」');
    return { status: 'ready_to_submit' };
  }

  log('QQ空间：点击发表…');
  if (!(await frame.executeJavaScript(verifyExpr).catch(() => false))) {
    throw new Error('点发表前复查：文案不在发布框里，已终止（不会发出无文案的说说）');
  }
  const clicked = await frame.executeJavaScript(`(() => {
    const scope = document.querySelector('[data-fw-composer]') || document;
    const btn = [...scope.querySelectorAll('a, button, span')].find(el => el.children.length === 0 && el.textContent.trim() === '发表');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) throw new Error('未找到「发表」按钮');
  await wait(4000);
  // 软校验：发布后发布框应清空
  const cleared = await frame.executeJavaScript(`(() => {
    const box = document.querySelector('[data-fw-box]');
    return !box || (box.value || box.textContent || '').trim().length < 5;
  })()`).catch(() => false);
  log(cleared ? 'QQ空间：发表成功（发布框已清空）✅' : 'QQ空间：已点发表，但发布框未清空 —— 请在时间线核对，异常的话把日志发我');
  return { status: 'published' };
}

module.exports = { publish, checkLogin, publishUrl };
