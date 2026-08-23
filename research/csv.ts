import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

export function parseCsvRecord(record: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < record.length; index += 1) {
    const character = record[index];
    if (character === '"') {
      if (quoted && record[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function hasOpenQuote(record: string) {
  let quoted = false;
  for (let index = 0; index < record.length; index += 1) {
    if (record[index] !== '"') continue;
    if (quoted && record[index + 1] === '"') index += 1;
    else quoted = !quoted;
  }
  return quoted;
}

export async function* readCsv(path: string, gzip = false): AsyncGenerator<Record<string, string>> {
  const file = createReadStream(path);
  const input = gzip ? file.pipe(createGunzip()) : file;
  const lines = createInterface({ input, crlfDelay: Infinity });
  let headers: string[] | undefined;
  let pending = "";
  for await (const line of lines) {
    pending = pending ? `${pending}\n${line}` : line;
    if (hasOpenQuote(pending)) continue;
    const values = parseCsvRecord(pending);
    pending = "";
    if (!headers) {
      headers = values;
      continue;
    }
    yield Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  }
  if (pending) throw new Error(`Unterminated CSV record in ${path}.`);
}
