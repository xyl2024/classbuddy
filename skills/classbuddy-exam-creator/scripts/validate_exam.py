#!/usr/bin/env python3
"""Validate a classbuddy examination directory (one exam set).

Usage: python3 validate_exam.py <exam-dir> [--json]

Checks directory structure, meta.json, material.md, questions.json field
rules for all six question types, blank-marker correspondence, and
annotations.json. Exits non-zero when errors are found.
"""
import json
import re
import sys
from pathlib import Path

SECTION_TYPES = {
    "situational-communication", "reading-comprehension",
    "gap-fill", "cloze", "grammar-fill", "writing",
}
# 试题组 name 必须是且仅是这些题型名（材料卡片/题目卡片标题直接展示 name）
ALLOWED_ITEM_NAMES = {"情景交际", "阅读理解", "五选五", "完形填空", "语法填空", "书面表达"}
REQUIRED_FILES = ["meta.json", "material.md", "questions.json", "annotations.json"]
BLANK_RE = re.compile(r"\{\{blank:(\w+)\}\}")
DIALOGUE_BLANK_RE = re.compile(r"\{\{blank\}\}")
NUM_RE = re.compile(r"^\d+$")

errors: list[str] = []
warnings: list[str] = []

# 默认模板：7 个试题组按标准顺序与题型组合（情景交际/阅读×2/五选五/完形/语法/写作）
DEFAULT_TEMPLATE_SECTIONS = [
    "situational-communication", "reading-comprehension", "reading-comprehension",
    "gap-fill", "cloze", "grammar-fill", "writing",
]
DEFAULT_TEMPLATE = False


def detect_default_template(item_dirs: list[Path]) -> bool:
    if len(item_dirs) != len(DEFAULT_TEMPLATE_SECTIONS):
        return False
    for d, st in zip(item_dirs, DEFAULT_TEMPLATE_SECTIONS):
        meta = load_json(d / "meta.json", d.name) if (d / "meta.json").is_file() else None
        if not isinstance(meta, dict) or meta.get("sectionType") != st:
            return False
    return True


def err(item: str, msg: str) -> None:
    errors.append(f"[{item}] {msg}")


def warn(item: str, msg: str) -> None:
    warnings.append(f"[{item}] {msg}")


def load_json(path: Path, item: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(item, f"{path.name} 不是合法 JSON: {e}")
        return None
    except OSError as e:
        err(item, f"无法读取 {path.name}: {e}")
        return None


def check_str(value, item: str, field: str, qid: str) -> bool:
    if not isinstance(value, str) or not value.strip():
        err(item, f"{qid}: 字段 {field} 必须是非空字符串")
        return False
    return True


def check_options(options, item: str, qid: str, expect: int | None, min_count: int) -> list[str] | None:
    if not isinstance(options, list) or len(options) < min_count:
        err(item, f"{qid}: options 必须是至少 {min_count} 个元素的数组")
        return None
    keys = []
    for opt in options:
        if not isinstance(opt, dict) or not check_str(opt.get("key"), item, "options[].key", qid) \
                or not check_str(opt.get("text"), item, "options[].text", qid):
            return None
        keys.append(opt["key"])
    if len(set(keys)) != len(keys):
        err(item, f"{qid}: options 内 key 重复: {keys}")
        return None
    if expect is not None and len(keys) != expect:
        warn(item, f"{qid}: options 有 {len(keys)} 项（通常为 {expect} 项）")
    return keys


def check_answer(answer, keys: list[str], item: str, qid: str) -> bool:
    if not isinstance(answer, str) or answer not in keys:
        err(item, f"{qid}: answer “{answer}” 必须是选项 key 之一 {keys}")
        return False
    return True


def check_explanation(value, item: str, qid: str) -> None:
    if value is not None and not isinstance(value, str):
        err(item, f"{qid}: explanation 必须是字符串")


def get_blank_labels(passage, item: str, qid: str) -> list[str] | None:
    if not check_str(passage, item, "passage", qid):
        return None
    labels = BLANK_RE.findall(passage)
    if not labels:
        err(item, f"{qid}: passage 中没有任何 {{{{blank:题号}}}} 标记")
        return None
    bad = [m for m in labels if not m.isdigit()]
    if bad:
        err(item, f"{qid}: passage 中的题号必须是纯数字: {bad}（如 {{{{blank:36}}}}）")
    dups = sorted({m for m in labels if labels.count(m) > 1})
    if dups:
        err(item, f"{qid}: passage 中的题号标记必须唯一，重复: {dups}")
    return labels


def check_blanks_match(blanks, markers, item: str, qid: str) -> None:
    labels = [b.get("label") for b in blanks if isinstance(b, dict)]
    if labels != markers:
        err(item, f"{qid}: blanks 的 label {labels} 与 passage 标记 {markers} 不一一对应（顺序也应一致）")


def check_question(q, item: str, index: str) -> None:
    if not isinstance(q, dict):
        err(item, f"{index}: 题目必须是对象")
        return
    qid = f"questions[{index}]"
    if "id" in q and not (isinstance(q["id"], str) and q["id"].strip()):
        err(item, f"{qid}: id 若存在必须是非空字符串")
    qtype = q.get("type", "choice")

    if qtype == "choice":
        check_str(q.get("question"), item, "question", qid)
        keys = check_options(q.get("options"), item, qid, 4, 2)
        if keys:
            check_answer(q.get("answer"), keys, item, qid)
        check_explanation(q.get("explanation"), item, qid)

    elif qtype == "dialogue-choice":
        dialogue = q.get("dialogue")
        if not isinstance(dialogue, list) or not dialogue:
            err(item, f"{qid}: dialogue 必须是非空数组")
        else:
            joined = ""
            for i, line in enumerate(dialogue):
                if not isinstance(line, dict) or not check_str(line.get("speaker"), item, f"dialogue[{i}].speaker", qid) \
                        or not check_str(line.get("text"), item, f"dialogue[{i}].text", qid):
                    return
                joined += line["text"]
            if not DIALOGUE_BLANK_RE.search(joined):
                err(item, f"{qid}: dialogue 台词中缺少 {{{{blank}}}} 待填标记")
        keys = check_options(q.get("options"), item, qid, 4, 2)
        if keys:
            check_answer(q.get("answer"), keys, item, qid)
        check_explanation(q.get("explanation"), item, qid)

    elif qtype == "gap-fill":
        markers = get_blank_labels(q.get("passage"), item, qid)
        if markers is None:
            return
        keys = check_options(q.get("options"), item, qid, None, 2)
        if DEFAULT_TEMPLATE and keys and len(keys) != 5:
            err(item, f"{qid}: 默认模板下五选五备选句必须是 5 个，得到 {len(keys)} 个")
        blanks = q.get("blanks")
        if not isinstance(blanks, list) or not blanks:
            err(item, f"{qid}: blanks 必须是非空数组")
            return
        check_blanks_match(blanks, markers, item, qid)
        for b in blanks:
            blabel = f"{qid}.blanks[{b.get('label')}]"
            if not isinstance(b, dict) or not check_str(b.get("label"), item, "blanks[].label", blabel):
                continue
            if keys:
                check_answer(b.get("answer"), keys, item, blabel)
            check_explanation(b.get("explanation"), item, blabel)
        if keys and len(keys) < len(blanks):
            err(item, f"{qid}: 备选句 {len(keys)} 个少于空位数 {len(blanks)}")

    elif qtype == "cloze":
        markers = get_blank_labels(q.get("passage"), item, qid)
        if markers is None:
            return
        blanks = q.get("blanks")
        if not isinstance(blanks, list) or not blanks:
            err(item, f"{qid}: blanks 必须是非空数组")
            return
        check_blanks_match(blanks, markers, item, qid)
        for b in blanks:
            blabel = f"{qid}.blanks[{b.get('label')}]"
            if not isinstance(b, dict) or not check_str(b.get("label"), item, "blanks[].label", blabel):
                continue
            bkeys = check_options(b.get("options"), item, blabel, 4, 2)
            if bkeys:
                check_answer(b.get("answer"), bkeys, item, blabel)
            check_explanation(b.get("explanation"), item, blabel)

    elif qtype == "grammar-fill":
        markers = get_blank_labels(q.get("passage"), item, qid)
        if markers is None:
            return
        blanks = q.get("blanks")
        if not isinstance(blanks, list) or not blanks:
            err(item, f"{qid}: blanks 必须是非空数组")
            return
        check_blanks_match(blanks, markers, item, qid)
        for b in blanks:
            blabel = f"{qid}.blanks[{b.get('label')}]"
            if not isinstance(b, dict):
                continue
            if not check_str(b.get("label"), item, "blanks[].label", blabel):
                continue
            if not check_str(b.get("answer"), item, "blanks[].answer", blabel):
                continue
            if b.get("hint") is not None and not isinstance(b.get("hint"), str):
                err(item, f"{blabel}: hint 必须是字符串")
            check_explanation(b.get("explanation"), item, blabel)

    elif qtype == "writing":
        check_str(q.get("prompt"), item, "prompt", qid)
        for field in ("greeting", "closing", "sample", "comment"):
            if q.get(field) is not None and not isinstance(q[field], str):
                err(item, f"{qid}: {field} 必须是字符串")
        points = q.get("points")
        if points is not None and (not isinstance(points, list) or not all(isinstance(p, str) and p.strip() for p in points)):
            err(item, f"{qid}: points 必须是非空字符串数组")
    else:
        err(item, f"{qid}: 未知题型 type={qtype!r}")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    as_json = "--json" in sys.argv
    if len(args) != 1:
        print(__doc__)
        return 2
    exam_dir = Path(args[0])
    if not exam_dir.is_dir():
        print(f"ERROR: 考试集目录不存在: {exam_dir}")
        return 2

    meta = load_json(exam_dir / "meta.json", "<exam>") if (exam_dir / "meta.json").is_file() else None
    if meta is None:
        warn("<exam>", "缺少 meta.json（可选，服务端会退回用目录名）")
    elif not isinstance(meta, dict):
        err("<exam>", "meta.json 必须是对象")
    else:
        if not (isinstance(meta.get("name"), str) and meta["name"].strip()):
            warn("<exam>", "meta.json 缺少 name（服务端会退回用目录名）")

    item_dirs = sorted(p for p in exam_dir.iterdir() if p.is_dir() and p.name.startswith("item-"))
    if not item_dirs:
        err("<exam>", "目录下没有任何 item-* 试题组目录")
    global DEFAULT_TEMPLATE
    DEFAULT_TEMPLATE = detect_default_template(item_dirs)

    for item_dir in item_dirs:
        item = item_dir.name
        if not NUM_RE.match(item_dir.name[5:]):
            warn(item, "目录名建议使用 item-<数字> 形式")
        for fname in REQUIRED_FILES:
            if not (item_dir / fname).is_file():
                err(item, f"缺少必需文件 {fname}（服务端会将其标记为无效试题组）")
        if not (item_dir / "questions.json").is_file():
            continue

        meta_i = load_json(item_dir / "meta.json", item)
        if isinstance(meta_i, dict):
            if not (isinstance(meta_i.get("name"), str) and meta_i["name"].strip()):
                warn(item, "meta.json 缺少 name")
            elif meta_i["name"].strip() not in ALLOWED_ITEM_NAMES:
                err(item, f"meta.json name 必须是 {'/'.join(sorted(ALLOWED_ITEM_NAMES))} 之一，得到 {meta_i['name']!r}（不能带篇目、副标题等附加文字）")
            st = meta_i.get("sectionType")
            if st is not None and st not in SECTION_TYPES:
                warn(item, f"未知 sectionType: {st!r}")
            spq, total = meta_i.get("scorePerQuestion"), meta_i.get("totalScore")
            if isinstance(spq, (int, float)) and isinstance(total, (int, float)) and spq > 0:
                if abs(spq * round(total / spq) - total) > 1e-9:
                    warn(item, f"totalScore={total} 不是 scorePerQuestion={spq} 的整数倍")

        questions = load_json(item_dir / "questions.json", item)
        if not isinstance(questions, list):
            err(item, "questions.json 顶层必须是数组")
            questions = []
        ids = [q.get("id") for q in questions if isinstance(q, dict) and q.get("id")]
        if len(ids) != len(set(ids)):
            warn(item, f"questions 内 id 重复: {ids}")
        if not questions:
            err(item, "questions.json 为空，没有任何题目")
        for idx, q in enumerate(questions, 1):
            check_question(q, item, q.get("id", f"#{idx}") if isinstance(q, dict) else f"#{idx}")

        ann = load_json(item_dir / "annotations.json", item)
        if isinstance(ann, dict):
            if not isinstance(ann.get("version"), int):
                warn(item, "annotations.json 缺少整数 version 字段")
            if not isinstance(ann.get("annotations"), list):
                warn(item, "annotations.json 缺少 annotations 数组")

    # 编号连续性：对含空位标记的题型汇总题号
    all_labels: list[str] = []
    label_owners: dict[str, list[str]] = {}
    for item_dir in item_dirs:
        qfile = item_dir / "questions.json"
        if not qfile.is_file():
            continue
        data = load_json(qfile, item_dir.name) or []
        for q in data if isinstance(data, list) else []:
            if isinstance(q, dict) and isinstance(q.get("passage"), str):
                for m in BLANK_RE.findall(q["passage"]):
                    all_labels.append(m)
                    label_owners.setdefault(m, []).append(item_dir.name)
    nums = [int(x) for x in all_labels if x.isdigit()]
    if nums and nums != sorted(nums):
        warn("<exam>", f"空位题号未按升序排列: {nums}")
    # 全卷题号唯一性：同一题号出现在多个试题组 → error（讲解视图题号会重复）
    for m, owners in sorted(label_owners.items(), key=lambda kv: kv[1]):
        if len(owners) > 1:
            err("<exam>", f"空位题号 {m} 同时被 {', '.join(owners)} 使用（全卷题号必须唯一）")

    if as_json:
        print(json.dumps({"errors": errors, "warnings": warnings}, ensure_ascii=False, indent=2))
    else:
        for e in errors:
            print(f"ERROR {e}")
        for w in warnings:
            print(f"WARN  {w}")
        print(f"{'PASS' if not errors else 'FAIL'}: {len(errors)} errors, {len(warnings)} warnings — {exam_dir}")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
