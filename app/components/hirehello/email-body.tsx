import { formatEmailBody } from '@/lib/core/email-body';

export function EmailBody({ text, approvedHtml }: { text: string; approvedHtml?: string }) {
  // approvedHtml comes only from the server's formatter, never a user HTML field.
  return <div className="email-body" dangerouslySetInnerHTML={{ __html: approvedHtml ?? formatEmailBody(text) }} />;
}
