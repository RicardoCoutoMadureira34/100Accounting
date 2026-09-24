export type FileFormat = "pdf" | "xlsx" | "csv";

export interface NamedBytes {
  name: string;
  bytes: Uint8Array;
}

// Formato pelo conteúdo (PDF, zip/OLE do Excel) e, se não chegar, pelo nome.
export function detectFormat(file: NamedBytes): FileFormat | null {
  const b = file.bytes;
  const name = file.name.toLowerCase();
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if ((b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b) || (b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)) {
    return "xlsx";
  }
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".csv") || name.endsWith(".txt")) return "csv";
  return null;
}
