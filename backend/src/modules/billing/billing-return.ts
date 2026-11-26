export function invoiceReturnUrl(base: string, invoice: { number: string; organizationId: string }): string {
  const url = new URL(base);
  url.searchParams.set('invoice', invoice.number);
  url.searchParams.set('organization', invoice.organizationId);
  return url.toString();
}
