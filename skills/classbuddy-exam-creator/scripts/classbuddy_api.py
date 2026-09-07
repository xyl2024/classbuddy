#!/usr/bin/env python3
"""classbuddy HTTP 接口客户端：对运行中的 classbuddy 服务做试卷增删查改，含连通与鉴权检测。

Usage:
  python3 classbuddy_api.py <command> [args...] [--url URL] [--user U] [--password P|--auth U:P]

服务地址优先级:  --url > 环境变量 CLASSBUDDY_URL > 配置文件 exam-creator.json > http://localhost:3000
鉴权凭据优先级:  --auth/--user/--password > 环境变量 CLASSBUDDY_AUTH（user:pass）
                / CLASSBUDDY_USER + CLASSBUDDY_PASS > 配置文件 user/password
凭据可选；服务端未启用鉴权时无需携带。configure 可把地址/凭据持久化到
~/.classbuddy/exam-creator.json（脚本每次自动加载，等价于配置了上面几组环境变量）。

命令:
  check                                             连通性 + 鉴权检测（使用本 skill 前先跑）
  configure [--url URL] [--user U] [--password P]   把地址/账号密码写入配置文件
  health                                            检查服务是否可达（启用鉴权时需带凭据）
  list-exams                                        列出全部考试集
  get-exam <examId> [--full]                        查看考试集（--full 含全部试题组内容）
  create-exam <examId> [--name N] [--description D] [--force]
                                                    创建考试集；--force 先删除同名
  update-exam <examId> [--name N] [--description D]
                                                    更新考试集元数据
  delete-exam <examId> [--yes]                      删除考试集（--yes 跳过确认）
  get-item <examId> <itemId> [--out DIR]            查看试题组；--out 把 meta/material/questions/annotations 写入本地目录
  put-item <examId> <itemId> --dir DIR [--reset-annotations]
                                                    用本地试题组目录整体替换服务端试题组
  patch-item <examId> <itemId> [--meta F] [--material F] [--questions F] [--reset-annotations]
                                                    局部更新试题组的部分文件；改 material 时若已有批注会收到错位警告
  delete-item <examId> <itemId> [--yes]             删除试题组
  push-exam <examDir> [--id ID] [--force]           校验本地考试集目录后整体上传（含全部 item-*）

退出码: 0 成功，1 失败（错误信息输出到 stderr）。
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_URL = "http://localhost:3000"
CONFIG_FILE = "exam-creator.json"
EMPTY_ANNOTATIONS = {"version": 1, "annotations": []}


# ---------- 地址 / 凭据 / 配置文件 ----------

def config_path() -> Path:
    root = Path(os.environ.get("CLASSBUDDY_CONFIG") or (Path.home() / ".classbuddy"))
    return root / CONFIG_FILE


def load_config() -> dict:
    try:
        return json.loads(config_path().read_text(encoding="utf-8"))
    except Exception:
        return {}


def base_url(args) -> str:
    """服务地址：--url > 环境变量 CLASSBUDDY_URL > 配置文件 url > 默认。"""
    url = (getattr(args, "url", None) or os.environ.get("CLASSBUDDY_URL") or load_config().get("url") or DEFAULT_URL)
    return str(url).rstrip("/")


def resolve_credentials(args):
    """返回 (user, password)；未配置时返回 None。优先级：CLI > 环境变量 > 配置文件。"""
    auth = getattr(args, "auth", None)
    if auth:
        return tuple(auth.split(":", 1)) if ":" in auth else (auth, "")
    user = getattr(args, "user", None) or ""
    password = getattr(args, "password", None) or ""
    if user or password:
        return user, password
    env_auth = os.environ.get("CLASSBUDDY_AUTH", "")
    if ":" in env_auth:
        return tuple(env_auth.split(":", 1))
    if env_auth:
        return env_auth, ""
    env_user = os.environ.get("CLASSBUDDY_USER") or ""
    env_pass = os.environ.get("CLASSBUDDY_PASS") or ""
    if env_user or env_pass:
        return env_user, env_pass
    cfg = load_config()
    cfg_user = cfg.get("user") or ""
    cfg_pass = cfg.get("password") or ""
    if cfg_user or cfg_pass:
        return cfg_user, cfg_pass
    return None


def auth_header(args):
    cred = resolve_credentials(args)
    if not cred:
        return None
    token = base64.b64encode(f"{cred[0]}:{cred[1]}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def parse_body(raw: bytes):
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def do_request(args, method: str, path: str, payload=None, raw: bytes | None = None, with_auth=None):
    """发请求，返回 (status, parsed_body, error)。不会因 HTTP/连接错误直接退出。

    with_auth: None 表示"有凭据就带"，True 强制带，False 强制不带。
    返回 status=None 且 error 非空表示连接/URL 级失败。
    """
    url = base_url(args) + path
    headers = {}
    use_auth = with_auth if with_auth is not None else (resolve_credentials(args) is not None)
    if use_auth:
        headers["Authorization"] = auth_header(args)
    data = raw if raw is not None else (json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None)
    if data is not None and raw is None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, parse_body(resp.read()), None
    except urllib.error.HTTPError as e:
        return e.code, parse_body(e.read()), None
    except urllib.error.URLError as e:
        return None, None, f"无法连接 classbuddy 服务（{base_url(args)}）：{e.reason}"


def request(args, method: str, path: str, payload=None, raw: bytes | None = None):
    """发请求并期望 2xx；非 2xx 或连接失败时抛 SystemExit(1)。"""
    status, body, err = do_request(args, method, path, payload, raw)
    if err:
        fail(f"{err}\n提示：先用 npm run dev 启动服务，或用 check / configure 校正地址与凭据。")
    if status is None or not (200 <= status < 300):
        msg = body.get("error") if isinstance(body, dict) else None
        fail(f"HTTP {status} {method} {path}: {msg or (body if body else status)}")
    return status, body


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

def cmd_check(args):
    """连通性 + 鉴权检测：供使用本 skill 前调用。以 STATUS= 结尾供上层判断。"""
    cred = resolve_credentials(args)
    print("classbuddy 使用前检查")
    print(f"  服务地址: {base_url(args)}")
    print(f"  鉴权凭据: {'user = ' + cred[0] if cred else '（未配置）'}")

    # 1) 连通性：对 /api/health 不带凭据探测（拿不到 200/401 即视为不可达）
    st, _, err = do_request(args, "GET", "/api/health", with_auth=False)
    if st is None:
        print(f"  连接    : 失败 → {err}")
        print("  处理    : 请确认服务已启动（npm run dev），并提供正确的服务地址")
        print("STATUS=unreachable")
        return 1
    print(f"  连接    : 可达（HTTP {st}）")

    # 2) 鉴权：对 /api/auth/check 不带凭据探测，401 表示服务端要求鉴权
    st2, _, _ = do_request(args, "GET", "/api/auth/check", with_auth=False)
    if st2 != 401:
        print("  鉴权    : 服务端未启用鉴权（无需账号密码）")
        print("STATUS=ok")
        return 0
    print("  鉴权    : 服务端要求 Basic Auth")

    if not cred:
        print("  凭据    : 缺失（需要账号密码才能写入试卷）")
        print("  处理    : 请向用户索取账号与密码后用 configure 配置")
        print("STATUS=need-auth-config")
        return 1
    st3, _, _ = do_request(args, "GET", "/api/auth/check", with_auth=True)
    if st3 == 200:
        print("  凭据    : 验证通过")
        print("STATUS=ok")
        return 0
    print("  凭据    : 验证失败（用户名或密码错误）")
    print("  处理    : 请向用户重新索取账号密码后 configure 覆盖")
    print("STATUS=auth-invalid")
    return 1


def cmd_configure(args):
    cfg = load_config()
    if args.url is not None:
        cfg["url"] = args.url.rstrip("/")
    if args.auth:
        user, _, password = args.auth.partition(":")
        cfg["user"], cfg["password"] = user, password
    if args.user is not None:
        cfg["user"] = args.user
    if args.password is not None:
        cfg["password"] = args.password
    cfg_path = config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        cfg_path.chmod(0o600)
    except OSError:
        pass
    print(f"已写入配置 {cfg_path}")
    if cfg.get("url"):
        print(f"  服务地址: {cfg['url']}")
    print("  账号    : " + (cfg.get("user", "")))
    print("  密码    : " + ("******" if cfg.get("password") else ""))
    print("（后续脚本调用会自动加载；等效环境变量 CLASSBUDDY_URL / CLASSBUDDY_USER / CLASSBUDDY_PASS）")
    return 0


def cmd_health(args):
    request(args, "GET", "/api/health")
    print(f"OK {base_url(args)}")
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
        (out / "annotations.json").write_text(json.dumps(data.get("annotations", EMPTY_ANNOTATIONS), ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入 {out}/（meta.json、material.md、questions.json、annotations.json）")
        anns = data.get("annotations", {}).get("annotations", [])
        if anns:
            print(f"提示：该试题组有 {len(anns)} 条批注（已写入 annotations.json）；"
                  f"material.md 的文本偏移量与批注对应，改动材料会使批注错位，push 回去时可用 --reset-annotations 重置")
        if any(isinstance(q, dict) and q.get("type") in ("gap-fill", "cloze", "grammar-fill") for q in data.get("questions", [])):
            print("提示：该题型短文在 questions.json 首题的 passage 字段，不在 material.md；material.md 只是说明文字")
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
    _, resp = request(args, "PUT", f"/api/items/{args.exam}/{args.item}", payload)
    note = "，并已重置批注" if args.reset_annotations else "（保留已有批注）"
    print(f"已整体替换试题组 {args.exam}/{args.item}{note}")
    if resp.get("warning"):
        print(f"WARN  {resp['warning']}")
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
    if args.reset_annotations:
        payload["resetAnnotations"] = True
    _, resp = request(args, "PATCH", f"/api/items/{args.exam}/{args.item}", payload)
    note = "，并已重置批注" if args.reset_annotations else "（保留已有批注）"
    print(f"已局部更新试题组 {args.exam}/{args.item}：{'、'.join(payload)}{note}")
    if resp.get("warning"):
        print(f"WARN  {resp['warning']}")
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
    if not exam_exists(args, exam_id):
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
        _, resp = request(args, "PUT", f"/api/items/{exam_id}/{item_dir.name}", payload)
        questions = len(payload["questions"])
        print(f"  ✓ {item_dir.name} 「{payload['meta'].get('name', item_dir.name)}」 {questions} 题")
        if resp.get("warning"):
            print(f"  ! {resp['warning']}")
    print(f"已上传考试集“{exam_id}”（{len(item_dirs)} 个试题组）到 {base_url(args)}")
    return 0


def main():
    # 公共选项：地址与鉴权凭据，可放在子命令前后任意位置
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--url", help=f"classbuddy 服务地址（默认 {DEFAULT_URL}，可用 CLASSBUDDY_URL 或配置文件）")
    common.add_argument("--user", help="Basic Auth 用户名（可用 CLASSBUDDY_USER / 配置文件）")
    common.add_argument("--password", help="Basic Auth 密码（可用 CLASSBUDDY_PASS / 配置文件）")
    common.add_argument("--auth", help="Basic Auth 凭据 user:pass（与 --user/--password 等效，可用 CLASSBUDDY_AUTH / 配置文件）")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    def make_sub(*names, **kw):
        return sub.add_parser(*names, parents=[common], **kw)

    make_sub("check").set_defaults(func=cmd_check)
    make_sub("health").set_defaults(func=cmd_health)

    p = make_sub("configure", help="把服务地址/账号密码写入配置文件")
    p.set_defaults(func=cmd_configure)

    make_sub("list-exams").set_defaults(func=cmd_list_exams)

    p = make_sub("get-exam")
    p.add_argument("exam")
    p.add_argument("--full", action="store_true", help="返回全部试题组的 meta/material/questions")
    p.set_defaults(func=cmd_get_exam)

    p = make_sub("create-exam")
    p.add_argument("exam")
    p.add_argument("--name")
    p.add_argument("--description")
    p.add_argument("--force", action="store_true", help="同名考试集已存在时先删除")
    p.set_defaults(func=cmd_create_exam)

    p = make_sub("update-exam")
    p.add_argument("exam")
    p.add_argument("--name")
    p.add_argument("--description")
    p.set_defaults(func=cmd_update_exam)

    p = make_sub("delete-exam")
    p.add_argument("exam")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_delete_exam)

    p = make_sub("get-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--out", help="把 meta/material/questions 写入该本地目录")
    p.set_defaults(func=cmd_get_item)

    p = make_sub("put-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--dir", required=True, help="本地试题组目录（含 meta.json/material.md/questions.json）")
    p.add_argument("--reset-annotations", action="store_true", help="同时把批注重置为空")
    p.set_defaults(func=cmd_put_item)

    p = make_sub("patch-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--meta", help="meta.json 文件路径")
    p.add_argument("--material", help="material.md 文件路径（改动会使文本偏移量批注错位，服务端会返回警告）")
    p.add_argument("--questions", help="questions.json 文件路径")
    p.add_argument("--reset-annotations", action="store_true", help="同时把批注重置为空（配合 --material 使用）")
    p.set_defaults(func=cmd_patch_item)

    p = make_sub("delete-item")
    p.add_argument("exam")
    p.add_argument("item")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_delete_item)

    p = make_sub("push-exam")
    p.add_argument("exam_dir", help="本地考试集目录（meta.json + item-*）")
    p.add_argument("--id", help="服务端考试集 id（默认取目录名）")
    p.add_argument("--force", action="store_true", help="服务端同名考试集已存在时先删除再上传")
    p.set_defaults(func=cmd_push_exam)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
