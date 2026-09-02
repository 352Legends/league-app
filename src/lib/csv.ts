export type CsvRow = Record<string, string>;

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function parseCsv(input: string): CsvRow[] {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const logicalLines: string[] = [];
  let buffer = "";
  let quoted = false;

  for (const physicalLine of normalized.split("\n")) {
    const candidate = buffer ? `${buffer}\n${physicalLine}` : physicalLine;
    let quoteCount = 0;
    for (let i = 0; i < physicalLine.length; i += 1) {
      if (physicalLine[i] === '"' && physicalLine[i + 1] === '"') {
        i += 1;
      } else if (physicalLine[i] === '"') {
        quoteCount += 1;
      }
    }
    if (quoteCount % 2 === 1) quoted = !quoted;
    if (quoted) {
      buffer = candidate;
    } else {
      logicalLines.push(candidate);
      buffer = "";
    }
  }
  if (buffer) logicalLines.push(buffer);
  if (!logicalLines.length) return [];

  const headers = parseLine(logicalLines[0]).map((value) => value.trim());
  return logicalLines.slice(1).filter(Boolean).map((line) => {
    const values = parseLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

export function csvNumber(row: CsvRow, key: string): number {
  const value = row[key];
  if (!value || value === "NA" || value === "NaN") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
