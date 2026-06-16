#!/usr/bin/env node

const DEFAULTS = {
  baseUrl: process.env.HC_BASE_URL ?? 'http://127.0.0.1:3100',
  tenant: process.env.HC_TENANT ?? 'acme-happycompany',
  entryId: process.env.HC_ENTRY_ID ?? 'web-bot',
  actorId: process.env.HC_ACTOR_ID ?? '131537090028023523',
  employeeId: process.env.HC_EMPLOYEE_ID ?? 'sales-zhangsan',
  chatId: process.env.HC_CHAT_ID ?? `workflow-test-${Date.now()}`,
  timeoutMs: Number.parseInt(process.env.HC_TIMEOUT_MS ?? '120000', 10),
  text: process.env.HC_TEST_TEXT ?? [
    '测试协同流程：浙大一院的 GE Optima 540 CT 全保维保合同 HT-2026-0602 已经签署，',
    '合同金额 1710000，服务期 2026-06-01 到 2029-05-31，半年结算 285000，响应时间 2 小时，含零件。',
    '请销售张三按照合同签署后的流程，把结构化合同上下文 handoff 给维修李四安排现场执行。',
  ].join(''),
};

function readArgs(argv) {
  const args = { ...DEFAULTS, send: true };
  for (const item of argv) {
    if (item === '--no-send') {
      args.send = false;
      continue;
    }
    const match = item.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (key === 'timeoutMs') {
      args.timeoutMs = Number.parseInt(match[2], 10);
    } else if (key in args) {
      args[key] = match[2];
    }
  }
  return args;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${url} failed: ${response.status} ${text}`);
  }
  return body;
}

function sessionIdFor(args) {
  return [
    args.tenant,
    args.entryId,
    args.actorId,
    args.employeeId,
    args.chatId,
  ].join(':');
}

function chatUrl(args) {
  const params = new URLSearchParams({
    tenant: args.tenant,
    entry: args.entryId,
    actor: args.actorId,
    employee: args.employeeId,
    chat: args.chatId,
  });
  return `${args.baseUrl}/chat?${params.toString()}`;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const sessionId = sessionIdFor(args);

  if (args.send) {
    const result = await requestJson(`${args.baseUrl}/api/runtime/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant: args.tenant,
        entryId: args.entryId,
        actorId: args.actorId,
        chatId: args.chatId,
        target: { employeeId: args.employeeId },
        timeoutMs: args.timeoutMs,
        text: args.text,
      }),
    });
    const handoffs = result.trace?.handoffs ?? [];
    console.log(`reply: ${String(result.reply ?? '').slice(0, 240).replace(/\s+/g, ' ')}`);
    console.log(`trace handoffs: ${handoffs.length}`);
    for (const handoff of handoffs) {
      console.log(`- ${handoff.from} -> ${handoff.to}${handoff.reason ? ` (${handoff.reason})` : ''}`);
    }
  }

  const casesResult = await requestJson(
    `${args.baseUrl}/api/runtime/cases?tenant=${encodeURIComponent(args.tenant)}&limit=20`,
  );
  const matchingCase = casesResult.cases?.find((item) => item.sessionId === sessionId);
  if (!matchingCase) {
    throw new Error(`No workflow case found for session ${sessionId}`);
  }

  const timelineResult = await requestJson(
    `${args.baseUrl}/api/runtime/cases/${encodeURIComponent(sessionId)}/timeline`,
  );
  const handoffEvents = timelineResult.timeline?.filter((event) => event.type === 'handoff') ?? [];

  console.log(`case: ${matchingCase.sessionId}`);
  console.log(`participants: ${matchingCase.participants.join(', ')}`);
  console.log(`current employee: ${matchingCase.currentEmployeeId}`);
  console.log(`handoff events: ${handoffEvents.length}`);
  console.log(`chat url: ${chatUrl(args)}`);
  console.log(`${args.baseUrl}/orchestration`);

  if (handoffEvents.length === 0) {
    throw new Error('Expected at least one handoff event in workflow timeline');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
