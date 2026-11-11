/**
 * Checks a songsheet file before it's uploaded. Used in the browser (so a bad file isn't sent at all)
 * and again on the server.
 *
 * The size limit stays under Vercel's 4.5 MB request limit (the file travels inside a form, which
 * adds a little). Songsheets are usually well under 1 MB.
 */
export const MAX_SONGSHEET_BYTES = 4 * 1024 * 1024;

export function songsheetFileProblem(file: { name: string; size: number }): string | null {
  if (!/\.docx$/i.test(file.name)) {
    return "Only .docx songsheets are supported. Open it in Word and use Save As → Word Document (.docx).";
  }
  if (file.size > MAX_SONGSHEET_BYTES) return "This file is larger than 4 MB.";
  return null;
}
