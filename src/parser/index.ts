import type { GameData } from "../types";
import { parseGamebookPages } from "./gamebook";
import { extractPdfPages } from "./pdf";

export async function parseGamebook(
  input: ArrayBuffer | Uint8Array,
  fileName = "gamebook.pdf",
  onProgress?: (current: number, total: number) => void,
): Promise<GameData> {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pages = await extractPdfPages(data, onProgress);
  return parseGamebookPages(pages, fileName);
}

export { extractPdfPages, parseGamebookPages };
