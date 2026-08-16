import {
  GlobalWorkerOptions,
  getDocument,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfLine, PositionedText, RawPage } from "../types";

GlobalWorkerOptions.workerSrc = "./pdf.worker.min.mjs";

function lineText(items: PositionedText[]) {
  return items
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupLines(page: number, items: PositionedText[]): PdfLine[] {
  const buckets: { y: number; items: PositionedText[] }[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    if (!item.text.trim()) continue;
    const bucket = buckets.find((candidate) => Math.abs(candidate.y - item.y) <= 0.75);
    if (bucket) bucket.items.push(item);
    else buckets.push({ y: item.y, items: [item] });
  }
  return buckets
    .sort((a, b) => b.y - a.y)
    .map(({ y, items: bucket }) => ({
      page,
      y: Math.round(y * 2) / 2,
      text: lineText(bucket),
      items: bucket.sort((a, b) => a.x - b.x),
    }));
}

export async function extractPdfPages(
  data: Uint8Array,
  onProgress?: (current: number, total: number) => void,
): Promise<RawPage[]> {
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages: RawPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => "str" in item ? [{
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
    }] : []);
    const lines = groupLines(pageNumber, items);
    pages.push({
      page: pageNumber,
      lines,
      text: lines.map((line) => line.text).join("\n"),
    });
    onProgress?.(pageNumber, pdf.numPages);
  }
  await loadingTask.destroy();
  return pages;
}
