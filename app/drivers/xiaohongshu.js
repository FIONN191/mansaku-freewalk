// 小红书图文发布驱动。页面结构 2026-07 实测：
// 发布页 tabs（上传视频/上传图文/写长文）→ 图文 input accept=".jpg,.jpeg,.png,.webp"
// → 编辑器：标题 input（placeholder 含“标题”）、正文 contenteditable、计数 "N/18"。
const { wait, jsWait, setFileInput, typeChars, jsClick, focusEnd, focusAndInsert, readToasts } = require('./common');

const BODY_EDITOR = `document.querySelector('div[contenteditable="true"]')`;
// 发布按钮可能是 button/div/span，多个候选取可见的最后一个；排除「定时发布」
const PUBLISH_BTN = `[...document.querySelectorAll('button, [role="button"], span, div')]
  .filter(el => { const t = el.textContent.trim(); return (t === '发布' || t === '发布笔记') && el.offsetParent !== null; })
  .pop()`;

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official';

async function checkLogin(wc) {
  // 未登录会被重定向到 login 页
  return !wc.getURL().includes('login');
}

async function publish(wc, pkg, log, opts) {
  log('小红书：打开发布页…');
  await wc.loadURL(PUBLISH_URL);
  await wait(2500);
  if (!(await checkLogin(wc))) throw new Error('小红书未登录，请先在右侧窗口扫码登录后重试');

  log('小红书：切换到「上传图文」…');
  await jsWait(wc, `[...document.querySelectorAll('div,span')].some(el => el.textContent.trim() === '上传图文')`);
  await jsClick(wc, `[...document.querySelectorAll('div,span')].find(el => el.textContent.trim() === '上传图文' && el.children.length === 0)`, '上传图文 tab');
  await wait(1200);

  log(`小红书：上传 ${pkg.images.length} 张原图（CDP 直传，不压缩）…`);
  await setFileInput(wc, `(() => {
    const input = [...document.querySelectorAll('input[type=file]')].find(el => (el.accept || '').includes('.jpg'));
    if (!input) return false;
    input.setAttribute('data-fw-upload', '1');
    return true;
  })()`, pkg.images);

  log('小红书：等待图片处理完成…');
  await jsWait(wc, `(() => {
    const c = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && /^${pkg.images.length}\\/18$/.test(el.textContent.trim()));
    return !!c;
  })()`, { timeout: 60000, label: `计数 ${pkg.images.length}/18` });

  log('小红书：填写标题…');
  await jsWait(wc, `!!document.querySelector('input[placeholder*="标题"]')`);
  await wc.executeJavaScript(`(() => {
    const input = document.querySelector('input[placeholder*="标题"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(pkg.title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  log('小红书：输入正文…');
  await focusAndInsert(wc, BODY_EDITOR, pkg.body, '正文编辑器');

  for (const topic of pkg.topics) {
    log(`小红书：添加话题 #${topic}…`);
    await focusEnd(wc, BODY_EDITOR, '正文编辑器');
    wc.insertText('\n');
    await wait(200);
    await typeChars(wc, '#' + topic);
    // 等话题联想下拉加载，点第一项；没出下拉就保留纯文本继续
    try {
      await jsWait(wc, `(() => {
        const items = [...document.querySelectorAll('[class*="mention"] [class*="item"], [class*="topic"] li, [class*="dropdown"] [class*="item"]')]
          .filter(el => el.textContent.includes(${JSON.stringify(topic)}));
        return items.length > 0;
      })()`, { timeout: 6000, label: '话题下拉' });
      await jsClick(wc, `[...document.querySelectorAll('[class*="mention"] [class*="item"], [class*="topic"] li, [class*="dropdown"] [class*="item"]')].filter(el => el.textContent.includes(${JSON.stringify(topic)}))[0]`, '话题下拉第一项');
      await wait(500);
    } catch (e) {
      log(`  话题下拉未出现，#${topic} 以纯文本保留`);
      wc.insertText(' ');
    }
  }

  if (opts.confirmBeforeSubmit) {
    log('小红书：内容已就绪，按设置暂停在发布前 —— 请人工点击「发布」');
    return { status: 'ready_to_submit' };
  }

  log('小红书：点击发布…');
  await wc.executeJavaScript(`window.scrollTo(0, document.body.scrollHeight)`);
  await wait(400);
  await jsClick(wc, PUBLISH_BTN, '发布按钮');
  try {
    await jsWait(wc, `(() => {
      if (location.href.includes('success')) return true;
      return [...document.querySelectorAll('*')].some(el => el.children.length === 0 && el.textContent.includes('发布成功'));
    })()`, { timeout: 45000, label: '发布成功提示' });
  } catch (e) {
    const toast = await readToasts(wc);
    throw new Error(`${e.message}${toast ? '；页面提示: ' + toast : ''}`);
  }
  log('小红书：发布成功 ✅');
  return { status: 'published' };
}

module.exports = { publish, checkLogin, PUBLISH_URL };
