# HTTP 接口说明

供 AI Agent 或脚本调用。除特别说明外，请求与响应均为 JSON；变更类接口成功后会广播 `files-changed` 事件（见"事件"）。路径中的考试集/试题组 id 即数据目录名，不得含 `/`、`\` 等路径字符，否则返回 400。

错误统一为 `{ "error": "中文说明" }`，配合对应 HTTP 状态码（400 参数错误 / 404 不存在 / 409 冲突 / 500 服务端错误）。

Python 客户端：`skills/classbuddy-exam-creator/scripts/classbuddy_api.py`（覆盖下列全部接口，推荐通过它调用）。

## 查询

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/examinations` | 考试集列表，含每个试题组的 `valid` 与文件存在情况 |
| GET | `/api/examinations/:exam/full` | 考试集完整内容：元数据 + 全部试题组的 `meta` / `material` / `questions`（不含批注） |
| GET | `/api/items/:exam/:item` | 单个试题组：`meta` / `material` / `questions` / `annotations` |

## 考试集增删改

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/examinations` | `{ "id": "exam-id", "name": "中文名", "description": "..." }` | 创建考试集（`id` 即目录名，必填）；已存在返回 409 |
| PATCH | `/api/examinations/:exam` | `{ "name": "...", "description": "..." }` | 更新元数据，仅写入提供的字段 |
| DELETE | `/api/examinations/:exam` | — | 删除考试集及全部试题组，不可恢复 |

## 试题组增删改

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| PUT | `/api/items/:exam/:item` | `{ "meta": {...}, "material": "Markdown 文本", "questions": [...], "resetAnnotations": false }` | 创建或整体替换试题组；未提供的字段写默认值（`{}` / `""` / `[]`）。批注默认保留；`resetAnnotations: true` 时重置为空 |
| PATCH | `/api/items/:exam/:item` | 上三者中任意字段的子集（另可选 `"resetAnnotations": true`） | 局部更新，仅写入提供的字段；一个都不提供返回 400。material 变化且已有批注时响应带 `warning` 字段提示批注可能错位 |
| DELETE | `/api/items/:exam/:item` | — | 删除试题组 |

字段校验（服务端轻校验）：`meta` 必须是对象、`material` 必须是字符串、`questions` 必须是数组；题目结构深度校验由调用方用 `validate_exam.py` 完成后再上传。

## 导入/导出（zip）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/examinations/:exam/export` | 导出考试集为 zip 下载 |
| PUT | `/api/examinations/:exam` | 上传 zip 导入为考试集；已存在且未带 `?overwrite=1` 时返回 409 |

## 批注

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| PUT | `/api/items/:exam/:item/annotations` | `{ "annotations": [...] }`，保存批注 |

## 事件

`GET /api/events`（SSE）：数据目录变化时推送 `{ "type": "files-changed" }`，前端提示教师手动刷新。

## 鉴权与健康检查

- 服务端通过启动参数 `--auth user:pass` 或环境变量 `CLASSBUDDY_AUTH` 启用 Basic Auth；未配置则不鉴权。
- 启用鉴权后：**写操作**（POST / PUT / PATCH / DELETE）以及健康探针 `GET /api/health`、凭据自检 `GET /api/auth/check` 均需携带 `Authorization: Basic <base64("user:pass")>`，否则返回 401。
- 其余读取接口与静态资源始终开放（不校验鉴权）。
- 凭据错误统一返回 `401` + `{ "error": "..." }`，不返回 `WWW-Authenticate` 头以避免浏览器弹原生登录框。
- 客户端脚本自动带上凭据：命令行 `--auth`/`--user`/`--password` > 环境变量 `CLASSBUDDY_AUTH`（或 `CLASSBUDDY_USER`+`CLASSBUDDY_PASS`） > 配置文件 `~/.classbuddy/exam-creator.json`。`/api/health` 用于探活与连通检测。
