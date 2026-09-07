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

/** 广播文件变化事件给已连接的客户端 */
const notifyChange = () => { for (const client of clients) client.write(`data: ${JSON.stringify({ type: 'files-changed' })}\n\n`); };

const safe = (value: string) => value.split('/').every((part) => part && part !== '..' && part !== '.');
const readJson = async (file: string, fallback: unknown) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } };

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

// ---- 考试集导入/导出 ----
/** 合法目录名：非空且不含路径分隔符 */
const validName = (value: string) => !!value && !/[/\\]/.test(value) && value !== '.' && value !== '..';

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
