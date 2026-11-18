#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把电脑端的 SQLite 数据（inventory.db）导出成手机 App 能读的 data.json。

为什么需要它：
    手机端（Vue + Capacitor）的数据仓库格式是 `data.json` + `attachments/<附件id>`；
    电脑端备份是 `inventory.db` + `backup-meta.json` + `attachments/<容器>/<uuid>.jpg`。
    电脑端一旦把备份推到同一个仓库，根目录就没有 data.json 了，
    手机上点「从云端拉取」会报「云端没有 data.json」。

用法（在数据仓库目录里执行）：
    python scripts/export-mobile-json.py --db inventory.db --out data.json
    python scripts/export-mobile-json.py --db inventory.db --out data.json --check-only

导出后连同 data.json 一起提交即可，手机端就能正常拉取（两种格式可以共存，互不覆盖）。
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from typing import Any

MOBILE_VERSION = 1
DEFAULT_AI = {"base_url": "http://192.168.3.100:31415/v1", "model": "auto", "api_key": ""}

# operation_history.action_type → 手机端 history.action_type
ACTION_MAP = {"ADD": "add", "UPDATE": "update", "DELETE": "delete", "UNDO": None}


def rows(con: sqlite3.Connection, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    con.row_factory = sqlite3.Row
    return list(con.execute(sql, args).fetchall())


def table_names(con: sqlite3.Connection) -> set[str]:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def load_json(raw: Any) -> Any:
    if raw is None or raw == "":
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def norm_action(action_type: str, entity_type: str) -> str | None:
    head = str(action_type or "").upper().split("_")[0]
    mapped = ACTION_MAP.get(head)
    if mapped is None:
        return None
    # 手机端的撤销只认 item / container / group / recipe / attachment 五类
    if entity_type not in {"item", "container", "group", "recipe", "attachment"}:
        return None
    return mapped


def build(db_path: str, attachments_dir: str) -> tuple[dict, list[str]]:
    con = sqlite3.connect(db_path)
    tables = table_names(con)
    warnings: list[str] = []

    members = [
        {"id": r["id"], "name": r["name"], "sort_order": r["sort_order"]}
        for r in rows(con, "SELECT id, name, sort_order FROM household_members ORDER BY sort_order, id")
    ]
    groups = (
        [
            {"id": r["id"], "owner_id": r["owner_id"], "name": r["name"], "sort_order": r["sort_order"]}
            for r in rows(con, "SELECT id, owner_id, name, sort_order FROM container_groups ORDER BY sort_order, id")
        ]
        if "container_groups" in tables
        else []
    )

    containers = []
    owner_of: dict[int, int] = {}
    for r in rows(con, "SELECT * FROM containers ORDER BY sort_order, id"):
        owner_of[r["id"]] = r["owner_id"]
        containers.append(
            {
                "id": r["id"],
                "name": r["name"],
                "notes": r["notes"] or "",
                "owner_id": r["owner_id"],
                "group_id": r["group_id"],
                "pos_x": r["pos_x"],
                "pos_y": r["pos_y"],
                "pos_z": r["pos_z"],
                "size_w": r["size_w"],
                "size_h": r["size_h"],
                "size_d": r["size_d"],
                "sort_order": r["sort_order"],
                "last_opened_at": None,
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )

    items = []
    for r in rows(con, "SELECT * FROM items ORDER BY id"):
        items.append(
            {
                "id": r["id"],
                "container_id": r["container_id"],
                "owner_id": owner_of.get(r["container_id"], 1),
                "name": r["name"],
                "quantity": r["quantity"],
                "quantity_text": r["quantity_text"] or "",
                "condition": r["condition"] or "正常",
                "notes": r["notes"] or "",
                "tags": r["tags"] or "",
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )

    recipes = [
        {
            "id": r["id"],
            "title": r["title"],
            "steps": r["steps"] or "",
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in rows(con, "SELECT * FROM recipes ORDER BY id")
    ]

    attachments = []
    missing_files = 0
    for r in rows(con, "SELECT * FROM attachments ORDER BY id"):
        stored = (
            r["stored_name"]
            if "stored_name" in r.keys() and r["stored_name"]
            else str(r["filename"] or "")
        )
        path = os.path.join(attachments_dir, *stored.split("/")) if stored else ""
        if path and not os.path.isfile(path):
            missing_files += 1
            warnings.append(f"附件文件缺失：attachments/{stored}（数据库里有记录，仓库里没有文件）")
        attachments.append(
            {
                "id": r["id"],
                "item_id": r["item_id"],
                "container_id": r["container_id"],
                "recipe_id": r["recipe_id"],
                "kind": r["kind"] or "image",
                "filename": r["filename"] or stored,
                "mime_type": r["mime_type"] or "application/octet-stream",
                "size_bytes": r["size_bytes"] or 0,
                "created_at": r["created_at"],
                "stored_name": stored or None,
            }
        )

    history = []
    if "operation_history" in tables:
        for r in rows(con, "SELECT * FROM operation_history ORDER BY id"):
            action = norm_action(r["action_type"], r["entity_type"])
            if not action:
                continue
            history.append(
                {
                    "id": r["id"],
                    "action_type": action,
                    "entity_type": r["entity_type"],
                    "entity_id": r["entity_id"],
                    "container_id": r["container_id"],
                    "item_id": r["item_id"],
                    "owner_id": r["owner_id"] or 1,
                    "source": r["source"] or "manual",
                    "description": r["description"] or "",
                    "created_at": r["created_at"],
                    "undone_at": r["undone_at"],
                    "before": load_json(r["before_json"]),
                }
            )

    all_ids = [row["id"] for row in containers + items + recipes + attachments + history]
    all_ids += [m["id"] for m in members] + [g["id"] for g in groups]
    payload = {
        "version": MOBILE_VERSION,
        "seq": max([1000] + [int(i) for i in all_ids if i is not None]),
        "members": members,
        "groups": groups,
        "containers": containers,
        "items": items,
        "recipes": recipes,
        "attachments": attachments,
        "history": history,
        "ai": dict(DEFAULT_AI),
        # 注意：pcs / health 只存在手机上，这里不输出，避免拉取时把手机本地的配置覆盖掉
    }
    con.close()
    if missing_files:
        warnings.insert(0, f"共 {missing_files} 个附件在仓库里找不到文件")
    return payload, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="把 inventory.db 导出为手机端 data.json")
    parser.add_argument("--db", default="inventory.db", help="SQLite 数据库路径（默认 ./inventory.db）")
    parser.add_argument("--out", default="data.json", help="输出文件（默认 ./data.json）")
    parser.add_argument("--attachments", default="attachments", help="附件目录（默认 ./attachments）")
    parser.add_argument("--check-only", action="store_true", help="只校验不写文件")
    args = parser.parse_args()

    if not os.path.isfile(args.db):
        print(f"✗ 找不到数据库：{args.db}", file=sys.stderr)
        return 2
    payload, warnings = build(args.db, args.attachments)

    for line in warnings:
        print(f"! {line}")
    summary = (
        f"{len(payload['containers'])} 箱 / {len(payload['items'])} 物品 / "
        f"{len(payload['attachments'])} 附件 / {len(payload['groups'])} 分组 / "
        f"{len(payload['recipes'])} 菜谱 / {len(payload['history'])} 条历史"
    )
    if args.check_only:
        print(f"✓ 校验完成：{summary}")
        return 0

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    size = os.path.getsize(args.out)
    print(f"✓ 已写出 {args.out}（{summary}，{size / 1024:.1f} KB）")
    print("  下一步：git add data.json && git commit && git push —— 手机端即可正常拉取")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
