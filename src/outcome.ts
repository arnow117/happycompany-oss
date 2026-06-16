import Database from 'better-sqlite3';
import { logger } from './logger.js';

export interface OutcomeSignal {
  type: 'positive' | 'negative';
  keyword: string;
  context: string;
  confidence: number;
}

export interface OutcomeLogEntry {
  id: string;
  botName: string;
  chatId: string;
  userId?: string;
  sessionKey: string;
  signalType: 'feedback_button' | 'conversation_nlu' | 'followup_reply';
  feedback: 'positive' | 'negative' | 'none';
  dealRef?: string;
  dealRefType?: string;
  confidence: number;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outcome_log (
  id            TEXT PRIMARY KEY,
  bot_name      TEXT NOT NULL,
  chat_id       TEXT NOT NULL,
  user_id       TEXT,
  session_key   TEXT NOT NULL,
  signal_type   TEXT NOT NULL,
  feedback      TEXT NOT NULL,
  deal_ref      TEXT,
  deal_ref_type TEXT,
  confidence    REAL NOT NULL,
  created_at    INTEGER NOT NULL
)
`;

export class OutcomeTracker {
  private readonly db: Database.Database;
  private positiveSignals: string[] = [];
  private negativeSignals: string[] = [];

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  configureSignals(config: {
    positive?: string[];
    negative?: string[];
  }): void {
    this.positiveSignals = config.positive ?? [];
    this.negativeSignals = config.negative ?? [];
  }

  detectSignals(text: string): OutcomeSignal[] {
    const signals: OutcomeSignal[] = [];

    for (const keyword of this.positiveSignals) {
      if (text.includes(keyword)) {
        signals.push({
          type: 'positive',
          keyword,
          context: text.slice(Math.max(0, text.indexOf(keyword) - 20), text.indexOf(keyword) + keyword.length + 20),
          confidence: 0.8,
        });
      }
    }

    for (const keyword of this.negativeSignals) {
      if (text.includes(keyword)) {
        signals.push({
          type: 'negative',
          keyword,
          context: text.slice(Math.max(0, text.indexOf(keyword) - 20), text.indexOf(keyword) + keyword.length + 20),
          confidence: 0.8,
        });
      }
    }

    return signals;
  }

  logFromConversation(params: {
    botName: string;
    chatId: string;
    userId?: string;
    sessionKey: string;
    signal: OutcomeSignal;
  }): void {
    const id = `outcome_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      this.db.prepare(
        `INSERT INTO outcome_log
          (id, bot_name, chat_id, user_id, session_key, signal_type, feedback, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, 'conversation_nlu', ?, ?, ?)`,
      ).run(
        id,
        params.botName,
        params.chatId,
        params.userId ?? null,
        params.sessionKey,
        params.signal.type,
        params.signal.confidence,
        Date.now(),
      );
      logger.info(
        { id, type: params.signal.type, keyword: params.signal.keyword, bot: params.botName },
        'Outcome signal logged',
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to log outcome');
    }
  }

  logFeedback(params: {
    botName: string;
    chatId: string;
    userId?: string;
    sessionKey: string;
    feedback: 'positive' | 'negative';
  }): void {
    const id = `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      this.db.prepare(
        `INSERT INTO outcome_log
          (id, bot_name, chat_id, user_id, session_key, signal_type, feedback, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, 'feedback_button', ?, 1.0, ?)`,
      ).run(
        id,
        params.botName,
        params.chatId,
        params.userId ?? null,
        params.sessionKey,
        params.feedback,
        Date.now(),
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to log feedback');
    }
  }

  getRecentLogs(botName: string, limit = 20): OutcomeLogEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM outcome_log WHERE bot_name = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(botName, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      botName: row.bot_name as string,
      chatId: row.chat_id as string,
      userId: (row.user_id as string) ?? undefined,
      sessionKey: row.session_key as string,
      signalType: row.signal_type as OutcomeLogEntry['signalType'],
      feedback: row.feedback as OutcomeLogEntry['feedback'],
      dealRef: (row.deal_ref as string) ?? undefined,
      dealRefType: (row.deal_ref_type as string) ?? undefined,
      confidence: row.confidence as number,
      createdAt: row.created_at as number,
    }));
  }
}
