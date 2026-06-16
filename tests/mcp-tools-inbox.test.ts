import { describe, it, expect } from 'vitest';
import { buildPlatformToolDefs } from '../src/mcp-tools.js';
import { MessageBus } from '../src/bus.js';
import { MemoryManager } from '../src/memory.js';

describe('Platform MCP inbox tools', () => {
  it('get_inbox tool drains inbox and returns events', async () => {
    const bus = new MessageBus();
    bus.subscribeToDomainEvent('contract.signed', 'test-bot');
    bus.publishDomainEvent('contract.signed', { contractId: '001' });
    bus.publishDomainEvent('contract.signed', { contractId: '002' });

    const ctx = {
      botName: 'test-bot',
      chatId: 'test-chat',
      memory: {} as MemoryManager,
      bus,
    };

    const tools = buildPlatformToolDefs(ctx);
    const getInbox = tools.find((t) => t.name === 'get_inbox');
    expect(getInbox).toBeDefined();

    const result = await getInbox!.handler({});
    expect(result).toBeDefined();
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(2);

    // After draining, inbox should be empty
    const listResult = await getInbox!.handler({});
    const listText = (listResult as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(JSON.parse(listText)).toHaveLength(0);
  });

  it('list_inbox tool previews inbox without draining', async () => {
    const bus = new MessageBus();
    bus.subscribeToDomainEvent('contract.signed', 'test-bot');
    bus.publishDomainEvent('contract.signed', { contractId: '001' });

    const ctx = {
      botName: 'test-bot',
      chatId: 'test-chat',
      memory: {} as MemoryManager,
      bus,
    };

    const tools = buildPlatformToolDefs(ctx);
    const listInbox = tools.find((t) => t.name === 'list_inbox');
    expect(listInbox).toBeDefined();

    // First call: should have 1 event
    const result1 = await listInbox!.handler({});
    const text1 = (result1 as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(JSON.parse(text1)).toHaveLength(1);

    // Second call: should still have 1 event (not drained)
    const result2 = await listInbox!.handler({});
    const text2 = (result2 as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(JSON.parse(text2)).toHaveLength(1);
  });

  it('get_inbox and list_inbox return empty when no bus available', async () => {
    const ctx = {
      botName: 'test-bot',
      chatId: 'test-chat',
      memory: {} as MemoryManager,
    };

    const tools = buildPlatformToolDefs(ctx);
    const getInbox = tools.find((t) => t.name === 'get_inbox');
    const listInbox = tools.find((t) => t.name === 'list_inbox');

    const getResult = await getInbox!.handler({});
    const getText = (getResult as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(getText).toContain('not available');

    const listResult = await listInbox!.handler({});
    const listText = (listResult as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(listText).toContain('not available');
  });
});
