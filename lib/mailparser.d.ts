// mailparser ships no types of its own and the community @types/mailparser
// package lags several major versions behind — this declares only the
// surface lib/bounce-checker.ts actually uses, kept intentionally narrow
// rather than trying to model the whole library.
declare module "mailparser" {
  export interface Attachment {
    contentType: string;
    content: Buffer;
    filename?: string;
  }

  export interface ParsedMail {
    subject?: string;
    text?: string;
    headers: Map<string, unknown>;
    attachments: Attachment[];
  }

  export function simpleParser(
    source: Buffer | string,
    options?: { keepDeliveryStatus?: boolean }
  ): Promise<ParsedMail>;
}
