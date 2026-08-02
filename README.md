# 漫展自由行助手 · Mansaku Freewalk

**一键把漫展自由行申请发到小红书 / 抖音 / QQ空间** —— 同一套图文，三个平台顺序一致、全程零压缩，登录一次长期有效。

**Desktop helper for Chinese anime-convention "freewalk" (free-entry photographer/coser) applications** — compose one image+text package and publish it to Xiaohongshu, Douyin and QQ Zone in one click, with byte-identical images and a consistent order across all three.

[![Download for macOS](https://img.shields.io/badge/macOS-Download_DMG-1d1d1f?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/FIONN191/mansaku-freewalk/releases/latest/download/Freewalk-Helper-mac.dmg)
[![Download for Windows](https://img.shields.io/badge/Windows-Download_EXE-0078D6?style=for-the-badge&logoColor=white)](https://github.com/FIONN191/mansaku-freewalk/releases/latest/download/Freewalk-Helper-win-x64.exe)

两个安装包都**未签名**：macOS 首次运行右键 →「打开」（或 `xattr -cr /Applications/漫展自由行助手.app`）；
Windows 被 SmartScreen 拦时点「更多信息 →仍要运行」。

## 能做什么

- **三平台一键发布**：小红书 → 抖音 → QQ空间，内置浏览器登录一次，登录态长期保存（QQ空间会话 cookie 会转持久化存盘）。
- **图片零压缩**：走 CDP `DOM.setFileInputFiles` 直传原文件，保存申请包时逐张 md5 校验，本地不做任何转码/缩放。
- **顺序锁定**：官图在前、场照在后，三个平台上传顺序完全一致。
- **可视化编辑器**：小红书式的图片网格（➕ 添加 / ✕ 移除）、标题 20 字与正文 1000 字实时计数、话题按平台自动改写格式（`#话题[话题]#` / `#话题` / `#话题#`）。
- **模板生成文案**：填展会信息一键生成申请正文，生成后还能随便改。
- **发布可控**：可勾「发布前暂停」由人工点最后一下，随时暂停/继续/终止；失败自动截图存 `userData/logs/`。
- **小程序快捷入口**：常用漫展报名小程序一键复制跳转链接并拉起微信/QQ。

**不做刷量。** 互动量（赞/评论）请走 `#互赞` 话题和漫展群真人互助 —— 平台禁止刷量，主办也会查，被发现是申请作废 + CN 拉黑。

## 用法

1. 左栏切平台，在右侧内置浏览器登录一次（三个平台各登一次即可）。
2. 「② 个人资料」填 CN / 器材 / QQ 号 —— **只保存在本机** `userData/profile.json`，不进代码、不进仓库。
3. 「③ 申请包」点「＋ 新建」：加官图和场照、写标题正文话题（或展开模板生成后再改）→ 💾 保存。
4. 「④ 发布」勾平台 → 🚀 一键发布。

## 命令行流程（可选）

App 之外还有一套纯脚本流程，用来生成待发布的文案+图片目录：

```bash
cp templates/con.example.yaml out/2026-01_某展/con.yaml   # 填展会信息
python3 scripts/make_application.py out/2026-01_某展/con.yaml
```

生成结果：

```
out/<年月_漫展名>/
├── con.yaml       # 该展信息（场馆/日期/门槛/官图路径）
├── posts/         # 小红书标题+正文、抖音、QQ空间 三份文案
├── images/        # 官图，字节级复制 + md5 校验
├── submit/        # 提交用作品集
├── proof/         # 互动达标截图
└── CHECKLIST.md   # 该展待办清单
```

全局偏好（类别、常关注城市、作品集目录）放 `config.yaml` —— 从 `config.example.yaml` 复制一份填自己的，
该文件已在 `.gitignore` 里，不会被提交。

## 开发

```bash
cd app && npm install && npm start
```

打包：本地 `npm run dist`（产物在 `app/release/`）；发版走 GitHub Actions —— 新建一个 Release，
`.github/workflows/build-installers.yml` 会在 macOS 和 Windows runner 上各构建一次，
用不带版本号的资产名（`Freewalk-Helper-mac.dmg` / `Freewalk-Helper-win-x64.exe`）传回该 Release，
所以上面的下载按钮永远指向最新版。

**实时同步**：安装版是一层引导壳，启动时如果存在 `~/Claude/apps/mansaku-freewalk/app/` 就直接从该目录加载全部代码
（可用环境变量 `FREEWALK_DEV` 或 `userData/dev-path.txt` 覆盖路径），改完代码在 App 里点「♻️ 重启应用」即生效，无需重装；
目录不存在的机器自动回退包内置副本。主进程日志第一行会显示当前代码来源。

抖音 / QQ空间驱动仍是 beta，平台改版会导致选择器失效 —— 失败截图在 `userData/logs/`，照着截图修 `app/drivers/*.js` 里的选择器即可。

## 隐私

仓库里不含任何个人信息。CN、器材、QQ 号存在本机 `userData/profile.json`；登录 cookie 存在各平台的 Electron
partition 和 `userData/qzone-cookies.json`；申请包（图片副本）存在 `userData/packages/`。这些目录都不在版本控制内。

## License

MIT
