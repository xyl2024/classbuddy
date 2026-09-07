#!/usr/bin/env python3
"""classbuddy HTTP 接口客户端：对运行中的 classbuddy 服务做试卷增删查改。

Usage:
  python3 classbuddy_api.py <command> [args...] [--url URL]

服务地址优先级: --url > 环境变量 CLASSBUDDY_URL > http://localhost:3000

命令:
  health                                          检查服务是否可达
  list-exams                                      列出全部考试集
  get-exam <examId> [--full]                      查看考试集（--full 含全部试题组内容）
  create-exam <examId> [--name N] [--description D] [--force]
                                                  创建考试集；--force 先删除同名
  update-exam <examId> [--name N] [--description D]
                                                  更新考试集元数据
  delete-exam <examId> [--yes]                    删除考试集（--yes 跳过确认）
  get-item <examId> <itemId> [--out DIR]          查看试题组；--out 把 meta/material/questions 写入本地目录
  put-item <examId> <itemId> --dir DIR [--reset-annotations]
                                                  用本地试题组目录整体替换服务端试题组
  patch-item <examId> <itemId> [--meta F] [--material F] [--questions F]
                                                  局部更新试题组的部分文件
  delete-item <examId> <itemId> [--yes]           删除试题组
  push-exam <examDir> [--id ID] [--force]         校验本地考试集目录后整体上传（含全部 item-*）

退出码: 0 成功，1 失败（错误信息输出到 stderr）。
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_URL = "http://localhost:3000"
EMPTY_ANNOTATIONS = {"version": 1, "annotations": []}


def base_url(args) -> str:
    return (getattr(args, "url", None) or os.environ.get("CLASSBUDDY_URL") or DEFAULT_URL).rstrip("/")


def request(args, method: str, path: str, payload=None, raw: bytes | None = None):
    """发请求，返回 (status, parsed_json)。非 2xx 时抛 SystemExit(1)。"""
    url = base_url(args) + path
    data = raw if raw is not None else (json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None and raw is None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read().decode("utf-8")).get("error", str(e))
        except Exception:
            message = str(e)
        fail(f"HTTP {e.code} {method} {path}: {message}")
    except urllib.error.URLError as e:
        fail(f"无法连接 classbuddy 服务（{base_url(args)}）：{e.reason}\n提示：先用 npm run dev 启动服务，或用 --url / CLASSBUDDY_URL 指定地址。")
    try:
        return status, json.loads(body.decode("utf-8"))
    except Exception:
        return status, {}


def fail(message: str):
    print(message, file=sys.stderr)
    sys.exit(1)


def read_json_file(path: Path, what: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"缺少 {what} 文件: {path}")
    except json.JSONDecodeError as e:
        fail(f"{what} 不是合法 JSON（{path}）: {e}")


def confirm(message: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    return input(f"{message} [y/N] ").strip().lower() in ("y", "yes")


# ---- 命令实现 ----

def cmd_health(args):
    status, exams = request(args, "GET", "/api/examinations")
    print(f"OK {base_url(args)}，共 {len(exams)} 个考试集")
    return 0


def cmd_list_exams(args):
    _, exams = request(args, "GET", "/api/examinations")
    print(json.dumps(exams, ensure_ascii=False, indent=2))
    for exam in exams:
        items = exam.get("items", [])
        valid = sum(1 for i in items if i.get("valid"))
        print(f"- {exam['id']}  「{exam.get('name', '')}」  试题组 {valid}/{len(items)} 有效")
    return 0


def cmd_get_exam(args):
    _, data = request(args, "GET", f"/api/examinations/{args.exam}/full" if args.full else "/api/examinations")
    if not args.full:
        data = next((e for e in data if e.get("id") == args.exam), None)
        if data is None:
            fail(f"考试集“{args.exam}”不存在")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def cmd_create_exam(args):
    if args.force and exam_exists(args, args.exam):
        request(args, "DELETE", f"/api/examinations/{args.exam}")
        print(f"已删除同名考试集“{args.exam}”")
    payload = {"id": args.exam}
    if args.name:
        payload["name"] = args.name
    if args.description:
        payload["description"] = args.description
    request(args, "POST", "/api/examinations", payload)
    print(f"已创建考试集“{args.exam}”")
    return 0


def exam_exists(args, exam: str) -> bool:
    _, exams = request(args, "GET", "/api/examinations")
    return any(e.get("id") == exam for e in exams)


def cmd_update_exam(args):
    payload = {}
    if args.name is not None:
        payload["name"] = args.name
    if args.description is not None:
        payload["description"] = args.description
    if not payload:
        fail("未提供要更新的字段：--name / --description")
    request(args, "PATCH", f"/api/examinations/{args.exam}", payload)
    print(f"已更新考试集“{args.exam}”元数据")
    return 0


def cmd_delete_exam(args):
    if not confirm(f"确认删除考试集“{args.exam}”（连同全部试题组，不可恢复）？", args.yes):
        print("已取消")
        return 0
    request(args, "DELETE", f"/api/examinations/{args.exam}")
    print(f"已删除考试集“{args.exam}”")
    return 0


def cmd_get_item(args):
    _, data = request(args, "GET", f"/api/items/{args.exam}/{args.item}")
    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "meta.json").write_text(json.dumps(data.get("meta", {}), ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "material.md").write_text(data.get("material", ""), encoding="utf-8")
        (out / "questions.json").write_text(json.dumps(data.get("questions", []), ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入 {out}/（meta.json、material.md、questions.json）")
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def item_payload_from_dir(item_dir: Path) -> dict:
    """从本地试题组目录读取三个文件，组装 PUT 请求体。"""
    return {
        "meta": read_json_file(item_dir / "meta.json", "试题组元数据"),
        "material": (item_dir / "material.md").read_text(encoding="utf-8"),
        "questions": read_json_file(item_dir / "questions.json", "题目数据"),
    }


def cmd_put_item(args):
    payload = item_payload_from_dir(Path(args.dir))
    if args.reset_annotations:
        payload["resetAnnotations"] = True
    request(args, "PUT", f"/api/items/{args.exam}/{args.item}", payload)
    note = "，并已重置批注" if args.reset_annotations else "（保留已有批注）"
    print(f"已整体替换试题组 {args.exam}/{args.item}{note}")
    return 0


def cmd_patch_item(args):
    payload = {}
    if args.meta:
        payload["meta"] = read_json_file(Path(args.meta), "试题组元数据")
    if args.material:
        payload["material"] = Path(args.material).read_text(encoding="utf-8")
    if args.questions:
        payload["questions"] = read_json_file(Path(args.questions), "题目数据")
    if not payload:
        fail("未提供要更新的文件：--meta / --material / --questions")
    request(args, "PATCH", f"/api/items/{args.exam}/{args.item}", payload)
    print(f"已局部更新试题组 {args.exam}/{args.item}：{'、'.join(payload)}")
    return 0


def cmd_delete_item(args):
    if not confirm(f"确认删除试题组 {args.exam}/{args.item}？", args.yes):
        print("已取消")
        return 0
    request(args, "DELETE", f"/api/items/{args.exam}/{args.item}")
    print(f"已删除试题组 {args.exam}/{args.item}")
    return 0


def cmd_push_exam(args):
    """把本地考试集目录（meta.json + item-*）校验后整体上传到服务端。"""
    exam_dir = Path(args.exam_dir)
    if not exam_dir.is_dir():
        fail(f"考试集目录不存在: {exam_dir}")
    exam_id = args.id or exam_dir.name
    if not exam_id or "/" in exam_id:
        fail(f"非法考试集 id: {exam_id!r}")

    # 上传前先跑结构校验（validate_exam.py 与本脚本同目录）
    validator = Path(__file__).with_name("validate_exam.py")
    if validator.is_file():
        import subprocess
        result = subprocess.run([sys.executable, str(validator), str(exam_dir)])
        if result.returncode != 0:
            fail("校验未通过（0 errors 才会上传），请先修复上述问题")
        print("-- 校验通过 --")

    item_dirs = sorted((d for d in exam_dir.iterdir() if d.is_dir() and d.name.startswith("item-")), key=lambda d: d.name)
    if not item_dirs:
        fail(f"目录中没有 item-* 试题组: {exam_dir}")
    if args.force and exam_exists(args, exam_id):
        request(args, "DELETE", f"/api/examinations/{exam_id}")
        print(f"已删除同名考试集“{exam_id}”")
    elif not exam_exists(args, exam_id):
        request(args, "POST", "/api/examinations", {"id": exam_id})
    exam_meta = {}
    meta_file = exam_dir / "meta.json"
    if meta_file.is_file():
        try:
            exam_meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    patch = {}
    if exam_meta.get("name"):
        patch["name"] = exam_meta["name"]
    if exam_meta.get("description"):
        patch["description"] = exam_meta["description"]
    if patch:
        request(args, "PATCH", f"/api/examinations/{exam_id}", patch)

    for item_dir in item_dirs:
        payload = item_payload_from_dir(item_dir)
        request(args, "PUT", f"/api/items/{exam_id}/{item_dir.name}", payload)
        questions = len(payload["questions"])
        print(f"  ✓ {item_dir.name} 「{payload['meta'].get('name', item_dir.name)}」 {questions} 题")
    print(f"已上传考试集“{exam_id}”（{len(item_dirs)} 个试题组）到 {base_url(args)}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", help=f"classbuddy 服务地址（默认 {DEFAULT_URL}，可用环境变量 CLASSBUDDY_URL）")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("health").set_defaults(func=cmd_health)
    sub.add_parser("list-exams").set_defaults(func=cmd_list_exams)

    p = sub.add_parser("get-exam")
    p.add_argument("exam")
    p.add_argument("--full", action="store_true", help="返回全部试题组的 meta/material/questions")
    p.set_defaults(func=cmd_get_exam)

    p = sub.add_parser("create-exam")
    p.add_argument("exam")
    p.add_argument("--name")
    p.add_argument("--description")
    p.add_argument("--force", action="store_true", help="同名考试集已存在时先删除")
    p.set_defaults(func=cmd_create_exam)

    p = sub.add_parser("update-exam")
    p.add_argument("exam")
    p.add_argument("--name")
    p.add_argument("--description")
    p.set_defaults(func=cmd_update_exam)

    p = sub.add_parser("delete-exam")
    p.add_argument("exam")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_delete_exam)

    p = sub.add_parser("get-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--out", help="把 meta/material/questions 写入该本地目录")
    p.set_defaults(func=cmd_get_item)

    p = sub.add_parser("put-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--dir", required=True, help="本地试题组目录（含 meta.json/material.md/questions.json）")
    p.add_argument("--reset-annotations", action="store_true", help="同时把批注重置为空")
    p.set_defaults(func=cmd_put_item)

    p = sub.add_parser("patch-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--meta", help="meta.json 文件路径")
    p.add_argument("--material", help="material.md 文件路径")
    p.add_argument("--questions", help="questions.json 文件路径")
    p.set_defaults(func=cmd_patch_item)

    p = sub.add_parser("delete-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_delete_item)

    p = sub.add_parser("push-exam")
    p.add_argument("exam_dir", help="本地考试集目录（meta.json + item-*）")
    p.add_argument("--id", help="服务端考试集 id（默认取目录名）")
    p.add_argument("--force", action="store_true", help="服务端同名考试集已存在时先删除再上传")
    p.set_defaults(func=cmd_push_exam)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
