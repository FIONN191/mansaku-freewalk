#!/usr/bin/env python3
"""盯 B 站会员购的成都/宜宾/遂宁漫展，发现新的就报出来。

对比上一次的快照（docs/shows.json），把新增项写到 --new-out 供 CI 开 Issue 用。
快照本身会被更新并提交，所以「新」的判定是「上次快照里没有这个 project_id」。

用法:
  python3 watch_shows.py                      # 只看有没有新的，不落盘
  python3 watch_shows.py --write              # 更新 docs/shows.json
  python3 watch_shows.py --write --new-out new.md
"""
import argparse
import datetime
import json
import pathlib
import sys

import bilibili_shows as bs

ROOT = pathlib.Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "docs" / "shows.json"


def load_snapshot() -> dict:
    try:
        return json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"updated": "", "shows": []}


def to_markdown(rows: list) -> str:
    out = []
    for r in rows:
        out.append(f"### {r['name']}\n")
        out.append(f"- 城市/场馆：{r['city']} · {r['venue']}")
        out.append(f"- 展期：{r['start']} ~ {r['end']}")
        out.append(f"- 票价：{r['price']}　开售：{r['sale_start'] or '未公布'}")
        out.append(f"- 详情：{r['url']}\n")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="更新 docs/shows.json")
    ap.add_argument("--new-out", help="把新增项写成 Markdown 到这个文件")
    ap.add_argument("--all", action="store_true", help="不按漫展关键词筛")
    a = ap.parse_args()

    rows = bs.collect(only_manzhan=not a.all)
    if not rows:
        print("这次一条都没抓到 —— 可能是接口抽风，不动快照。", file=sys.stderr)
        sys.exit(1)                     # 抓空就失败退出，避免把好快照清掉

    known = {s["id"] for s in load_snapshot().get("shows", [])}
    new = [r for r in rows if r["id"] not in known]

    print(f"共 {len(rows)} 场漫展，其中新增 {len(new)} 场")
    for r in new:
        print(f"  + {r['name']} | {r['city']} | {r['start']}")

    if a.new_out:
        pathlib.Path(a.new_out).write_text(to_markdown(new) if new else "", encoding="utf-8")

    if a.write:
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(json.dumps({
            "updated": datetime.datetime.now(datetime.timezone.utc)
                       .astimezone(datetime.timezone(datetime.timedelta(hours=8)))
                       .strftime("%Y-%m-%d %H:%M"),
            "cities": list(bs.CITIES.values()),
            "shows": rows,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"快照已更新: {SNAPSHOT}")


if __name__ == "__main__":
    main()
