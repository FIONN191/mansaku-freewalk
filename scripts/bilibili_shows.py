#!/usr/bin/env python3
"""从 B 站会员购拉指定城市的在售项目，筛出漫展类。

接口：https://show.bilibili.com/api/ticket/project/listV2
  area 是行政区划码（成都 510100），必填；pagesize 只接受 16，给别的值会被判「请求非法」。

用法:
  python3 bilibili_shows.py            # 打印三城漫展
  python3 bilibili_shows.py --all      # 不筛类别，打印全部项目
  python3 bilibili_shows.py --json     # 输出 JSON（给提醒脚本用）
"""
import argparse
import datetime
import gzip
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://show.bilibili.com/api/ticket/project/listV2"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
PAGESIZE = 16                     # 接口只认这个值

CITIES = {"510100": "成都", "511500": "宜宾", "510900": "遂宁"}

# 会员购没有「漫展」这个类目，二次元展会散落在展览/漫展相关标签里，按关键词兜
KEYWORDS = ("漫展", "动漫", "二次元", "comic", "cos", "萤火虫", "次元",
            "acg", "谷子", "国创", "同人", "只此青绿")


def parse(raw: bytes) -> dict:
    d = json.loads(raw)
    if d.get("errno") != 0:
        raise RuntimeError(f"接口返回异常: {d.get('message') or d}")
    return d["data"]


def _via_urllib(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": "https://show.bilibili.com/",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw


def _via_curl(url: str) -> bytes:
    if not shutil.which("curl"):
        raise RuntimeError("没有 curl")
    r = subprocess.run(["curl", "-sS", "--compressed", "--max-time", "30", "-A", UA,
                        "-H", "Referer: https://show.bilibili.com/", url],
                       capture_output=True, timeout=40)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"curl 退出码 {r.returncode}: {r.stderr[:120].decode('utf-8', 'replace')}")
    return r.stdout


def fetch(area: str, page: int, rounds: int = 3) -> dict:
    """两条通道轮着来：有的机器 Python 的 TLS 会随机 EOF，而 curl 正常；
    也有反过来的（沙箱拦子进程）。哪条先通用哪条。"""
    url = f"{API}?version=134&page={page}&pagesize={PAGESIZE}&platform=web&area={area}"
    errors = []
    for i in range(rounds):
        for name, get in (("urllib", _via_urllib), ("curl", _via_curl)):
            try:
                return parse(get(url))
            except Exception as e:
                errors.append(f"{name}: {e}")
        if i < rounds - 1:
            time.sleep(3 * (i + 1))
    raise RuntimeError("；".join(errors[-2:]))


def city_projects(area: str, max_pages: int = 5) -> list:
    """接口的 page 参数并不总是生效（实测第 2 页会原样重发第 1 页），
    所以按 project_id 去重，某一页没带来新条目就停，别死循环。"""
    out, seen = [], set()
    for page in range(1, max_pages + 1):
        data = fetch(area, page)
        fresh = 0
        for it in data.get("result") or []:
            pid = str(it.get("project_id"))
            if pid in seen:
                continue
            seen.add(pid)
            out.append(it)
            fresh += 1
        if not fresh or len(out) >= (data.get("total") or 0):
            break
        time.sleep(1.5)                # 别把接口打急了，快了会被判「请求非法」
    return out


def is_manzhan(p: dict) -> bool:
    hay = " ".join(str(p.get(k) or "") for k in
                   ("project_name", "third_category_name", "tlabel", "venue_name")).lower()
    return any(k.lower() in hay for k in KEYWORDS)


def ts(v) -> str:
    """接口的 sale_start_time 是秒级 unix 时间戳。"""
    try:
        return datetime.datetime.fromtimestamp(int(v)).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return ""


def price(p: dict) -> str:
    """price_low/high 是「分」，price_text 有时是 HTML 片段，优先用数值。"""
    lo, hi = p.get("price_low"), p.get("price_high")
    if isinstance(lo, int) and lo >= 0:
        a = f"{lo / 100:g}"
        b = f"{hi / 100:g}" if isinstance(hi, int) and hi != lo else ""
        return f"¥{a}" + (f"~{b}" if b else "")
    return str(p.get("price_text") or "")


def normalize(p: dict, city_label: str) -> dict:
    return {
        "id": str(p.get("project_id")),
        "name": p.get("project_name"),
        "city": p.get("city") or city_label,
        "venue": p.get("venue_name"),
        "start": p.get("start_time"),
        "end": p.get("end_time"),
        "sale_start": ts(p.get("sale_start_time")),
        "price": price(p),
        "url": f"https://show.bilibili.com/platform/detail.html?id={p.get('project_id')}",
    }


def collect(only_manzhan: bool = True) -> list:
    rows = []
    for area, label in CITIES.items():
        try:
            projects = city_projects(area)
        except Exception as e:                 # 单城失败不拖垮整体
            print(f"[警告] {label} 拉取失败: {e}", file=sys.stderr)
            continue
        for p in projects:
            if only_manzhan and not is_manzhan(p):
                continue
            rows.append(normalize(p, label))
        time.sleep(1.2)
    rows.sort(key=lambda r: r["start"] or "")
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="不按漫展关键词筛")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    a = ap.parse_args()
    rows = collect(only_manzhan=not a.all)
    if a.json:
        json.dump(rows, sys.stdout, ensure_ascii=False, indent=2)
        print()
        return
    if not rows:
        print("没有匹配的项目。")
        return
    for r in rows:
        print(f"[{r['id']}] {r['name']}")
        print(f"    {r['city']} · {r['venue']} · {r['start']}~{r['end']} · {r['price']}")
        print(f"    开售 {r['sale_start']} · {r['url']}")


if __name__ == "__main__":
    main()
