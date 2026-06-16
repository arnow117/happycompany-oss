import { optimizeMarkdownStyle } from '../feishu-markdown-style.js';
import type { AgentCardInput, CardMeta, FeishuCardV2 } from './types.js';
import {
  buildHeader,
  buildMetaRow,
  buildBodyChunks,
  buildThinkingPanel,
  buildToolsPanel,
  buildFooter,
  buildStreamingPanels,
  buildStatusBannerText,
  extractTitle,
  stripTitleFromBody,
  CARD_ELEMENT_IDS,
  type StreamingPanelsInit,
} from './sections.js';

const STREAMING_CONFIG = {
  print_frequency_ms: { default: 30, android: 25, ios: 40, pc: 50 },
  print_step: { default: 2, android: 3, ios: 4, pc: 5 },
  print_strategy: 'fast' as const,
};

export function buildAgentReplyCard(input: AgentCardInput): FeishuCardV2 {
  const optimizedText = optimizeMarkdownStyle(input.text, 2);
  const optimizedThinking = input.thinking
    ? optimizeMarkdownStyle(input.thinking, 2)
    : undefined;

  const { title: autoTitle, bodyStartIndex } = extractTitle(optimizedText);
  const displayTitle = input.title ?? autoTitle;
  const body = stripTitleFromBody(optimizedText, bodyStartIndex);

  const normalizedInput: AgentCardInput = {
    ...input,
    text: optimizedText,
    thinking: optimizedThinking,
  };

  const header = buildHeader(normalizedInput);
  const elements: Array<Record<string, unknown>> = [];
  if (body) {
    elements.push(...buildBodyChunks(body));
  }

  const metaRow = buildMetaRow(input.meta);
  const thinkingPanel = buildThinkingPanel(optimizedThinking);
  const toolsPanel = buildToolsPanel(input.meta?.toolCalls);
  const footer = buildFooter(input.footer, input.completedAtMs);

  const hasFooterArea =
    metaRow.length + thinkingPanel.length + toolsPanel.length + footer.length >
    0;
  if (hasFooterArea) {
    elements.push({ tag: 'hr' });
  }

  elements.push(...metaRow);
  elements.push(...thinkingPanel);
  elements.push(...toolsPanel);
  elements.push(...footer);

  return {
    schema: '2.0',
    config: {
      update_multi: true,
      enable_forward: true,
      width_mode: 'fill',
      summary: { content: displayTitle },
    },
    header,
    body: {
      direction: 'vertical',
      vertical_spacing: 'medium',
      elements,
    },
  };
}

export interface StreamingCardBuildOptions {
  initialText?: string;
  title?: string;
  titlePrefix?: string;
  subtitle?: string;
  meta?: Pick<CardMeta, 'model'>;
  panels?: StreamingPanelsInit;
  rich?: boolean;
}

export function buildStreamingAgentCard(
  opts: StreamingCardBuildOptions = {},
): FeishuCardV2 {
  const initialText = opts.initialText ?? '';
  const { title: autoTitle } = extractTitle(initialText);
  const displayTitle = opts.title ?? autoTitle ?? '...';
  const useRich = opts.rich !== false;

  const header = buildHeader({
    text: initialText,
    status: 'running',
    title: opts.title,
    titlePrefix: opts.titlePrefix,
    subtitle: opts.subtitle,
    meta: opts.meta ? { model: opts.meta.model } : undefined,
  });

  const mainContentEl = {
    tag: 'markdown',
    content: initialText || '...',
    element_id: CARD_ELEMENT_IDS.MAIN_CONTENT,
  };
  const interruptBtn = {
    tag: 'button',
    text: { tag: 'plain_text', content: '⏹ 中断回复' },
    type: 'danger',
    value: { action: 'interrupt_stream' },
    element_id: CARD_ELEMENT_IDS.INTERRUPT_BTN,
  };
  const footerNote = {
    tag: 'markdown',
    content: `<font color='grey'>${buildStatusBannerText({ phase: 'streaming' })}</font>`,
    element_id: CARD_ELEMENT_IDS.FOOTER_NOTE,
    text_size: 'notation',
  };

  const baseConfig = {
    update_multi: true,
    enable_forward: true,
    width_mode: 'fill',
    summary: { content: displayTitle },
    streaming_mode: true,
    streaming_config: STREAMING_CONFIG,
  };

  if (!useRich) {
    return {
      schema: '2.0',
      config: baseConfig,
      header,
      body: {
        direction: 'vertical',
        vertical_spacing: 'medium',
        elements: [
          {
            tag: 'markdown',
            content: '',
            element_id: CARD_ELEMENT_IDS.AUX_BEFORE,
            text_size: 'notation',
          },
          mainContentEl,
          {
            tag: 'markdown',
            content: '',
            element_id: CARD_ELEMENT_IDS.AUX_AFTER,
            text_size: 'notation',
          },
          interruptBtn,
          {
            tag: 'markdown',
            content: '⏳ 生成中...',
            element_id: CARD_ELEMENT_IDS.STATUS_NOTE,
            text_size: 'notation',
          },
        ],
      },
    };
  }

  const panelsInit: StreamingPanelsInit = {
    expandThinking: true,
    expandTools: false,
    expandProgress: false,
    ...(opts.panels ?? {}),
  };

  return {
    schema: '2.0',
    config: baseConfig,
    header,
    body: {
      direction: 'vertical',
      vertical_spacing: 'medium',
      elements: [
        ...buildStreamingPanels(panelsInit),
        mainContentEl,
        interruptBtn,
        footerNote,
      ],
    },
  };
}
