import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
// 默认数据目录：~/.classbuddy/，可用 --data 覆盖
const dataDir = path.resolve(argValue('--data') || process.env.CLASSBUDDY_DATA || path.join(os.homedir(), '.classbuddy'));
const port = Number(argValue('--port') || 3000);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/zip', limit: '100mb' }));
await fs.mkdir(dataDir, { recursive: true });

// ---- 写操作 Basic Auth：--auth user:pass 或 CLASSBUDDY_AUTH 配置后启用；未配置则不鉴权，读取接口始终开放 ----
const authPair = argValue('--auth') || process.env.CLASSBUDDY_AUTH || '';
const authHash = authPair.includes(':') ? crypto.createHash('sha256').update(`Basic ${Buffer.from(authPair).toString('base64')}`).digest() : null;
if (!authHash && authPair) console.warn('CLASSBUDDY_AUTH/--auth 格式应为 user:pass，已忽略（鉴权未启用）');
/** 校验请求是否携带正确的 Basic 凭据；未启用鉴权时始终视为通过 */
const isAuthorized = (req: express.Request) => {
  if (!authHash) return true;
  const provided = crypto.createHash('sha256').update(String(req.headers.authorization || '')).digest();
  return crypto.timingSafeEqual(provided, authHash);
};
app.use((req, res, next) => {
  if (!authHash || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (isAuthorized(req)) return next();
  // 不返回 WWW-Authenticate 头，避免浏览器弹原生登录框；前端收到 401 会弹出应用内的鉴权表单
  res.status(401).json({ error: '需要鉴权：请在请求头中携带 Authorization: Basic <base64("user:pass")>' });
});

/** 凭据校验：供首页“鉴权设置”表单保存前验证用户名密码是否正确（GET 但需鉴权） */
app.get('/api/auth/check', (req, res) => {
  if (isAuthorized(req)) res.json({ ok: true });
  else res.status(401).json({ error: '用户名或密码错误' });
});

/** 广播文件变化事件给已连接的客户端 */
const notifyChange = () => { for (const client of clients) client.write(`data: ${JSON.stringify({ type: 'files-changed' })}\n\n`); };

const safe = (value: string) => value.split('/').every((part) => part && part !== '..' && part !== '.');
const readJson = async (file: string, fallback: unknown) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } };

/** 试题组当前批注数量（异常结构按 0 处理，仅用于覆盖 material 前的警告提示） */
const annotationCount = async (dir: string) => {
  const ann = await readJson(path.join(dir, 'annotations.json'), null as unknown);
  return Array.isArray((ann as any)?.annotations) ? (ann as any).annotations.length : 0;
};
/** material 变化会使文本偏移量类批注错位；返回给客户端的警告文案 */
const materialOffsetWarning = (count: number) =>
  count > 0 ? `material 已更新，但该试题组仍有 ${count} 条批注按原文偏移量保存，可能已错位；请在页面上检查，或用 resetAnnotations 重置批注` : undefined;

/** 健康探针：供脚本/部署探测服务是否存活 */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/examinations', async (_req, res) => {
  const exams: any[] = [];
  for (const examName of await fs.readdir(dataDir, { withFileTypes: true }).catch(() => [])) {
    if (!examName.isDirectory()) continue;
    const examPath = path.join(dataDir, examName.name);
    const meta = await readJson(path.join(examPath, 'meta.json'), { name: examName.name });
    const items: any[] = [];
    for (const entry of await fs.readdir(examPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('item-')) continue;
      const itemPath = path.join(examPath, entry.name);
      const files = await Promise.all(['meta.json', 'material.md', 'questions.json', 'annotations.json'].map(async (name) => [name, await fs.access(path.join(itemPath, name)).then(() => true).catch(() => false)] as const));
      items.push({ id: entry.name, name: (await readJson(path.join(itemPath, 'meta.json'), {})).name || entry.name, valid: files.every(([, exists]) => exists || false), files: Object.fromEntries(files) });
    }
    exams.push({ id: examName.name, name: meta.name || examName.name, items });
  }
  res.json(exams);
});

app.get('/api/items/:exam/:item', async (req, res) => {
  if (!safe(req.params.exam) || !safe(req.params.item)) return res.status(400).json({ error: 'invalid path' });
  const dir = path.join(dataDir, req.params.exam, req.params.item);
  try {
    const material = await fs.readFile(path.join(dir, 'material.md'), 'utf8');
    const meta = await readJson(path.join(dir, 'meta.json'), { name: req.params.item });
    const questions = await readJson(path.join(dir, 'questions.json'), []);
    const annotations = await readJson(path.join(dir, 'annotations.json'), { version: 1, annotations: [] });
    res.json({ meta, material, questions, annotations });
  } catch (error) { res.status(404).json({ error: '试题组文件缺失或无法读取' }); }
});

app.put('/api/items/:exam/:item/annotations', async (req, res) => {
  if (!safe(req.params.exam) || !safe(req.params.item) || !req.body?.annotations) return res.status(400).json({ error: 'invalid payload' });
  const dir = path.join(dataDir, req.params.exam, req.params.item);
  try { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'annotations.json'), JSON.stringify({ version: 1, annotations: req.body.annotations }, null, 2)); res.json({ ok: true }); }
  catch { res.status(500).json({ error: '批注保存失败' }); }
});

// ---- 考试集/试题组增删查改（供 AI Agent 通过 HTTP 调用）----
/** 合法目录名：非空且不含路径分隔符 */
const validName = (value: string) => !!value && !/[/\\]/.test(value) && value !== '.' && value !== '..';
const exists = (file: string) => fs.access(file).then(() => true).catch(() => false);
const EMPTY_ANNOTATIONS = { version: 1, annotations: [] as unknown[] };

/** 查看考试集完整内容：元数据 + 全部试题组的 meta/material/questions（不含批注） */
app.get('/api/examinations/:exam/full', async (req, res) => {
  if (!validName(req.params.exam)) return res.status(400).json({ error: 'invalid path' });
  const examDir = path.join(dataDir, req.params.exam);
  if (!(await exists(examDir))) return res.status(404).json({ error: '考试集不存在' });
  const meta = await readJson(path.join(examDir, 'meta.json'), { name: req.params.exam });
  const items: any[] = [];
  for (const entry of (await fs.readdir(examDir, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith('item-')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const dir = path.join(examDir, entry.name);
    items.push({
      id: entry.name,
      meta: await readJson(path.join(dir, 'meta.json'), {}),
      material: await fs.readFile(path.join(dir, 'material.md'), 'utf8').catch(() => null),
      questions: await readJson(path.join(dir, 'questions.json'), null),
    });
  }
  res.json({ id: req.params.exam, meta, items });
});

/** 新建考试集：body { id, name?, description? }，id 即目录名 */
app.post('/api/examinations', async (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  if (!validName(id)) return res.status(400).json({ error: '需要合法的考试集 id（同时作为目录名）' });
  if (await exists(path.join(dataDir, id))) return res.status(409).json({ error: `考试集“${id}”已存在，如需覆盖请先删除` });
  try {
    await fs.mkdir(path.join(dataDir, id), { recursive: true });
    await fs.writeFile(path.join(dataDir, id, 'meta.json'), JSON.stringify({ name: req.body?.name || id, description: req.body?.description || '' }, null, 2));
  } catch { return res.status(500).json({ error: '考试集创建失败' }); }
  notifyChange();
  res.status(201).json({ ok: true, exam: id });
});

/** 更新考试集元数据：body { name?, description? }，仅更新提供的字段 */
app.patch('/api/examinations/:exam', async (req, res) => {
  if (!validName(req.params.exam)) return res.status(400).json({ error: 'invalid path' });
  const examDir = path.join(dataDir, req.params.exam);
  if (!(await exists(examDir))) return res.status(404).json({ error: '考试集不存在' });
  const meta: any = await readJson(path.join(examDir, 'meta.json'), {});
  if (req.body?.name !== undefined) meta.name = req.body.name;
  if (req.body?.description !== undefined) meta.description = req.body.description;
  try { await fs.writeFile(path.join(examDir, 'meta.json'), JSON.stringify(meta, null, 2)); } catch { return res.status(500).json({ error: '考试集元数据保存失败' }); }
  notifyChange();
  res.json({ ok: true });
});

/** 删除考试集（连同全部试题组） */
app.delete('/api/examinations/:exam', async (req, res) => {
  if (!validName(req.params.exam)) return res.status(400).json({ error: 'invalid path' });
  const examDir = path.join(dataDir, req.params.exam);
  if (!(await exists(examDir))) return res.status(404).json({ error: '考试集不存在' });
  try { await fs.rm(examDir, { recursive: true, force: true }); } catch { return res.status(500).json({ error: '考试集删除失败' }); }
  notifyChange();
  res.json({ ok: true });
});

/** 试题组字段校验：meta 为对象、material 为字符串、questions 为数组；meta.name 必须是题型名 */
const ALLOWED_ITEM_NAMES = ['情景交际', '阅读理解', '五选五', '完形填空', '语法填空', '书面表达'];
const itemFieldErrors = (body: any) => {
  if (body.meta !== undefined && (typeof body.meta !== 'object' || body.meta === null || Array.isArray(body.meta))) return 'meta 必须是对象';
  if (body.material !== undefined && typeof body.material !== 'string') return 'material 必须是字符串（Markdown 文本）';
  if (body.questions !== undefined && !Array.isArray(body.questions)) return 'questions 必须是题目数组';
  if (body.meta?.name !== undefined && !ALLOWED_ITEM_NAMES.includes(body.meta.name))
    return `meta.name 必须是 ${ALLOWED_ITEM_NAMES.join('、')} 之一（不能带篇目、副标题等附加文字）`;
  if (body.resetAnnotations !== undefined && typeof body.resetAnnotations !== 'boolean') return 'resetAnnotations 必须是布尔值';
  return '';
};

/** 创建或整体替换试题组：body { meta?, material?, questions?, resetAnnotations? }；批注默认保留 */
app.put('/api/items/:exam/:item', async (req, res) => {
  const { exam, item } = req.params;
  if (!validName(exam) || !validName(item)) return res.status(400).json({ error: 'invalid path' });
  const error = itemFieldErrors(req.body || {});
  if (error) return res.status(400).json({ error });
  const examDir = path.join(dataDir, exam);
  if (!(await exists(examDir))) return res.status(404).json({ error: '考试集不存在，请先创建考试集' });
  const dir = path.join(examDir, item);
  const body = req.body || {};
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(body.meta ?? {}, null, 2));
    const materialChanged = body.material !== undefined && body.material !== (await fs.readFile(path.join(dir, 'material.md'), 'utf8').catch(() => ''));
    await fs.writeFile(path.join(dir, 'material.md'), body.material ?? '');
    await fs.writeFile(path.join(dir, 'questions.json'), JSON.stringify(body.questions ?? [], null, 2));
    if (body.resetAnnotations || !(await exists(path.join(dir, 'annotations.json')))) await fs.writeFile(path.join(dir, 'annotations.json'), JSON.stringify(EMPTY_ANNOTATIONS, null, 2));
    const warning = !body.resetAnnotations && materialChanged ? await materialOffsetWarning(await annotationCount(dir)) : undefined;
    notifyChange();
    res.json({ ok: true, item, ...(warning ? { warning } : {}) });
  } catch { return res.status(500).json({ error: '试题组保存失败' }); }
});

/** 局部更新试题组：body 中仅写入提供的 meta / material / questions 字段 */
app.patch('/api/items/:exam/:item', async (req, res) => {
  const { exam, item } = req.params;
  if (!validName(exam) || !validName(item)) return res.status(400).json({ error: 'invalid path' });
  const body = req.body || {};
  const error = itemFieldErrors(body);
  if (error) return res.status(400).json({ error });
  if (body.meta === undefined && body.material === undefined && body.questions === undefined) return res.status(400).json({ error: '请求体中未提供任何要更新的字段（meta / material / questions）' });
  const dir = path.join(dataDir, exam, item);
  if (!(await exists(dir))) return res.status(404).json({ error: '试题组不存在' });
  let warning: string | undefined;
  try {
    if (body.meta !== undefined) await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(body.meta, null, 2));
    if (body.material !== undefined) {
      const materialChanged = body.material !== (await fs.readFile(path.join(dir, 'material.md'), 'utf8').catch(() => ''));
      const count = await annotationCount(dir);
      if (body.resetAnnotations === true) {
        await fs.writeFile(path.join(dir, 'annotations.json'), JSON.stringify(EMPTY_ANNOTATIONS, null, 2));
      } else if (materialChanged) {
        warning = materialOffsetWarning(count);
      }
      await fs.writeFile(path.join(dir, 'material.md'), body.material);
    }
    if (body.questions !== undefined) await fs.writeFile(path.join(dir, 'questions.json'), JSON.stringify(body.questions, null, 2));
  } catch { return res.status(500).json({ error: '试题组保存失败' }); }
  notifyChange();
  res.json({ ok: true, ...(warning ? { warning } : {}) });
});

/** 删除试题组 */
app.delete('/api/items/:exam/:item', async (req, res) => {
  const { exam, item } = req.params;
  if (!validName(exam) || !validName(item)) return res.status(400).json({ error: 'invalid path' });
  const dir = path.join(dataDir, exam, item);
  if (!(await exists(dir))) return res.status(404).json({ error: '试题组不存在' });
  try { await fs.rm(dir, { recursive: true, force: true }); } catch { return res.status(500).json({ error: '试题组删除失败' }); }
  notifyChange();
  res.json({ ok: true });
});

// ---- 考试集导入/导出 ----

/** 导出考试集为 zip 下载 */
app.get('/api/examinations/:exam/export', async (req, res) => {
  if (!validName(req.params.exam)) return res.status(400).json({ error: 'invalid path' });
  const dir = path.join(dataDir, req.params.exam);
  try {
    await fs.access(dir);
  } catch { return res.status(404).json({ error: '考试集不存在' }); }
  const zip = new AdmZip();
  zip.addLocalFolder(dir, req.params.exam);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${encodeURIComponent(req.params.exam)}.zip"` });
  res.send(zip.toBuffer());
});

/** 导入考试集：请求体为 zip；目录名优先取压缩包内唯一顶层目录，否则用 URL 中的名称 */
app.put('/api/examinations/:exam', async (req, res) => {
  const name = req.params.exam;
  if (!validName(name)) return res.status(400).json({ error: 'invalid path' });
  const body = Buffer.isBuffer(req.body) ? req.body : null;
  if (!body?.length) return res.status(400).json({ error: '请上传 zip 压缩包' });
  let zip: AdmZip;
  try { zip = new AdmZip(body); } catch { return res.status(400).json({ error: '无法解析压缩包，请确认上传的是 zip 文件' }); }
  const entries = zip.getEntries();
  // 压缩包若含唯一顶层目录，则以该目录作为考试集目录名，并去掉该层前缀
  const topLevels = new Set(entries.filter((e) => !e.isDirectory).map((e) => e.entryName.split('/')[0]));
  const topLevel = topLevels.size === 1 ? [...topLevels][0] : '';
  const prefix = validName(topLevel) ? topLevel : name;
  const target = path.join(dataDir, prefix);
  const overwrite = req.query.overwrite === '1';
  if (!overwrite && (await fs.access(target).then(() => true).catch(() => false)))
    return res.status(409).json({ error: `考试集“${prefix}”已存在` });
  // 先校验全部条目路径（防止 zip 内路径逃逸数据目录），再覆盖写入
  const cleaned = entries
    .filter((e) => !e.isDirectory)
    .map((e) => ({ entry: e, relative: topLevel ? e.entryName.slice(prefix.length + 1) : e.entryName }))
    .filter(({ relative }) => relative.split('/').every((part) => part && part !== '..' && part !== '.'));
  if (!cleaned.length) return res.status(400).json({ error: '压缩包中没有有效文件' });
  try {
    await fs.rm(target, { recursive: true, force: true });
    for (const { entry, relative } of cleaned) {
      const file = path.join(target, relative);
      if (!file.startsWith(target + path.sep)) continue;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, entry.getData());
    }
  } catch { return res.status(500).json({ error: '导入失败，无法写入数据目录' }); }
  notifyChange();
  res.json({ ok: true, exam: prefix });
});

const clients = new Set<express.Response>();
app.get('/api/events', (req, res) => { res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders(); clients.add(res); req.on('close', () => clients.delete(res)); });
let watcher: ReturnType<typeof setInterval> | undefined;
let previousSignature = '';
watcher = setInterval(async () => { const signature = await fs.stat(dataDir).then((s) => `${s.mtimeMs}`).catch(() => ''); if (previousSignature && signature !== previousSignature) for (const client of clients) client.write(`data: ${JSON.stringify({ type: 'files-changed' })}\n\n`); previousSignature = signature; }, 1000);

if (process.env.NODE_ENV !== 'production') { const { createServer } = await import('vite'); const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
else app.use(express.static(path.join(root, 'dist')));
app.use((_req, res) => res.sendFile(path.join(root, 'index.html')));
app.listen(port, () => console.log(`英语试题讲解工具: http://localhost:${port}  数据目录: ${dataDir}`));
process.on('SIGINT', () => { if (watcher) clearInterval(watcher); process.exit(0); });
