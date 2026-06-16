import http from 'node:http';

const MOCK_BOTS = [
  { name: 'acme', displayName: '示例医疗助手', status: 'running', channel: 'dingtalk', workdir: '/home/acme', model: 'claude-sonnet-4-20250514' },
];
const MOCK_APPS = [
  { name: 'kb-management', currentVersion: 'v1.0', versions: [{ version: 'v1.0', publishedAt: '2026-05-03T10:00:00Z' }], description: '知识库管理 — 文档入库与检索' },
  { name: 'python-example', currentVersion: 'v1.0', versions: [{ version: 'v1.0', publishedAt: '2026-05-03T10:30:00Z' }], description: 'Python 示例 App' },
  { name: 'test-app', currentVersion: 'v1.0', versions: [{ version: 'v1.0', publishedAt: '2026-05-02T12:00:00Z' }], description: '测试用 App' },
  { name: 'hospital-crm', currentVersion: 'v1.0', versions: [{ version: 'v1.0', publishedAt: '2026-05-03T14:00:00Z' }], description: '医疗器械报修流程管理' },
];

const MOCK_SKILLS = [
  { id: 'kb-manage', name: 'Knowledge Manager', description: 'Manage knowledge base operations', source: 'local', enabled: true, userInvocable: true, allowedTools: ['Read', 'Write', 'Bash', 'Glob'], argumentHint: '<operation> <query>', updatedAt: '2026-05-03T10:00:00Z', files: [] },
];

const MOCK_CHATS = [
  { id: 'oc_xxx', lastMessageAt: Date.now(), messageCount: 15 },
  { id: 'oc_yyy', lastMessageAt: Date.now() - 86400000, messageCount: 42 },
];

const MOCK_INSIGHTS = [
  { id: 'ins-1', type: 'improve', status: 'pending', summary: '建议优化器械报修 skill 的提示词，减少理解偏差', details: '根据最近 7 天的使用数据，hospital-crm skill 的理解偏差率约 15%，建议优化 SKILL.md 中的示例部分。', createdAt: '2026-05-03T08:00:00Z' },
  { id: 'ins-2', type: 'create', status: 'approved', summary: '新增竞品价格监控 App', details: '自动追踪竞争对手报价变化，支持阈值告警。', createdAt: '2026-05-02T14:00:00Z' },
];

const MOCK_SKILL_STATS = [
  { skillName: 'kb-manage', callCount: 128, successCount: 119, failureCount: 9, avgDurationMs: 342, lastCalledAt: Date.now() },
  { skillName: 'hospital-crm', callCount: 45, successCount: 42, failureCount: 3, avgDurationMs: 891, lastCalledAt: Date.now() - 3600000 },
  { skillName: 'python-example', callCount: 12, successCount: 12, failureCount: 0, avgDurationMs: 156, lastCalledAt: Date.now() - 86400000 },
];

const MOCK_FILE_CONTENTS = {
  'README.md': '# kb-management\n\n知识库管理 App，支持文档入库和检索。',
  'CLAUDE.md': '# CLAUDE.md\n\nThis app manages knowledge base operations.',
  'SKILL.md': '---\nname: kb-manage\ndescription: Manage knowledge base operations\n---\n\n# Knowledge Manager\n\nManage and query the knowledge base.',
};

const SCAFFOLD_TYPES = [
  { type: 'tool', label: 'Tool', description: 'CLI tool with bin/run entry point' },
  { type: 'kb', label: 'Knowledge Base', description: 'Knowledge base app with data/ directory' },
  { type: 'custom', label: 'Custom', description: 'Minimal app skeleton' },
];

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:3100`);
  const path = url.pathname;

  // Health
  if (path === '/api/health') return json(res, { status: 'ok', bots: MOCK_BOTS });

  // Bots
  if (path === '/api/bots') return json(res, MOCK_BOTS);

  // Chats
  if (path === '/api/chats') return json(res, MOCK_CHATS);

  // Apps list
  if (path === '/api/admin/apps') return json(res, MOCK_APPS);

  // App publish (POST)
  if (path === '/api/admin/apps/publish' && req.method === 'POST') {
    return json(res, { name: 'mock-app', currentVersion: 'v1.0', description: 'Mock published app', versions: [{ version: 'v1.0', publishedAt: new Date().toISOString() }] });
  }

  // App rollback (POST)
  if (path === '/api/admin/apps/rollback' && req.method === 'POST') {
    return json(res, MOCK_APPS[0]);
  }

  // App install (POST)
  if (path === '/api/admin/apps/install' && req.method === 'POST') {
    return json(res, { installed: true });
  }

  // Clear messages (POST)
  if (path === '/api/admin/clear-messages' && req.method === 'POST') {
    return json(res, { cleared: 57 });
  }

  // App detail
  const appMatch = path.match(/^\/api\/admin\/apps\/([\w-]+)$/);
  if (appMatch) {
    const app = MOCK_APPS.find(a => a.name === appMatch[1]);
    if (app) return json(res, app);
    return json(res, { error: 'App not found' }, 404);
  }

  // App consistency
  if (path.match(/^\/api\/admin\/apps\/[\w-]+\/consistency$/)) {
    return json(res, []);
  }

  // Skills
  if (path === '/api/admin/skills') return json(res, MOCK_SKILLS);

  // Analytics usage
  if (path === '/api/admin/analytics/usage') {
    return json(res, {
      period: '7d',
      totalMessages: 312,
      dailyAvg: 44,
      activeChats: 18,
      topBots: { acme: 280, _unknown: 32 },
    });
  }

  // Skill stats
  if (path === '/api/admin/analytics/skills') {
    return json(res, MOCK_SKILL_STATS);
  }

  // Insights list
  if (path === '/api/admin/insights') return json(res, MOCK_INSIGHTS);

  // Insights generate (POST)
  if (path === '/api/admin/insights/generate' && req.method === 'POST') {
    const newInsight = {
      id: 'ins-' + Date.now(),
      type: 'improve',
      status: 'pending',
      summary: 'E2E generated insight: 考虑为高频查询添加缓存机制',
      details: '分析发现 kb-manage skill 的平均响应时间偏高，建议对热门查询添加缓存。',
      createdAt: new Date().toISOString(),
    };
    MOCK_INSIGHTS.unshift(newInsight);
    return json(res, MOCK_INSIGHTS);
  }

  // Insight status update (PUT)
  const insightMatch = path.match(/^\/api\/admin\/insights\/([\w-]+)\/status$/);
  if (insightMatch && req.method === 'PUT') {
    const id = insightMatch[1];
    const insight = MOCK_INSIGHTS.find(i => i.id === id);
    if (insight) {
      body(req).then(b => { insight.status = b.status; });
      return json(res, { id, status: 'updated' });
    }
    return json(res, { error: 'Insight not found' }, 404);
  }

  // App files list
  if (req.method === 'GET' && path.match(/^\/api\/admin\/apps\/[\w-]+\/files$/)) {
    return json(res, { files: [
      { name: 'README.md', type: 'file' },
      { name: 'CLAUDE.md', type: 'file' },
      { name: 'SKILL.md', type: 'file' },
      { name: 'src', type: 'directory' },
    ] });
  }

  // App file read (GET single file)
  const fileReadMatch = path.match(/^\/api\/admin\/apps\/[\w-]+\/files\/(.+)$/);
  if (fileReadMatch && req.method === 'GET') {
    const fileName = decodeURIComponent(fileReadMatch[1]);
    const content = MOCK_FILE_CONTENTS[fileName] || `// Mock content for ${fileName}`;
    return json(res, { type: 'file', content });
  }

  // App readme
  if (path.match(/^\/api\/admin\/apps\/[\w-]+\/readme$/)) {
    const appName = path.split('/')[4];
    const readmeContent = {
      'kb-management': '# kb-management\n\n知识库管理 App，支持文档入库和检索。',
      'python-example': '# python-example\n\nPython 示例 App，演示多语言 App 支持。',
      'test-app': '# test-app\n\n测试用途 App。',
      'hospital-crm': '# hospital-crm\n\n医疗器械报修流程管理 App。支持工单创建、状态追踪、维修分配和统计报表。',
    };
    return json(res, { content: readmeContent[appName] || '# Unknown App' });
  }

  // App file write (PUT)
  if (req.method === 'PUT' && path.match(/^\/api\/admin\/apps\/[\w-]+\/files\/.+$/)) {
    return json(res, { success: true, path: 'mock-write' });
  }

  // App file delete (DELETE)
  if (req.method === 'DELETE' && path.match(/^\/api\/admin\/apps\/[\w-]+\/files\/.+$/)) {
    return json(res, { success: true, path: 'mock-delete' });
  }

  // App run (POST)
  if (req.method === 'POST' && path.match(/^\/api\/admin\/apps\/[\w-]+\/run$/)) {
    return json(res, { output: 'Mock CLI output\nEverything OK.', exitCode: 0, durationMs: 42 });
  }

  // App versions
  if (path.match(/^\/api\/admin\/apps\/[\w-]+\/versions$/)) {
    const appName = path.split('/')[4];
    const app = MOCK_APPS.find(a => a.name === appName);
    return json(res, app?.versions || []);
  }

  // Build check
  if (path === '/api/admin/build/check') {
    return json(res, { available: false, pythonBin: '', error: 'Python not found' });
  }

  // Build status
  const buildMatch = path.match(/^\/api\/admin\/build\/([\w-]+)\/status$/);
  if (buildMatch) {
    return json(res, { sessionId: buildMatch[1], status: 'idle', output: [], startedAt: Date.now() });
  }

  // Build publish
  const buildPubMatch = path.match(/^\/api\/admin\/build\/([\w-]+)\/publish$/);
  if (buildPubMatch && req.method === 'POST') {
    return json(res, MOCK_APPS[0]);
  }

  // Scaffold types
  if (path === '/api/admin/scaffold/types') {
    return json(res, SCAFFOLD_TYPES);
  }

  // Scaffold create (POST)
  if (path === '/api/admin/scaffold' && req.method === 'POST') {
    return json(res, { dir: '/tmp/mock-scaffold', files: ['SKILL.md', 'CLAUDE.md', 'README.md', 'bin/run'] });
  }

  // Workdirs listing
  if (path === '/api/admin/workdirs') {
    return json(res, [
      {
        path: '/home/acme',
        info: { path: '/home/acme', apps: [
          { name: 'kb-management', version: 'v1.0', installedAt: '2026-05-03T10:00:00Z' },
          { name: 'hospital-crm', version: 'v1.0', installedAt: '2026-05-03T14:00:00Z' },
        ] },
        bots: [MOCK_BOTS[0]],
      },
    ]);
  }

  // Bot clear sessions (POST)
  const botClearMatch = path.match(/^\/api\/admin\/bots\/([\w-]+)\/clear-sessions$/);
  if (botClearMatch && req.method === 'POST') {
    return json(res, { name: botClearMatch[1], cleared: 3 });
  }

  // Workdir app version update (PUT)
  const wdVersionMatch = path.match(/^\/api\/admin\/workdir\/(.+)\/apps\/([\w-]+)\/version$/);
  if (wdVersionMatch && req.method === 'PUT') {
    return json(res, { name: wdVersionMatch[2], version: 'v2.0', installedAt: new Date().toISOString() });
  }

  // Workdir load (GET single workdir)
  const wdLoadMatch = path.match(/^\/api\/admin\/workdir\/(.+)$/);
  if (wdLoadMatch && req.method === 'GET') {
    return json(res, { path: wdLoadMatch[1], apps: [
      { name: 'kb-management', version: 'v1.0', installedAt: '2026-05-03T10:00:00Z' },
      { name: 'hospital-crm', version: 'v1.0', installedAt: '2026-05-03T14:00:00Z' },
    ] });
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(3100, () => console.log('Mock API server on :3100'));
