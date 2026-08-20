import { describe, expect, it, vi } from "vitest";
import {
  CENTER_GAMEBOOK_ENDPOINT,
  MAX_PDF_BYTES,
  fetchRemoteGamebook,
  validateAndReadPdf,
} from "../src/remoteGamebook";

const gameId = "colts-at-patriots-2026-pre-1";
const pdfUrl = "https://static.www.nfl.com/image/upload/v1/gamecenter/example.pdf";
const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture");

function response(body: BodyInit | null, init: ResponseInit & { url?: string }) {
  const value = new Response(body, init);
  Object.defineProperty(value, "url", { value: init.url ?? "" });
  return value;
}

describe("remote Gamebook loading", () => {
  it("gets metadata and passes an in-memory PDF ArrayBuffer through validation", async () => {
    const stages: string[] = [];
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({ gameId, gamebookUrl: pdfUrl }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        url: `${CENTER_GAMEBOOK_ENDPOINT}?game=${gameId}`,
      }))
      .mockResolvedValueOnce(response(pdfBytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Length": String(pdfBytes.byteLength) },
        url: pdfUrl,
      }));

    const result = await fetchRemoteGamebook(gameId, { fetcher, onStage: (stage) => stages.push(stage) });
    expect(stages).toEqual(["metadata", "pdf"]);
    expect(result.fileName).toBe(`${gameId}.pdf`);
    expect(new Uint8Array(result.bytes)).toEqual(pdfBytes);
    expect(fetcher).toHaveBeenNthCalledWith(1, expect.any(URL), expect.objectContaining({ cache: "no-store" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, pdfUrl, expect.objectContaining({ cache: "no-store" }));
  });

  it("reports unavailable games without requesting a PDF", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(JSON.stringify({ message: "The Gamebook is not available yet." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(fetchRemoteGamebook(gameId, { fetcher })).rejects.toThrow("not available yet");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports Center network failures and NFL HTTP failures", async () => {
    const offlineCenter = vi.fn().mockRejectedValue(new TypeError("network error"));
    await expect(fetchRemoteGamebook(gameId, { fetcher: offlineCenter })).rejects.toThrow("Center could not be reached");

    const unavailablePdf = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({ gameId, gamebookUrl: pdfUrl }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(response(null, { status: 503, headers: { "Content-Type": "application/pdf" }, url: pdfUrl }));
    await expect(fetchRemoteGamebook(gameId, { fetcher: unavailablePdf })).rejects.toThrow("HTTP 503");
  });

  it("rejects non-PDF content, unsafe redirects, oversized files, and invalid magic bytes", async () => {
    await expect(validateAndReadPdf(response("html", { status: 200, headers: { "Content-Type": "text/html" }, url: pdfUrl }))).rejects.toThrow("not identified as a PDF");
    await expect(validateAndReadPdf(response(pdfBytes, { status: 200, headers: { "Content-Type": "application/pdf" }, url: "https://example.com/file.pdf" }))).rejects.toThrow("unapproved");
    await expect(validateAndReadPdf(response(pdfBytes, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Length": String(MAX_PDF_BYTES + 1) }, url: pdfUrl }))).rejects.toThrow("30 MB");
    await expect(validateAndReadPdf(response("not a pdf", { status: 200, headers: { "Content-Type": "application/pdf" }, url: pdfUrl }))).rejects.toThrow("valid PDF signature");
  });

  it("rejects invalid game IDs before making a request", async () => {
    const fetcher = vi.fn();
    await expect(fetchRemoteGamebook("../admin", { fetcher })).rejects.toThrow("invalid NFL game ID");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
