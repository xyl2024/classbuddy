#!/usr/bin/env python3
"""classbuddy 试卷生成器（子命令版）：用一串命令逐题型搭建考试集目录，不手写 JSON。

Usage:
  python3 build_exam.py <子命令> [参数...]

考试集级:
  init <examDir> --name N [--description D] [--force]     创建考试集目录与 meta.json
  list <examDir>                                          概览各试题组
  validate <examDir>                                      结构校验（0 errors 才算通过）
  push <examDir> [--url URL] [--id ID] [--force]          校验后整体上传到运行中的服务

试题组级:
  add-item <examDir> --name N [--type sectionType] [--instruction I]
        [--description D] [--score-per-question X] [--total-score Y]
        [--material TEXT]                                 新建 item-N（含 4 个文件）
  set-material <examDir> --item item-N --material TEXT    写入材料正文（阅读理解必做）
  update-item <examDir> --item item-N [--name] [--type] [--instruction]
        [--description] [--score-per-question] [--total-score]   修改元数据

题目级（阅读/情景/书面表达，整题一条命令）:
  add-choice <examDir> --item item-N --question Q --opt K=T... --answer K
        [--explanation E] [--id ID]                       阅读理解单选
  add-dialogue <examDir> --item item-N --line "说话人|台词"...（待填行写 {{blank}}）
        --opt K=T... --answer K [--explanation E] [--id ID]   情景交际
  add-writing <examDir> --item item-N --prompt P [--greeting G] [--closing C]
        [--point P]... [--sample S] [--comment C] [--id ID]   书面表达

题目级（五选五/完形/语法填空：短文一条命令，逐空一条命令）:
  set-passage <examDir> --item item-N --type gap-fill|cloze|grammar-fill
        --passage TEXT [--replace]                        写入短文（含 {{blank:题号}} 标记）
  gap-set-options <examDir> --item item-N --opt K=T...   设置五选五共用备选句（默认模板下必须 5 个）
  add-blank-gap <examDir> --item item-N --label N --answer K [--explanation E]
  add-blank-cloze <examDir> --item item-N --label N --opt K=T...（通常 4 项）
        --answer K [--explanation E]
  add-blank-grammar <examDir> --item item-N --label N --answer WORD [--hint H]
        [--explanation E]

修正:
  remove-question <examDir> --item item-N --id qID        删除一道题
  remove-blank <examDir> --item item-N --label N          删除一个空位（连同其选项）

长文本约定: 所有文本参数都支持 `@路径`（读文件）或 `-`（读 stdin），如
  --passage @/tmp/passage.txt ；短文本直接内联即可。

退出码: 0 成功，1 失败，2 用法错误。
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

BLANK_RE = re.compile(r"\{\{blank:(\w+)\}\}")
DIALOGUE_BLANK_RE = re.compile(r"\{\{blank\}\}")
EXAM_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
AUTO_DESC_WRITING = "书面表达，含范文与点评"

PASSAGE_TYPES = {"gap-fill", "cloze", "grammar-fill"}
SECTION_TYPES = {
    "situational-communication", "reading-comprehension",
    "gap-fill", "cloze", "grammar-fill", "writing",
}
# 试题组 name 必须是且仅是这些题型名（材料卡片/题目卡片标题直接展示 name）
ALLOWED_ITEM_NAMES = {"情景交际", "阅读理解", "五选五", "完形填空", "语法填空", "书面表达"}


def check_item_name(name: str) -> None:
    if name.strip() not in ALLOWED_ITEM_NAMES:
        fail(f"--name 必须是 {'/'.join(sorted(ALLOWED_ITEM_NAMES))} 之一，得到 {name!r}（不能带篇目、副标题等附加文字，如“阅读理解 A — xxx”不合法）")
QTYPE_TO_SECTION = {
    "choice": "reading-comprehension",
    "dialogue-choice": "situational-communication",
    "gap-fill": "gap-fill",
    "cloze": "cloze",
    "grammar-fill": "grammar-fill",
    "writing": "writing",
}
# 各题型默认分值：每小题 X 分（书面表达整题 25 分，只有 1 题故按每小题计）
DEFAULT_SCORES = {
    "situational-communication": 3,
    "reading-comprehension": 3,
    "gap-fill": 3,
    "cloze": 3,
    "grammar-fill": 2,
    "writing": 25,
}
DEFAULT_INSTRUCTIONS = {
    "situational-communication": "从下列各题所给的 A、B、C 和 D 项中选出最佳选项，补全对话。",
    "reading-comprehension": "阅读下列短文，掌握其大意，然后从每题所给的 A、B、C 和 D 项中选出最佳选项。",
    "gap-fill": "从下列备选句子中选出能填入短文空缺处的最佳选项（如有多余选项请忽略）。",
    "cloze": "阅读下面短文，掌握其大意，然后从每题所给的 A、B、C 和 D 项中选出填入空格处的最佳选项。",
    "grammar-fill": "阅读下面短文，在空白处填入 1 个适当的单词或括号内单词的正确形式。",
    "writing": "根据提示完成书面表达。",
}
DEFAULT_MATERIAL = {
    "situational-communication": "本篇为情景交际题型，对话见题目区，无需材料。",
    "reading-comprehension": "",  # 必须由 set-material 提供
    "gap-fill": "本篇为选句填空题型，短文与备选句子见题目区。",
    "cloze": "本篇为完形填空题型，短文见题目区。",
    "grammar-fill": "本篇为语法填空题型，短文见题目区。",
    "writing": "本篇为书面表达题型，题目要求见题目区。",
}


def fail(message: str, code: int = 1):
    print(f"ERROR {message}", file=sys.stderr)
    sys.exit(code)


# ---------- 基础工具 ----------

def read_text_arg(value: str, flag: str) -> str:
    """文本参数：@路径 读文件，- 读 stdin，其余为字面文本。"""
    if value == "-":
        return sys.stdin.read().rstrip("\n")
    if value.startswith("@"):
        path = Path(value[1:])
        if not path.is_file():
            fail(f"{flag}: 文件不存在: {path}")
        return path.read_text(encoding="utf-8").rstrip("\n")
    return value


def parse_opts(pairs: list[str], flag: str) -> list[dict]:
    """把 ["A=text", ...] 解析为 [{"key","text"}]，保持书写顺序。"""
    out = []
    for pair in pairs:
        if "=" not in pair:
            fail(f"{flag}: 格式应为 key=选项内容，得到 {pair!r}")
        key, text = pair.split("=", 1)
        if not key.strip() or not text.strip():
            fail(f"{flag}: key 与选项内容都不能为空: {pair!r}")
        out.append({"key": key.strip(), "text": text.strip()})
    keys = [o["key"] for o in out]
    if len(set(keys)) != len(keys):
        fail(f"{flag}: 选项 key 重复: {keys}")
    return out


def parse_lines(pairs: list[str], flag: str) -> list[dict]:
    """把 ["Mike|Thank you", ...] 解析为 [{"speaker","text"}]。"""
    out = []
    for pair in pairs:
        if "|" not in pair:
            fail(f"{flag}: 格式应为 说话人|台词，得到 {pair!r}")
        speaker, text = pair.split("|", 1)
        if not speaker.strip() or not text.strip():
            fail(f"{flag}: 说话人与台词都不能为空: {pair!r}")
        out.append({"speaker": speaker.strip(), "text": text.strip()})
    return out


def read_json(path: Path, what: str, default=None):
    if not path.is_file():
        if default is not None:
            return default
        fail(f"缺少 {what}: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"{what} 不是合法 JSON（{path}）: {e}")


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def item_dir(exam_dir: Path, item: str) -> Path:
    name = item if item.startswith("item-") else f"item-{item}"
    d = exam_dir / name
    if not d.is_dir():
        fail(f"试题组不存在: {exam_dir}/{name}（先 add-item 创建）")
    return d


def load_questions(d: Path) -> list:
    return read_json(d / "questions.json", "questions.json", default=[])


def load_meta(d: Path) -> dict:
    return read_json(d / "meta.json", "meta.json", default={})


def save_item(d: Path, meta: dict, questions: list) -> None:
    write_json(d / "meta.json", meta)
    write_json(d / "questions.json", questions)


def passage_question(questions: list) -> dict | None:
    return next((q for q in questions if q.get("type") in PASSAGE_TYPES), None)


def fill_meta_defaults(meta: dict, questions: list) -> dict:
    """按当前状态补全缺省元数据；用户显式设置过的字段（非缺省值）不覆盖。"""
    passage_q = passage_question(questions)
    # 短文题型（五选五/完形/语法填空）按空位数计小题数，其余按题目数
    n = len(passage_q.get("blanks", [])) if passage_q else len(questions)
    qtype = next((q.get("type") for q in questions if isinstance(q, dict)), None)
    if qtype and not meta.get("sectionType"):
        meta["sectionType"] = QTYPE_TO_SECTION.get(qtype)
    st = meta.get("sectionType")
    if not meta.get("instruction"):
        meta["instruction"] = DEFAULT_INSTRUCTIONS.get(st, "")
    if "scorePerQuestion" not in meta:
        meta["scorePerQuestion"] = DEFAULT_SCORES.get(st, 1)
    if "totalScore" not in meta:
        meta["totalScore"] = round(n * meta["scorePerQuestion"], 2)
    desc = meta.get("description")
    auto = AUTO_DESC_WRITING if st == "writing" else (f"共{n}小题" if n else "")
    if not desc or re.fullmatch(r"共\d+小题", desc) or desc == AUTO_DESC_WRITING:
        meta["description"] = auto
    return meta


def refresh_passage_meta(meta: dict, q: dict) -> dict:
    """空位数变化后重算短文题型的 totalScore 与“共 N 小题”描述。

    （教师如需覆盖，可在空位添完后再用 update-item --total-score。）
    """
    if q.get("type") not in PASSAGE_TYPES:
        return meta
    if not meta.get("sectionType"):
        meta["sectionType"] = QTYPE_TO_SECTION[q["type"]]
    n = len(q.get("blanks", []))
    spq = meta.get("scorePerQuestion", DEFAULT_SCORES.get(meta.get("sectionType"), 1))
    meta["totalScore"] = round(n * spq, 2)
    meta["description"] = f"共{n}小题"
    return meta


def get_passage_q(d: Path, questions: list) -> dict:
    q = passage_question(questions)
    if q is None:
        fail(f"{d.name}: 还没有短文。先用 set-passage --type ... 写入短文（含 {{blank:题号}} 标记）")
    return q


def check_label_in_passage(q: dict, label: str, d: Path) -> None:
    markers = BLANK_RE.findall(q.get("passage", ""))
    if not markers:
        fail(f"{d.name}: passage 中没有任何 {{{{blank:题号}}}} 标记")
    if label not in markers:
        fail(f"{d.name}: passage 中没有 {{{{blank:{label}}}}} 标记（现有: {markers}）")
    if any(b.get("label") == label for b in q.get("blanks", [])):
        fail(f"{d.name}: 空位 {label} 已存在；如需修改先 remove-blank 再重加")


def check_answer(answer: str, keys: list[str], ctx: str) -> None:
    if answer not in keys:
        fail(f"{ctx}: answer “{answer}” 必须是选项 key 之一 {keys}")


# ---------- 考试集级命令 ----------

def cmd_init(args):
    exam_dir = Path(args.exam_dir)
    if (exam_dir / "meta.json").is_file() and not args.force:
        fail(f"考试集已存在: {exam_dir}（--force 覆盖 meta.json）", 1)
    if not EXAM_ID_RE.match(exam_dir.name):
        fail(f"目录名 “{exam_dir.name}” 只能含字母、数字、连字符、下划线（用作服务端 id）")
    exam_dir.mkdir(parents=True, exist_ok=True)
    meta = {"name": args.name}
    if args.description:
        meta["description"] = args.description
    write_json(exam_dir / "meta.json", meta)
    print(f"已创建考试集「{args.name}」→ {exam_dir}")
    return 0


def cmd_list(args):
    exam_dir = Path(args.exam_dir)
    meta = read_json(exam_dir / "meta.json", "考试集 meta.json", default={})
    print(f"考试集「{meta.get('name', exam_dir.name)}」: {exam_dir}")
    for d in sorted(p for p in exam_dir.iterdir() if p.is_dir() and p.name.startswith("item-")):
        m = load_meta(d)
        questions = load_questions(d)
        q = passage_question(questions)
        blanks = len(q.get("blanks", [])) if q else 0
        markers = len(BLANK_RE.findall(q.get("passage", ""))) if q else 0
        extra = f"，空位 {blanks}/{markers}" if q else ""
        print(f"  {d.name} 「{m.get('name', '?')}」 {m.get('sectionType', '?')} {len(questions)} 题{extra}")
    return 0


def cmd_validate(args):
    validator = Path(__file__).with_name("validate_exam.py")
    result = subprocess.run([sys.executable, str(validator), args.exam_dir])
    if result.returncode == 0:
        # 补充检查：阅读理解 material 不能是占位说明
        exam_dir = Path(args.exam_dir)
        for d in sorted(p for p in exam_dir.iterdir() if p.is_dir() and p.name.startswith("item-")):
            meta = load_meta(d)
            if meta.get("sectionType") == "reading-comprehension":
                text = (d / "material.md").read_text(encoding="utf-8") if (d / "material.md").is_file() else ""
                if len(text.strip()) < 60:
                    print(f"WARN  [{d.name}] 阅读理解材料过短（{len(text.strip())} 字符），确认已写入完整文章")
    return result.returncode


def cmd_push(args):
    api = Path(__file__).with_name("classbuddy_api.py")
    if not api.is_file():
        fail(f"找不到 {api}")
    cmd = [sys.executable, str(api)]
    if args.url:
        cmd += ["--url", args.url]
    cmd += ["push-exam", args.exam_dir]
    if args.id:
        cmd += ["--id", args.id]
    if args.force:
        cmd += ["--force"]
    return subprocess.run(cmd).returncode


# ---------- 试题组级命令 ----------

def cmd_add_item(args):
    check_item_name(args.name)
    exam_dir = Path(args.exam_dir)
    if not (exam_dir / "meta.json").is_file():
        fail(f"{exam_dir} 不是考试集目录（缺 meta.json），先 init")
    idx = 1
    while (exam_dir / f"item-{idx}").is_dir():
        idx += 1
    d = exam_dir / f"item-{idx}"
    d.mkdir(parents=True)

    if args.type and args.type not in SECTION_TYPES:
        fail(f"--type 必须是 {'/'.join(sorted(SECTION_TYPES))} 之一，得到 {args.type!r}")
    meta = {"name": args.name}
    if args.type:
        meta["sectionType"] = args.type
    if args.instruction:
        meta["instruction"] = read_text_arg(args.instruction, "--instruction")
    if args.description:
        meta["description"] = args.description
    if args.score_per_question is not None:
        meta["scorePerQuestion"] = args.score_per_question
    elif args.type:
        meta["scorePerQuestion"] = DEFAULT_SCORES.get(args.type, 1)
    if args.total_score is not None:
        meta["totalScore"] = args.total_score

    material = read_text_arg(args.material, "--material") if args.material else ""
    if not material.strip():
        material = f"# {args.name}\n\n{DEFAULT_MATERIAL.get(args.type, '本题型内容见题目区。')}".strip()
    (d / "material.md").write_text(material + "\n", encoding="utf-8")
    write_json(d / "meta.json", meta)
    write_json(d / "questions.json", [])
    write_json(d / "annotations.json", {"version": 1, "annotations": []})
    print(f"已创建试题组 {d.name}「{args.name}」（{args.type or '待定题型'}）")
    return 0


def cmd_set_material(args):
    d = item_dir(Path(args.exam_dir), args.item)
    text = read_text_arg(args.material, "--material").strip()
    if not text:
        fail("--material 不能为空（阅读理解请提供完整文章正文）")
    (d / "material.md").write_text(text + "\n", encoding="utf-8")
    print(f"已写入 {d.name}/material.md（{len(text)} 字符）")
    return 0


def cmd_update_item(args):
    d = item_dir(Path(args.exam_dir), args.item)
    questions = load_questions(d)
    if args.type:
        if args.type not in SECTION_TYPES:
            fail(f"--type 必须是 {'/'.join(sorted(SECTION_TYPES))} 之一，得到 {args.type!r}")
        if questions:
            fail(f"{d.name}: 已有 {len(questions)} 道题，不能再用 --type 更换题型（当前基于题目内容会自动推导）；如确需换题型请新建试题组")
    meta = load_meta(d)
    if args.name:
        check_item_name(args.name)
        meta["name"] = args.name
    if args.type:
        meta["sectionType"] = args.type
    if args.instruction is not None:
        meta["instruction"] = read_text_arg(args.instruction, "--instruction")
    if args.description is not None:
        meta["description"] = args.description
    if args.score_per_question is not None:
        meta["scorePerQuestion"] = args.score_per_question
    if args.total_score is not None:
        meta["totalScore"] = args.total_score
    write_json(d / "meta.json", meta)
    print(f"已更新 {d.name} 元数据")
    return 0


# ---------- 整题命令 ----------

def append_question(d: Path, q: dict) -> None:
    meta = load_meta(d)
    questions = load_questions(d)
    existing_types = {x.get("type") for x in questions if isinstance(x, dict)}
    qtype = q["type"]
    passage_q = passage_question(questions)
    if qtype in PASSAGE_TYPES and (existing_types or passage_q is not None and passage_q is not q):
        fail(f"{d.name}: 该试题组已含其他题目；{qtype} 的短文题型只允许一道题（set-passage 维护）")
    if existing_types and existing_types != {qtype}:
        fail(f"{d.name}: 试题组内已有题型 {sorted(existing_types)}，不能再加 {qtype}，请新建试题组")
    if not q.get("id"):
        q["id"] = f"q{len(questions) + 1}"
    questions.append(q)
    meta = fill_meta_defaults(meta, questions)
    save_item(d, meta, questions)
    print(f"  ✓ {d.name}/{q['id']} {qtype}（现共 {len(questions)} 题）")


def warn_item(item: str, message: str) -> None:
    print(f"WARN  [{item}] {message}")


def cmd_add_choice(args):
    if not args.question:
        fail("缺少 --question")
    d = item_dir(Path(args.exam_dir), args.item)
    meta = load_meta(d)
    if meta.get("sectionType") == "reading-comprehension":
        mfile = d / "material.md"
        text = mfile.read_text(encoding="utf-8") if mfile.is_file() else ""
        if len(text.strip()) < 60:
            warn_item(d.name, "阅读理解材料过短（疑似还是占位说明）；讲解前请用 set-material 写入完整文章")
    keys = [o["key"] for o in parse_opts(args.opt, "--opt")]
    check_answer(args.answer, keys, d.name)
    q = {
        "type": "choice",
        "question": read_text_arg(args.question, "--question"),
        "options": parse_opts(args.opt, "--opt"),
        "answer": args.answer,
    }
    if args.explanation:
        q["explanation"] = read_text_arg(args.explanation, "--explanation")
    if args.id:
        q["id"] = args.id
    append_question(d, q)
    return 0


def cmd_add_dialogue(args):
    d = item_dir(Path(args.exam_dir), args.item)
    dialogue = parse_lines(args.line, "--line")
    if not DIALOGUE_BLANK_RE.search("".join(line["text"] for line in dialogue)):
        fail(f"{d.name}: 台词中缺少 {{{{blank}}}} 待填标记（通常在 You 的台词里）")
    keys = [o["key"] for o in parse_opts(args.opt, "--opt")]
    check_answer(args.answer, keys, d.name)
    q = {"type": "dialogue-choice", "dialogue": dialogue,
         "options": parse_opts(args.opt, "--opt"), "answer": args.answer}
    if args.explanation:
        q["explanation"] = read_text_arg(args.explanation, "--explanation")
    if args.id:
        q["id"] = args.id
    append_question(d, q)
    return 0


def cmd_add_writing(args):
    if not args.prompt:
        fail("缺少 --prompt")
    d = item_dir(Path(args.exam_dir), args.item)
    q = {"type": "writing", "prompt": read_text_arg(args.prompt, "--prompt")}
    if args.greeting:
        q["greeting"] = read_text_arg(args.greeting, "--greeting")
    if args.closing:
        q["closing"] = read_text_arg(args.closing, "--closing")
    if args.point:
        q["points"] = args.point
    if args.sample:
        q["sample"] = read_text_arg(args.sample, "--sample")
    if args.comment:
        q["comment"] = read_text_arg(args.comment, "--comment")
    if args.id:
        q["id"] = args.id
    append_question(d, q)
    return 0


# ---------- 短文 + 逐空命令 ----------

def cmd_set_passage(args):
    if args.type not in PASSAGE_TYPES:
        fail(f"--type 必须是 {'|'.join(sorted(PASSAGE_TYPES))}")
    if not args.passage:
        fail("缺少 --passage")
    d = item_dir(Path(args.exam_dir), args.item)
    meta = load_meta(d)
    questions = load_questions(d)
    text = read_text_arg(args.passage, "--passage").strip()
    markers = BLANK_RE.findall(text)
    if not markers:
        fail(f"--passage 中没有任何 {{{{blank:题号}}}} 标记")
    bad = [m for m in markers if not m.isdigit()]
    if bad:
        fail(f"--passage 中的题号必须是纯数字: {bad}（如 {{{{blank:36}}}}，不接受 {{{{blank:abc}}}}）")
    dups = sorted({m for m in markers if markers.count(m) > 1})
    if dups:
        fail(f"--passage 中的题号标记必须唯一，重复: {dups}")
    q = passage_question(questions)
    if q is not None:
        if not args.replace:
            fail(f"{d.name}: 短文已存在；确认要重写时加 --replace（会清掉已有 {len(q.get('blanks', []))} 个空位）")
        old = len(q.get("blanks", []))
        q["passage"] = text
        q["blanks"] = []
        print(f"  ! 已重写 {d.name} 短文，原有 {old} 个空位已清空，请逐空重新添加")
    else:
        if questions:
            fail(f"{d.name}: 试题组内已有其他题型，不能放短文题，请新建试题组")
        q = {"id": "q1", "type": args.type, "passage": text, "blanks": []}
        questions.append(q)
    meta = fill_meta_defaults(meta, questions)
    save_item(d, meta, questions)
    print(f"  ✓ {d.name}/{q['id']} {args.type} 短文（{len(markers)} 个标记: {markers}）")
    return 0


def get_gap_q(d: Path, expect_type: str) -> dict:
    q = get_passage_q(d, load_questions(d))
    if q["type"] != expect_type:
        fail(f"{d.name}: 短文题型是 {q['type']}，不是 {expect_type}")
    return q


def cmd_gap_set_options(args):
    d = item_dir(Path(args.exam_dir), args.item)
    q = get_gap_q(d, "gap-fill")
    opts = parse_opts(args.opt, "--opt")
    if not 5 <= len(opts) <= 7:
        print(f"WARN  {d.name}: 备选句 {len(opts)} 个（通常 5–7 个；默认模板下必须 5 个）")
    meta = load_meta(d)
    q["options"] = opts
    save_item(d, meta, questions_with(d, q))
    blanks = len(q.get("blanks", []))
    if blanks and len(opts) < blanks:
        print(f"WARN  {d.name}: 备选句 {len(opts)} 个少于已有空位数 {blanks}")
    print(f"  ✓ {d.name} 备选句 {len(opts)} 个: {[o['key'] for o in opts]}")
    return 0


def questions_with(d: Path, updated: dict) -> list:
    """把更新后的题目对象写回 questions 列表（按 id 替换）。"""
    questions = load_questions(d)
    questions[:] = [updated if x.get("id") == updated.get("id") else x for x in questions]
    return questions


def cmd_add_blank_gap(args):
    d = item_dir(Path(args.exam_dir), args.item)
    q = get_gap_q(d, "gap-fill")
    check_label_in_passage(q, args.label, d)
    opts = q.get("options") or []
    if not opts:
        fail(f"{d.name}: 五选五需先用 gap-set-options 设置共用备选句")
    check_answer(args.answer, [o["key"] for o in opts], f"{d.name} 空位 {args.label}")
    blank = {"label": args.label, "answer": args.answer}
    if args.explanation:
        blank["explanation"] = read_text_arg(args.explanation, "--explanation")
    q["blanks"] = [b for b in q.get("blanks", []) if b.get("label") != args.label] + [blank]
    q["blanks"].sort(key=lambda b: [m for m in BLANK_RE.findall(q["passage"])].index(b["label"]))
    save_item(d, refresh_passage_meta(load_meta(d), q), questions_with(d, q))
    print(f"  ✓ {d.name} 空位 {args.label} → {args.answer}（共 {len(q['blanks'])} 个）")
    return 0


def cmd_add_blank_cloze(args):
    d = item_dir(Path(args.exam_dir), args.item)
    q = get_gap_q(d, "cloze")
    check_label_in_passage(q, args.label, d)
    opts = parse_opts(args.opt, "--opt")
    if len(opts) != 4:
        print(f"WARN  {d.name}: 空位 {args.label} 有 {len(opts)} 个选项（通常为 4 项）")
    check_answer(args.answer, [o["key"] for o in opts], f"{d.name} 空位 {args.label}")
    blank = {"label": args.label, "options": opts, "answer": args.answer}
    if args.explanation:
        blank["explanation"] = read_text_arg(args.explanation, "--explanation")
    q["blanks"] = [b for b in q.get("blanks", []) if b.get("label") != args.label] + [blank]
    q["blanks"].sort(key=lambda b: [m for m in BLANK_RE.findall(q["passage"])].index(b["label"]))
    save_item(d, refresh_passage_meta(load_meta(d), q), questions_with(d, q))
    print(f"  ✓ {d.name} 空位 {args.label} → {args.answer}（共 {len(q['blanks'])} 个）")
    return 0


def cmd_add_blank_grammar(args):
    d = item_dir(Path(args.exam_dir), args.item)
    q = get_gap_q(d, "grammar-fill")
    check_label_in_passage(q, args.label, d)
    if not args.answer.strip():
        fail("--answer 不能为空（填单词或词形）")
    blank = {"label": args.label, "answer": args.answer.strip()}
    if args.hint:
        blank["hint"] = read_text_arg(args.hint, "--hint")
    if args.explanation:
        blank["explanation"] = read_text_arg(args.explanation, "--explanation")
    q["blanks"] = [b for b in q.get("blanks", []) if b.get("label") != args.label] + [blank]
    q["blanks"].sort(key=lambda b: [m for m in BLANK_RE.findall(q["passage"])].index(b["label"]))
    save_item(d, refresh_passage_meta(load_meta(d), q), questions_with(d, q))
    print(f"  ✓ {d.name} 空位 {args.label} → {args.answer}（共 {len(q['blanks'])} 个）")
    return 0


# ---------- 修正命令 ----------

def cmd_remove_item(args):
    import shutil
    d = item_dir(Path(args.exam_dir), args.item)
    ann = read_json(d / "annotations.json", "annotations.json", default={})
    anns = ann.get("annotations") if isinstance(ann, dict) else None
    # 批注为空 = annotations 数组存在且为空；结构异常（字段名不对等）一律按“有内容”保护
    has_content = not isinstance(anns, list) or len(anns) > 0
    if has_content and not args.yes:
        count = len(anns) if isinstance(anns, list) else "未知（annotations.json 结构异常）"
        fail(f"{d.name} 中存在批注（{count}），删除不可恢复；确认后加 --yes")
    shutil.rmtree(d)
    print(f"已删除试题组 {d.name}")
    return 0


def cmd_remove_question(args):
    d = item_dir(Path(args.exam_dir), args.item)
    questions = load_questions(d)
    remaining = [q for q in questions if q.get("id") != args.id]
    if len(remaining) == len(questions):
        fail(f"{d.name}: 没有题目 id={args.id}（现有: {[q.get('id') for q in questions]}）")
    save_item(d, load_meta(d), remaining)
    print(f"  ✓ 已删除 {d.name}/{args.id}（剩 {len(remaining)} 题）")
    return 0


def cmd_remove_blank(args):
    d = item_dir(Path(args.exam_dir), args.item)
    q = get_passage_q(d, load_questions(d))
    blanks = q.get("blanks", [])
    remaining = [b for b in blanks if b.get("label") != args.label]
    if len(remaining) == len(blanks):
        fail(f"{d.name}: 没有空位 {args.label}（现有: {[b.get('label') for b in blanks]}）")
    q["blanks"] = remaining
    save_item(d, refresh_passage_meta(load_meta(d), q), questions_with(d, q))
    print(f"  ✓ 已删除 {d.name} 空位 {args.label}（剩 {len(remaining)} 个）")
    return 0


# ---------- CLI ----------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="创建考试集目录与 meta.json")
    p.add_argument("exam_dir")
    p.add_argument("--name", required=True)
    p.add_argument("--description")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("list", help="概览各试题组")
    p.add_argument("exam_dir")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("validate", help="结构校验（0 errors 才算通过）")
    p.add_argument("exam_dir")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("push", help="校验后整体上传到运行中的服务")
    p.add_argument("exam_dir")
    p.add_argument("--url", help="classbuddy 服务地址（默认 http://localhost:3000，可用 CLASSBUDDY_URL）")
    p.add_argument("--id", help="服务端考试集 id（默认取目录名）")
    p.add_argument("--force", action="store_true", help="服务端同名时先删除再上传")
    p.set_defaults(func=cmd_push)

    p = sub.add_parser("add-item", help="新建试题组 item-N（含 4 个文件）")
    p.add_argument("exam_dir")
    p.add_argument("--name", required=True)
    p.add_argument("--type", help="sectionType（阅读=reading-comprehension、情景=situational-communication、五选五=gap-fill、完形=cloze、语法=grammar-fill、写作=writing）")
    p.add_argument("--instruction")
    p.add_argument("--description")
    p.add_argument("--score-per-question", type=float)
    p.add_argument("--total-score", type=float)
    p.add_argument("--material", help="材料正文（支持 @文件 与 -；缺省写占位说明）")
    p.set_defaults(func=cmd_add_item)

    p = sub.add_parser("set-material", help="写入材料正文（阅读理解必做）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--material", required=True, help="材料正文（支持 @文件 与 -）")
    p.set_defaults(func=cmd_set_material)

    p = sub.add_parser("update-item", help="修改试题组元数据")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--name")
    p.add_argument("--type")
    p.add_argument("--instruction")
    p.add_argument("--description")
    p.add_argument("--score-per-question", type=float)
    p.add_argument("--total-score", type=float)
    p.set_defaults(func=cmd_update_item)

    p = sub.add_parser("add-choice", help="阅读理解单选（整题一条命令）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--question", required=True, help="题干（支持 @文件 与 -）")
    p.add_argument("--opt", required=True, action="append", help="选项，格式 A=选项内容（重复 4 次）")
    p.add_argument("--answer", required=True, help="正确选项 key")
    p.add_argument("--explanation", help="解析（支持 @文件 与 -）")
    p.add_argument("--id")
    p.set_defaults(func=cmd_add_choice)

    p = sub.add_parser("add-dialogue", help="情景交际（整题一条命令）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--line", required=True, action="append", help="对话行，格式 说话人|台词（待填行台词里写 {{blank}}）")
    p.add_argument("--opt", required=True, action="append", help="选项，格式 A=选项内容（重复 4 次）")
    p.add_argument("--answer", required=True)
    p.add_argument("--explanation")
    p.add_argument("--id")
    p.set_defaults(func=cmd_add_dialogue)

    p = sub.add_parser("add-writing", help="书面表达（整题一条命令）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--prompt", required=True, help="题干要求（支持 @文件 与 -）")
    p.add_argument("--greeting")
    p.add_argument("--closing")
    p.add_argument("--point", action="append", help="写作要点（可重复）")
    p.add_argument("--sample", help="参考范文（支持 @文件 与 -）")
    p.add_argument("--comment", help="范文点评（支持 @文件 与 -）")
    p.add_argument("--id")
    p.set_defaults(func=cmd_add_writing)

    p = sub.add_parser("set-passage", help="写入短文（五选五/完形/语法填空共用，先于逐空命令）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--type", required=True, choices=sorted(PASSAGE_TYPES))
    p.add_argument("--passage", required=True, help="短文正文，含 {{blank:题号}} 标记（支持 @文件 与 -）")
    p.add_argument("--replace", action="store_true", help="重写短文（清掉已有空位）")
    p.set_defaults(func=cmd_set_passage)

    p = sub.add_parser("gap-set-options", help="设置五选五共用备选句")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--opt", required=True, action="append", help="备选句，格式 A=句子（5–7 个，可含干扰项；默认模板下必须 5 个）")
    p.set_defaults(func=cmd_gap_set_options)

    p = sub.add_parser("add-blank-gap", help="五选五：添加一个空位")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--label", required=True, help="全卷题号，须与 passage 标记一致")
    p.add_argument("--answer", required=True, help="正确备选句 key")
    p.add_argument("--explanation")
    p.set_defaults(func=cmd_add_blank_gap)

    p = sub.add_parser("add-blank-cloze", help="完形填空：添加一个空位（独立 4 选项）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--opt", required=True, action="append", help="选项，格式 A=单词（重复 4 次）")
    p.add_argument("--answer", required=True)
    p.add_argument("--explanation")
    p.set_defaults(func=cmd_add_blank_cloze)

    p = sub.add_parser("add-blank-grammar", help="语法填空：添加一个空位")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--answer", required=True, help="单词或括号词的正确形式")
    p.add_argument("--hint", help="括号提示词（无提示词的空省略）")
    p.add_argument("--explanation")
    p.set_defaults(func=cmd_add_blank_grammar)

    p = sub.add_parser("remove-item", help="删除整个试题组（不可恢复）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--yes", action="store_true", help="跳过批注检查确认")
    p.set_defaults(func=cmd_remove_item)

    p = sub.add_parser("remove-question", help="删除一道题")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--id", required=True)
    p.set_defaults(func=cmd_remove_question)

    p = sub.add_parser("remove-blank", help="删除一个空位（连同其选项）")
    p.add_argument("exam_dir")
    p.add_argument("--item", required=True)
    p.add_argument("--label", required=True)
    p.set_defaults(func=cmd_remove_blank)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
