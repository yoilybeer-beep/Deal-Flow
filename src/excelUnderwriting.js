export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_BYTES = 512 * 1024;
export const WORKBOOK_FILENAME = "Development-Pro-Forma.xlsx";

export function isMasterDescriptor(row, owner) {
  return !!owner && row?.owner_id === owner && Number.isInteger(row.byte_count)
    && row.byte_count > 0 && row.byte_count <= MAX_BYTES;
}

export function workbookBytes(base64, size) {
  if (typeof base64 !== "string" || !Number.isInteger(size) || size < 4 || size > MAX_BYTES
    || base64.length !== 4 * Math.ceil(size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Invalid workbook payload");
  }
  const text = atob(base64);
  if (text.length !== size || !text.startsWith("PK\x03\x04")) throw new Error("Invalid workbook bytes");
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

export function downloadMasterCopy(base64, size) {
  downloadExcelBytes(workbookBytes(base64, size));
}

export function downloadExcelBytes(bytes) {
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = WORKBOOK_FILENAME;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
