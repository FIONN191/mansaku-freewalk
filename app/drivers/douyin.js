// 抖音图文发布驱动（v0.1 beta —— 选择器基于创作者中心通用结构，首次使用如报错请反馈日志）。
// 入口：创作者中心上传页 default-tab=3 为图文。
const { wait, jsWait, setFileInput, typeChars, jsClick, focusEnd, focusAndInsert, readToasts } = require('./common');

const BODY_EDITOR = `document.querySelector('[contenteditable="true"]')`;

const PUBLISH_URL = 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3';

async function checkLogin(wc) {
  return !wc.getURL().includes('login') && !wc.getURL().includes('passport');
}

// 自动选 BGM：打开音乐面板，在推荐列表里挑「使用人数」最高的一首（流量近似值）。
// 选不上不阻断发布（音乐非必填），但会在日志里说明。
async function pickMusic(wc, log) {
  try {
    const entry = `[...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.includes('点击添加合适作品风格音乐'))`;
    if (!(await wc.executeJavaScript(`!!(${entry})`))) {
      log('抖音：页面无音乐入口，跳过 BGM');
      return;
    }
    log('抖音：选择 BGM（推荐列表里使用人数最高的）…');
    await jsClick(wc, entry, '音乐选择入口');
    await jsWait(wc, `document.body.textContent.includes('搜索音乐')`, { timeout: 10000, label: '音乐面板' });
    await wait(2000); // 等推荐列表渲染
    const picked = await wc.executeJavaScript(`(() => {
      const leafs = [...document.querySelectorAll('*')].filter(el => el.children.length === 0 && /人使用/.test(el.textContent) && el.textContent.trim().length < 16);
      let best = null;
      for (const leaf of leafs) {
        const m = leaf.textContent.match(/([\\d.]+)\\s*(万)?人使用/);
        if (!m) continue;
        const score = parseFloat(m[1]) * (m[2] ? 10000 : 1);
        let row = leaf;
        for (let i = 0; i < 6 && row.parentElement; i++) { row = row.parentElement; if (row.querySelector('img')) break; }
        if (!best || score > best.score) best = { score, row };
      }
      if (!best) return null;
      best.row.scrollIntoView({ block: 'center' });
      const title = best.row.textContent.trim().slice(0, 24);
      const useBtn = [...best.row.querySelectorAll('button, div, span')].find(el => el.textContent.trim() === '使用');
      if (useBtn) { useBtn.click(); return { title, via: '使用按钮' }; }
      best.row.click();
      return { title, via: '行点击' };
    })()`);
    if (!picked) { log('  ⚠️ 推荐列表没解析到候选歌曲，跳过 BGM'); return; }
    await wait(1200);
    if (picked.via === '行点击') {
      // 行点击只是试听，再找出现的「使用」按钮
      await jsClick(wc, `[...document.querySelectorAll('button, div, span')].find(el => el.textContent.trim() === '使用' && el.offsetParent !== null)`, '音乐使用按钮').catch(() => null);
      await wait(1000);
    }
    // 关掉音乐面板（若仍开着）
    await wc.executeJavaScript(`(() => {
      const panel = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.trim() === '选择音乐');
      if (!panel) return;
      const box = panel.closest('div[class]');
      const x = box && [...box.parentElement.querySelectorAll('svg, [class*="close"]')].pop();
      if (x) x.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()`).catch(() => null);
    log(`  ✓ BGM 已选: ${picked.title}`);
  } catch (e) {
    log(`  ⚠️ BGM 选择失败（不阻断发布）: ${e.message}`);
  }
}

// 抖音图文封面为必填项（不选直接发布会报「没有选择封面」）：进封面弹窗选第一张图并确认。
async function pickCover(wc, log) {
  try {
    const entry = `[...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.includes('选择一张图片作为封面'))`;
    if (!(await wc.executeJavaScript(`!!(${entry})`))) {
      log('抖音：未见封面提示（可能已有默认封面），跳过');
      return;
    }
    log('抖音：设置封面（取第 1 张图）…');
    await jsClick(wc, entry, '封面选择入口');
    await jsWait(wc, `[...document.querySelectorAll('[class*="modal" i], [role="dialog"]')].some(m => m.querySelectorAll('img').length > 0)`,
      { timeout: 12000, label: '封面弹窗' });
    await wait(1000);
    await jsClick(wc, `(() => {
      const m = [...document.querySelectorAll('[class*="modal" i], [role="dialog"]')].find(m => m.querySelectorAll('img').length > 0);
      return m ? m.querySelector('img') : null;
    })()`, '封面候选第一张');
    await wait(800);
    await jsClick(wc, `(() => {
      const m = [...document.querySelectorAll('[class*="modal" i], [role="dialog"]')].pop();
      if (!m) return null;
      return [...m.querySelectorAll('button')].find(b => /^(完成|确定|确认|保存)$/.test(b.textContent.trim()) && !b.disabled);
    })()`, '封面确认按钮');
    await wait(1500);
    log('  ✓ 封面已设置');
  } catch (e) {
    log(`  ⚠️ 封面自动设置失败: ${e.message}（发布可能因此被拦，请把日志发我）`);
  }
}

async function publish(wc, pkg, log, opts) {
  log('抖音：打开图文上传页…');
  await wc.loadURL(PUBLISH_URL);
  await wait(3000);
  if (!(await checkLogin(wc))) throw new Error('抖音未登录，请先在右侧窗口登录后重试');

  log(`抖音：上传 ${pkg.images.length} 张原图（CDP 直传，不压缩）…`);
  await jsWait(wc, `!!document.querySelector('input[type=file]')`, { timeout: 20000, label: '上传输入框' });
  await setFileInput(wc, `(() => {
    const input = [...document.querySelectorAll('input[type=file]')].find(el => {
      const a = (el.accept || '').toLowerCase();
      return a.includes('image') || a.includes('.jpg') || a.includes('.png');
    }) || document.querySelector('input[type=file]');
    if (!input) return false;
    input.setAttribute('data-fw-upload', '1');
    return true;
  })()`, pkg.images);

  log('抖音：等待进入编辑页…');
  await jsWait(wc, `!!(document.querySelector('input[placeholder*="标题"]') || document.querySelector('[contenteditable="true"]'))`,
    { timeout: 60000, label: '编辑页' });
  await wait(1500);

  log('抖音：填写标题…');
  const hasTitle = await wc.executeJavaScript(`(() => {
    const input = document.querySelector('input[placeholder*="标题"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(pkg.title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!hasTitle) log('  未找到标题输入框（部分版本图文无独立标题），跳过');

  log('抖音：输入正文…');
  await focusAndInsert(wc, BODY_EDITOR, pkg.body, '正文编辑器');

  // 抖音话题上限 5 个，且必须点下拉真正选中才算标签
  const topics = pkg.topics.slice(0, 5);
  if (pkg.topics.length > 5) log(`  抖音话题上限 5 个，只取前 5 个（丢弃: ${pkg.topics.slice(5).join('、')}）`);
  let added = 0;
  for (const topic of topics) {
    log(`抖音：添加话题 #${topic}…`);
    await focusEnd(wc, BODY_EDITOR, '正文编辑器');
    wc.insertText('\n');
    await wait(200);
    await typeChars(wc, '#' + topic);
    try {
      await jsWait(wc, `[...document.querySelectorAll('[class*="mention"] [class*="item"], [class*="hash"] [class*="item"], [class*="suggest"] [class*="item"]')].length > 0`,
        { timeout: 6000, label: '话题下拉' });
      await jsClick(wc, `[...document.querySelectorAll('[class*="mention"] [class*="item"], [class*="hash"] [class*="item"], [class*="suggest"] [class*="item"]')][0]`, '话题下拉第一项');
      await wait(600);
      // 校验：选中后编辑器里应出现该话题文本（成为高亮标签）
      const ok = await wc.executeJavaScript(`(() => {
        const ed = (${BODY_EDITOR});
        return !!ed && ed.textContent.includes('#' + ${JSON.stringify(topic)});
      })()`);
      if (ok) { added += 1; log(`  ✓ 已选中标签 #${topic}`); }
      else log(`  ⚠️ #${topic} 点了下拉但未检测到标签文本，请发布后核对`);
    } catch (e) {
      log(`  话题下拉未出现，#${topic} 以纯文本保留`);
      wc.insertText(' ');
    }
  }
  log(`抖音：标签完成，成功选中 ${added}/${topics.length} 个`);

  await pickMusic(wc, log);
  await pickCover(wc, log);

  if (opts.confirmBeforeSubmit) {
    log('抖音：内容已就绪，按设置暂停在发布前 —— 请人工点击「发布」');
    return { status: 'ready_to_submit' };
  }

  log('抖音：点击发布…');
  await wc.executeJavaScript(`window.scrollTo(0, document.body.scrollHeight)`);
  await wait(400);
  await jsClick(wc, `[...document.querySelectorAll('button, [role="button"]')].filter(b => b.textContent.trim() === '发布' && b.offsetParent !== null).pop()`, '发布按钮');
  await wait(3000);
  const toast = await readToasts(wc);
  if (toast) log(`  页面提示: ${toast}`);
  try {
    await jsWait(wc, `location.href.includes('content/manage') || location.href.includes('success') || [...document.querySelectorAll('*')].some(el => el.children.length === 0 && /发布成功|已发布|审核中/.test(el.textContent))`,
      { timeout: 45000, label: '发布成功' });
  } catch (e) {
    const t2 = await readToasts(wc);
    throw new Error(`${e.message}${t2 ? '；页面提示: ' + t2 : ''}（若提示声明/封面等必填项，告诉我加自动处理）`);
  }
  log('抖音：发布成功 ✅');
  return { status: 'published' };
}

module.exports = { publish, checkLogin, PUBLISH_URL };
