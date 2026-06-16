import type { Hono } from 'hono';
import type { Config } from '../config.js';
import { DEFAULT_WEB_CHAT_CONFIG } from '../config.js';
import type { BotManager } from '../bot.js';
import type { MessageStore } from '../store.js';
import type { EmployeeManager } from '../orchestrator/employee-colony.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface PublicRoutesDeps {
  botManager: BotManager;
  store: MessageStore;
  dataDir: string;
  corpDir: string;
  configRef: { current: Config };
  employeeManager?: EmployeeManager;
}

function resolveTenant(pathStr: string): string | undefined {
  const match = pathStr.match(/(?:^|[\\/])corp[\\/](.+?)(?:[\\/]|$)/);
  return match?.[1];
}

function getTenants(corpDir: string): Array<{ id: string; displayName: string }> {
  const tenants: Array<{ id: string; displayName: string }> = [];
  if (!existsSync(corpDir)) return tenants;
  for (const entry of readdirSync(corpDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const appJson = join(corpDir, entry.name, 'app.json');
    if (!existsSync(appJson)) continue;
    try {
      const meta = JSON.parse(readFileSync(appJson, 'utf-8'));
      tenants.push({ id: entry.name, displayName: meta.displayName || entry.name });
    } catch { /* skip */ }
  }
  return tenants;
}

export function registerPublicRoutes(app: Hono, deps: PublicRoutesDeps): void {
  app.get('/api/web-chat/config', (c) => {
    return c.json({
      ...DEFAULT_WEB_CHAT_CONFIG,
      ...(deps.configRef.current.webChat ?? {}),
    });
  });

  app.get('/api/health', (c) => {
    const bots = deps.botManager.getBotInfos();
    const globalModel = deps.configRef.current.claude?.model;
    return c.json({
      status: 'ok',
      bots: bots.map((b) => ({
        ...b,
        model: b.model !== 'default' ? b.model : (globalModel || 'default'),
      })),
    });
  });

  app.get('/api/bots', (c) => c.json(deps.botManager.getBotInfos()));

  app.get('/api/workdirs', (c) => {
    const botInfos = deps.botManager.getBotInfos();
    const knownTenants = new Set(getTenants(deps.corpDir).map((tenant) => tenant.id));
    const workdirs = botInfos.map((b) => ({
      id: b.name,
      displayName: b.displayName,
      path: b.workdir,
      channels: [b.channel],
      status: b.status,
      tenant: b.tenant ?? resolveTenant(b.workdir) ?? (knownTenants.has(b.name) ? b.name : undefined),
    }));

    if (deps.employeeManager) {
      for (const ca of deps.employeeManager.getEmployees()) {
        const appId = ca.app.id;
        const alreadyListed = workdirs.some((w) => w.id === appId && w.tenant === ca.app.tenantName);
        if (!alreadyListed) {
          workdirs.push({
            id: appId,
            displayName: ca.app.displayName || appId,
            path: ca.app.workspace || `${deps.corpDir}/${ca.app.tenantName}/agents/${appId}`,
            channels: [ca.app.channel || 'web'],
            status: 'running',
            tenant: ca.app.tenantName,
          });
        }
      }
    }

    if (workdirs.length === 0) {
      workdirs.push({
        id: 'web',
        displayName: '默认工作区',
        path: `${deps.dataDir}/agents/web`,
        channels: ['web'],
        status: 'running',
        tenant: undefined,
      });
    }
    return c.json(workdirs);
  });

  app.get('/api/workdir/:id/sessions', (c) => {
    const id = c.req.param('id');
    try {
      const sessionKeys = deps.botManager.listSessions(id);
      const chats = deps.store.listChats(id);
      const chatMap = new Map(chats.map((ch) => [ch.chatId, ch]));
      const seenIds = new Set<string>();
      const sessions: Array<{ chatId: string; messageCount: number; lastMessageAt: number; preview: string }> = [];
      for (const chatId of sessionKeys) {
        seenIds.add(chatId);
        const summary = chatMap.get(chatId);
        const recentMessages = deps.store.listMessages(chatId, 3);
        sessions.push({
          chatId,
          messageCount: summary?.messageCount ?? 0,
          lastMessageAt: summary?.lastMessageAt ?? 0,
          preview: recentMessages.map((m) => m.text.slice(0, 100)).join(' | '),
        });
      }
      for (const chat of chats) {
        if (!seenIds.has(chat.chatId)) {
          const recentMessages = deps.store.listMessages(chat.chatId, 3);
          sessions.push({
            chatId: chat.chatId,
            messageCount: chat.messageCount,
            lastMessageAt: chat.lastMessageAt,
            preview: recentMessages.map((m) => m.text.slice(0, 100)).join(' | '),
          });
        }
      }
      sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      return c.json({ sessions });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.get('/api/chats', (c) => c.json(deps.store.listChats()));

  app.get('/api/chats/:chatId/messages', (c) =>
    c.json(deps.store.listMessages(c.req.param('chatId'))),
  );

  app.get('/api/chat/:botName/history', (c) => {
    const chatId = c.req.query('chatId') ?? '';
    const limit = parseInt(c.req.query('limit') ?? '50', 10) || 50;
    const after = c.req.query('after');
    const before = c.req.query('before');

    let messages;
    if (before && chatId) {
      messages = deps.store.getMessagesBefore(chatId, parseInt(before, 10), limit);
    } else if (after) {
      messages = deps.store.getMessagesAfter(chatId, parseInt(after, 10), limit);
    } else if (chatId) {
      messages = deps.store.getMessagesAfter(chatId, 0, limit);
    } else {
      messages = deps.store.getRecentMessages(limit);
    }

    return c.json({ data: messages });
  });

  app.get('/api/chats/:botName', (c) => {
    const chats = deps.store.listChats(c.req.param('botName'));
    return c.json({ data: chats });
  });
}
