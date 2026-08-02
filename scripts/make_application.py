#!/usr/bin/env python3
"""生成漫展自由行申请包：三平台文案 + 官图字节级复制（不压缩、锁定顺序）。

用法:  python3 make_application.py <漫展目录>/event.yaml
输出:  <漫展目录>/posts/*.txt  <漫展目录>/images/NN_*.ext  <漫展目录>/CHECKLIST.md
"""
import hashlib
import shutil
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "templates" / "post_摄影.txt"


def parse_flat_yaml(path: Path) -> dict:
    """只解析 `key: value` 的扁平配置，够用且无第三方依赖。"""
    data = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        data[key.strip()] = value.strip()
    return data


def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_verbatim(src: Path, dst: Path) -> None:
    """字节级复制并校验，杜绝任何形式的转码/压缩。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    if md5(src) != md5(dst):
        sys.exit(f"[错误] 复制校验失败: {src} -> {dst}")
    print(f"  原图复制 OK (md5 一致): {dst.name}")


def main(con_file: str) -> None:
    con_path = Path(con_file).resolve()
    con = parse_flat_yaml(con_path)
    root = con_path.parent
    body = TEMPLATE.read_text(encoding="utf-8").format(
        漫展名称=con["漫展名称"], 批次=con.get("批次", ""), 城市=con["城市"],
        场馆=con["场馆"], 日期=con["日期"], cn=con["cn"],
        申请日期=con["申请日期"], 设备=con["设备"], 期待内容=con["期待内容"],
        点赞数=con["点赞数"], 评论数=con["评论数"], 话题=con["话题_小红书"],
    )

    posts = root / "posts"
    posts.mkdir(exist_ok=True)
    title = f'{con["漫展名称"]}自由行申请'[:20]  # 小红书标题上限 20 字
    (posts / "小红书_标题.txt").write_text(title, encoding="utf-8")
    (posts / "小红书_正文.txt").write_text(body, encoding="utf-8")
    (posts / "抖音.txt").write_text(
        body.replace(con["话题_小红书"], con["话题_抖音"]), encoding="utf-8")
    (posts / "QQ空间.txt").write_text(
        body.replace(con["话题_小红书"], con["话题_QQ空间"]), encoding="utf-8")
    print(f"文案已生成: {posts}")

    # 官图两种来源：官图目录（整个目录按文件名排序全带上）或 官图_<名称> 三张固定
    missing = []
    img_dir = con.get("官图目录", "")
    if img_dir and Path(img_dir).is_dir():
        files = sorted(p for p in Path(img_dir).iterdir()
                       if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        for i, p in enumerate(files, 1):
            copy_verbatim(p, root / "images" / f"{i:02d}_官图{p.suffix}")
    else:
        for i, name in enumerate(["漫展主图", "嘉宾合照图", "自由行海报"], 1):
            src_str = con.get(f"官图_{name}", "")
            if not src_str or not Path(src_str).exists():
                missing.append(name)
                continue
            src = Path(src_str)
            copy_verbatim(src, root / "images" / f"{i:02d}_{name}{src.suffix}")
        if missing:
            print(f"[待补] 缺少官图: {'、'.join(missing)}（补齐配置后重跑）")

    # 提交申请用的作品集
    portfolio = con.get("作品集目录", "")
    if portfolio and Path(portfolio).is_dir():
        files = sorted(p for p in Path(portfolio).iterdir()
                       if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        for i, p in enumerate(files, 1):
            copy_verbatim(p, root / "submit" / f"作品{i:02d}{p.suffix}")

    checklist = root / "CHECKLIST.md"
    checklist.write_text(f"""# {con["漫展名称"]} 自由行申请清单

- [ ] 三张官图齐全且顺序一致（images/01→02→03）{'  ⚠️ 待补: ' + '、'.join(missing) if missing else ''}
- [ ] 小红书发布（creator.xiaohongshu.com，上传 images/ 原文件，标题用 posts/小红书_标题.txt）
- [ ] 抖音图文发布（creator.douyin.com，同样顺序上传）
- [ ] QQ空间说说发布（同样顺序上传）
- [ ] 真人互动达标（{con["点赞数"]}赞 + {con["评论数"]}评論）→ 各平台截图存到 proof/
- [ ] 会员购/主办小程序提交：submit/ 作品集 + proof/ 截图
- [ ] 记录提交时间与批次结果
""", encoding="utf-8")
    print(f"清单已生成: {checklist}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
