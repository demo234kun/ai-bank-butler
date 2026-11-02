#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通过 GitHub REST API 上传当前仓库内容（github.com:443 不可达、api.github.com 可用时的绕行方案）。

    python tools/upload-to-github-api.py            # blobs → tree → 根提交 → 强制更新分支
    python tools/upload-to-github-api.py --dry-run  # 只列计划

要点：内容取自 git 索引（git cat-file），与本地提交逐字节一致，因此远端 tree 的 SHA 与本地相同；
分支引用用 refs/heads/main；提交不带父提交，最终历史只有一个根提交。
"""
from __future__ import annotations

import base64
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:  # noqa: BLE001
    SSL_CTX = ssl.create_default_context()

API = "https://api.github.com"
OWNER, REPO = "demo234kun", "ai-bank-butler"
REF = "refs/heads/main"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = "--dry-run" in sys.argv

TOKEN = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True).stdout.strip()
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "ai-bank-butler-uploader",
}


def log(*a):
    print(*a, flush=True)


def git(*args, binary=False, env=None):
    out = subprocess.run(args, cwd=ROOT, capture_output=True, env=env).stdout
    return out if binary else out.decode("utf-8", "replace").strip()


def api(method, path, payload=None, retries=4):
    data = json.dumps(payload).encode() if payload is not None else None
    last = ""
    for attempt in range(retries):
        req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as r:
                body = r.read().decode()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            last = f"{e.code} {body}"
            if e.code in (403, 429):
                time.sleep(15)
            elif e.code in (500, 502, 503, 504):
                time.sleep(2 + attempt * 3)
            else:
                raise RuntimeError(f"{method} {path}：{last}")
        except Exception as e:  # noqa: BLE001
            last = str(e)[:160]
            time.sleep(1 + attempt * 2)
    raise RuntimeError(f"{method} {path} 重试耗尽：{last}")


def tracked_files():
    out = git("git", "-c", "core.quotePath=false", "ls-files", "-s")
    items = []
    for line in out.splitlines():
        meta, path = line.split("\t", 1)
        mode, sha, _stage = meta.split()
        items.append({"path": path, "mode": mode, "sha": sha})
    return items


def main():
    if not TOKEN:
        log("拿不到 gh token")
        sys.exit(1)
    files = tracked_files()
    total = sum(os.path.getsize(os.path.join(ROOT, f["path"])) for f in files)
    log(f"索引内 {len(files)} 个文件，工作区 {total/1024/1024:.1f} MB")
    if DRY:
        for f in files[:5]:
            log("  ", f["mode"], f["sha"][:8], f["path"])
        return

    log("1/4 上传 blobs（内容取自 git 索引）")
    done = {"n": 0}
    bad = []

    def upload(f):
        blob = git("git", "cat-file", "blob", f["sha"], binary=True)
        res = api("POST", f"/repos/{OWNER}/{REPO}/git/blobs",
                  {"content": base64.b64encode(blob).decode(), "encoding": "base64"})
        if res["sha"] != f["sha"]:
            bad.append((f["path"], f"远端 {res['sha'][:8]} != 本地 {f['sha'][:8]}"))
        done["n"] += 1
        if done["n"] % 60 == 0:
            log(f"   {done['n']}/{len(files)}")

    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(upload, f): f for f in files}
        for fut in futs:
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                bad.append((futs[fut]["path"], str(e)[:140]))
    if bad:
        log(f"异常 {len(bad)} 个，未创建提交：")
        for p, e in bad[:6]:
            log("  ", p, e)
        sys.exit(1)

    log("2/4 创建 tree")
    tree = api("POST", f"/repos/{OWNER}/{REPO}/git/trees",
               {"tree": [{"path": f["path"], "mode": f["mode"], "type": "blob", "sha": f["sha"]} for f in files]})
    local_tree = git("git", "rev-parse", "HEAD^{tree}")
    same = tree["sha"] == local_tree
    log(f"   远端 tree {tree['sha'][:8]}｜本地 {local_tree[:8]}｜一致 {same}")
    if not same:
        log("   tree 不一致，停止创建提交")
        sys.exit(1)

    log("3/4 创建根提交")
    name = git("git", "config", "user.name") or OWNER
    mail = git("git", "config", "user.email") or f"{OWNER}@users.noreply.github.com"
    message = git("git", "log", "-1", "--pretty=%B")
    a_iso = git("git", "log", "-1", "--pretty=%aI")
    c_iso = git("git", "log", "-1", "--pretty=%cI")
    to_utc = lambda ts: datetime.fromisoformat(ts).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    commit = api("POST", f"/repos/{OWNER}/{REPO}/git/commits", {
        "message": message,
        "tree": tree["sha"],
        "parents": [],
        "author": {"name": name, "email": mail, "date": to_utc(a_iso)},
        "committer": {"name": name, "email": mail, "date": to_utc(c_iso)},
    })
    log(f"   远端 commit {commit['sha'][:8]}")

    log("4/4 更新分支引用")
    try:
        api("POST", f"/repos/{OWNER}/{REPO}/git/refs", {"ref": REF, "sha": commit["sha"]})
    except RuntimeError:
        api("PATCH", f"/repos/{OWNER}/{REPO}/git/{REF}", {"sha": commit["sha"], "force": True})

    env = dict(os.environ, GIT_AUTHOR_NAME=name, GIT_AUTHOR_EMAIL=mail,
               GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=mail,
               GIT_AUTHOR_DATE=a_iso, GIT_COMMITTER_DATE=c_iso)
    rebuilt = subprocess.run(["git", "commit-tree", tree["sha"], "-m", message],
                             cwd=ROOT, capture_output=True, env=env).stdout.decode().strip()
    if rebuilt == commit["sha"]:
        subprocess.run(["git", "update-ref", "refs/heads/main", rebuilt], cwd=ROOT, check=True)
        log(f"   本地与远端同一提交 {rebuilt[:8]}，网络恢复后可直接 push / pull")
    else:
        log(f"   本地重建 {rebuilt[:8]} 与远端 {commit['sha'][:8]} 不同（时间戳格式差异），")
        log("   网络恢复后用 `git push -f origin main` 覆盖即可")

    log(f"\n完成：https://github.com/{OWNER}/{REPO}/tree/main · {len(files)} 个文件")


if __name__ == "__main__":
    main()
