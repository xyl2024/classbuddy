import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dataDir = path.resolve(args[args.indexOf('--data') + 1] || './data');
const port = Number(args[args.indexOf('--port') + 1] || 3000);
const app = express();
app.use(express.json({ limit: '10mb' }));

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
