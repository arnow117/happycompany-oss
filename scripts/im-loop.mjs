#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import WebSocket from 'ws';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const url = args.get('url') ?? 'ws://127.0.0.1:3100/api/ws';
const botName = args.get('bot') ?? 'acme-dingtalk';
const chatId = args.get('chat') ?? `local-im:${Date.now()}`;
const userId = args.get('user') ?? 'local-im-user';
const timeoutMs = Number.parseInt(args.get('timeout') ?? '90000', 10);
const sequence = args.get('seq')?.split('|').map((s) => s.trim()).filter(Boolean) ?? [];

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), 10000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', reject);
  });
}

function waitForReply(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for reply after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      if (event.chatId !== chatId && event.type !== 'stream_error') return;

      if (event.type === 'stream_done') {
        cleanup();
        resolve(String(event.text ?? ''));
      } else if (event.type === 'stream_error') {
        cleanup();
        reject(new Error(String(event.error ?? 'stream_error')));
      }
    };

    function cleanup() {
      clearTimeout(timer);
      ws.off('message', onMessage);
    }

    ws.on('message', onMessage);
  });
}

async function send(ws, text) {
  ws.send(JSON.stringify({
    type: 'chat',
    workdirId: botName,
    botName,
    chatId,
    userId,
    text,
  }));
  return waitForReply(ws);
}

function printReply(text) {
  output.write(`\n< ${text.trim()}\n\n`);
}

const ws = new WebSocket(url);
await waitForOpen(ws);
output.write(`connected ${url}\nbot=${botName} chat=${chatId} user=${userId}\n`);

if (sequence.length > 0) {
  for (const text of sequence) {
    output.write(`\n> ${text}\n`);
    printReply(await send(ws, text));
  }
  ws.close();
} else {
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const text = (await rl.question('> ')).trim();
      if (!text || text === '/exit') break;
      printReply(await send(ws, text));
    }
  } finally {
    rl.close();
    ws.close();
  }
}
