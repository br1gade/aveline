/**
 * A workbook, not a CSV file: Excel, Numbers and LibreOffice save theirs as zip archives, which the
 * import reads as one unreadable row (audit F-31). Known by name before anything is sent, and by
 * the archive's first two bytes, "PK", when it was given a .csv name anyway.
 */
const WORKBOOK_NAME = /\.(xlsx|xlsm|xls|ods|numbers)$/iu;
const ZIP_START = [0x50, 0x4b];

export function isWorkbookName(name: string): boolean {
  return WORKBOOK_NAME.test(name);
}

export async function isWorkbookFile(file: Blob): Promise<boolean> {
  const start = new Uint8Array(await file.slice(0, ZIP_START.length).arrayBuffer());
  return (
    start.length === ZIP_START.length && ZIP_START.every((byte, index) => start[index] === byte)
  );
}
