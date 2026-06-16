import { describe, it, expect } from 'vitest';
import { MessageBus } from '../src/bus.js';
import type { BusEvent } from '../src/bus.js';

describe('MessageBus', () => {
  it('delivers published events to subscriber', () => {
    const bus = new MessageBus();
    const received: BusEvent[] = [];

    bus.subscribe((ev) => received.push(ev));
    bus.publish({ type: 'message_received', text: 'hello' });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('message_received');
    expect(received[0].text).toBe('hello');
    expect(received[0].timestamp).toBeTypeOf('number');
  });

  it('enforces max buffer size', () => {
    const bus = new MessageBus(3);

    bus.publish({ type: 'bot_connected', botName: 'a' });
    bus.publish({ type: 'bot_connected', botName: 'b' });
    bus.publish({ type: 'bot_connected', botName: 'c' });
    expect(bus.size()).toBe(3);

    bus.publish({ type: 'bot_connected', botName: 'd' });
    expect(bus.size()).toBe(3);

    const snapshot = bus.snapshot();
    expect(snapshot.map((e) => e.botName)).toEqual(['b', 'c', 'd']);
  });

  it('stops delivering events after unsubscribe', () => {
    const bus = new MessageBus();
    const received: BusEvent[] = [];

    const unsub = bus.subscribe((ev) => received.push(ev));

    bus.publish({ type: 'agent_reply_sent', text: 'first' });
    expect(received).toHaveLength(1);

    unsub();
    bus.publish({ type: 'agent_reply_sent', text: 'second' });
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('first');
  });
});
