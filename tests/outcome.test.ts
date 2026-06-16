import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { OutcomeTracker } from '../src/outcome.js';

describe('OutcomeTracker', () => {
  let db: Database.Database;
  let tracker: OutcomeTracker;

  beforeEach(() => {
    db = new Database(':memory:');
    tracker = new OutcomeTracker(db);
    tracker.configureSignals({
      positive: ['签了', '中了', '搞定了'],
      negative: ['丢了', '没中', '黄了'],
    });
  });

  it('detects positive signals in user message', () => {
    const signals = tracker.detectSignals('浙一那个 CT 的单子签了，600 万');
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('positive');
    expect(signals[0].keyword).toBe('签了');
  });

  it('detects negative signals', () => {
    const signals = tracker.detectSignals('那个项目黄了，没办法');
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('negative');
    expect(signals[0].keyword).toBe('黄了');
  });

  it('detects multiple signals', () => {
    const signals = tracker.detectSignals('这个中了但是另一个丢了');
    expect(signals).toHaveLength(2);
    expect(signals[0].type).toBe('positive');
    expect(signals[1].type).toBe('negative');
  });

  it('returns empty for no signals', () => {
    const signals = tracker.detectSignals('今天天气不错');
    expect(signals).toHaveLength(0);
  });

  it('logs conversation signal to database', () => {
    const signals = tracker.detectSignals('搞定了！');
    tracker.logFromConversation({
      botName: 'acme',
      chatId: 'chat1',
      userId: 'ou_123',
      sessionKey: 'ou_123:chat1',
      signal: signals[0],
    });

    const logs = tracker.getRecentLogs('acme');
    expect(logs).toHaveLength(1);
    expect(logs[0].feedback).toBe('positive');
    expect(logs[0].signalType).toBe('conversation_nlu');
    expect(logs[0].confidence).toBe(0.8);
  });

  it('logs feedback button click', () => {
    tracker.logFeedback({
      botName: 'acme',
      chatId: 'chat1',
      userId: 'ou_123',
      sessionKey: 'ou_123:chat1',
      feedback: 'negative',
    });

    const logs = tracker.getRecentLogs('acme');
    expect(logs).toHaveLength(1);
    expect(logs[0].signalType).toBe('feedback_button');
    expect(logs[0].confidence).toBe(1.0);
  });

  it('getRecentLogs respects limit', () => {
    for (let i = 0; i < 5; i++) {
      tracker.logFeedback({
        botName: 'acme',
        chatId: `chat${i}`,
        feedback: 'positive',
        sessionKey: `sk${i}`,
      });
    }
    expect(tracker.getRecentLogs('acme', 3)).toHaveLength(3);
  });
});
