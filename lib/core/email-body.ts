/** Shared, deterministic presentation for editor previews and outgoing mail.
 * Input is always text, never trusted HTML. No remote images or tracking markup.
 */
const bullet = /^(?:[•●▪◦]\s*|[-*]\s+)(.+)$/;
const numbered = /^(\d{1,3})[.)]\s+(.+)$/;
const standalone = /^(?:https?:\/\/|\S+@\S+\.\S+|(?:[\w ]{1,25}:\s*)?https?:\/\/|(?:best|regards|thanks|thank you|sincerely|cheers|kind regards|best regards)[,!]?\s*$|(?:hi|hello|dear)\s|[+☎📞📱])/i;

function isStructured(line: string): boolean {
  return bullet.test(line) || numbered.test(line) || standalone.test(line) || line.endsWith(':');
}

/** Remove common copy/paste wrapping; short lines and explicit (two-space) breaks stay. */
export function normalizeEmailText(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const previous = lines[i - 1]?.trim() || '';
    const canUnwrap = line && previous.length >= 55 && !/ {2}$/.test(lines[i - 1]) &&
      !previous.endsWith(':') && !standalone.test(previous) && !isStructured(line);
    if (canUnwrap) result[result.length - 1] += ` ${line}`;
    else result.push(line);
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#2563a6;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(label)}</a>`;
}

function inline(text: string): string {
  // A standalone labelled URL becomes a readable link; its destination is unchanged.
  const labelled = text.match(/^([\w][\w &/-]{0,30}):\s*(https?:\/\/[^\s<>"']+)$/i);
  if (labelled) return link(labelled[2], labelled[1]);
  const matcher = /https?:\/\/[^\s<>"']+/gi;
  let result = '', cursor = 0;
  for (const match of text.matchAll(matcher)) {
    let url = match[0];
    // Keep sentence punctuation and unmatched closing parentheses outside the URL.
    url = url.replace(/[.,!?;:]+$/, '');
    while (url.endsWith(')') && (url.match(/\)/g)?.length || 0) > (url.match(/\(/g)?.length || 0)) url = url.slice(0, -1);
    result += escapeHtml(text.slice(cursor, match.index));
    const label = url.replace(/^https?:\/\//i, '');
    result += link(url, label.length > 64 ? `${label.slice(0, 61)}…` : label);
    cursor = match.index! + url.length;
  }
  return result + escapeHtml(text.slice(cursor));
}

export function formatEmailBody(body: string): string {
  const lines = normalizeEmailText(body).split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listType = '';
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p style="margin:0 0 16px">${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(`<${listType} style="margin:0 0 16px;padding-left:24px;list-style-type:${listType === 'ol' ? 'decimal' : 'disc'}">${list.join('')}</${listType}>`);
    list = []; listType = '';
  };
  for (const line of lines) {
    if (!line) { flushParagraph(); flushList(); continue; }
    const item = line.match(bullet), number = line.match(numbered);
    if (item || number) {
      flushParagraph();
      const type = number ? 'ol' : 'ul';
      if (listType && type !== listType) flushList();
      listType = type;
      list.push(`<li${number ? ` value="${Number(number[1])}"` : ''} style="margin:0 0 6px;padding-left:2px">${inline(number ? number[2] : item![1])}</li>`);
    } else { flushList(); paragraph.push(line); }
  }
  flushParagraph(); flushList();
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#202124;background-color:#ffffff;text-align:left;overflow-wrap:anywhere;word-break:normal">${blocks.join('')}</div>`;
}

export function insertMergeField(body: string, field: string, start: number, end: number) {
  const token = `{{${field}}}`;
  return { text: body.slice(0, start) + token + body.slice(end), caret: start + token.length };
}
