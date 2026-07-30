export const DISPOSABLE_DOMAINS = new Set([
  "tempmail.com",
  "temp-mail.org",
  "guerrillamail.com",
  "guerrillamailblock.com",
  "mailinator.com",
  "10minutemail.com",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "sharklasers.com",
  "dispostable.com",
  "fakeinbox.com",
  "discard.email",
  "maildrop.cc",
  "mintemail.com",
  "moakt.com",
  "spamgourmet.com",
  "mailnesia.com",
  "tempinbox.com",
  "disposable.com",
  "emailondeck.com",
  "spam4.me",
  "grr.la",
]);

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}
