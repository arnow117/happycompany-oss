export function optimizeMarkdownStyle(
  text: string,
  cardVersion = 2,
): string {
  try {
    let r = _optimizeMarkdownStyle(text, cardVersion);
    r = stripInvalidImageKeys(r);
    return r;
  } catch {
    return text;
  }
}

function _optimizeMarkdownStyle(text: string, cardVersion = 2): string {
  const MARK = '___CB_';
  const codeBlocks: string[] = [];
  let r = text.replace(/```[\s\S]*?```/g, (m) => {
    return `${MARK}${codeBlocks.push(m) - 1}___`;
  });

  const hasH1toH3 = /^#{1,3} /m.test(text);
  if (hasH1toH3) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1');
    r = r.replace(/^# (.+)$/gm, '#### $1');
  }

  if (cardVersion >= 2) {
    r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2');

    r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
    r = r.replace(
      /\n\n((?:\|.+\|[^\S\n]*\n?)+)/g,
      '\n\n<br>\n\n$1',
    );
    r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '$1\n<br>\n');
    r = r.replace(
      /^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)/gm,
      '$1\n$2\n$3',
    );
    r = r.replace(
      /^(\*\*.+)\n\n(<br>)\n\n(\|)/gm,
      '$1\n$2\n\n$3',
    );
    r = r.replace(
      /(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))/gm,
      '$1$2$3',
    );

    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, `\n<br>\n${block}\n<br>\n`);
    });
  } else {
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, block);
    });
  }

  r = r.replace(/\n{3,}/g, '\n\n');

  return r;
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

function stripInvalidImageKeys(text: string): string {
  if (!text.includes('![')) return text;
  return text.replace(IMAGE_RE, (fullMatch, _alt, value) => {
    if (value.startsWith('img_')) return fullMatch;
    return '';
  });
}
