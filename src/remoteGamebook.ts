export const CENTER_ORIGIN = "https://spoiler-free-nfl-gamebooks.dic19.chatgpt.site";
export const CENTER_GAMEBOOK_ENDPOINT = `${CENTER_ORIGIN}/api/companion/gamebook`;
export const NFL_GAMEBOOK_ORIGIN = "https://static.www.nfl.com";
export const MAX_PDF_BYTES = 30 * 1024 * 1024;

const NFL_GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RemoteLoadStage = "metadata" | "pdf";

interface GamebookMetadata {
  gameId: string;
  gamebookUrl: string;
}

interface FetchRemoteGamebookOptions {
  fetcher?: Fetcher;
  onStage?: (stage: RemoteLoadStage) => void;
}

export interface RemoteGamebook {
  bytes: ArrayBuffer;
  fileName: string;
}

function isValidGameId(value: string) {
  return value.length <= 120 && NFL_GAME_ID_PATTERN.test(value);
}

export function getApprovedNflPdfUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.origin !== NFL_GAMEBOOK_ORIGIN) return null;
    if (!url.pathname.toLowerCase().endsWith(".pdf")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: unknown };
    return typeof body.message === "string" && body.message ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function validateAndReadPdf(response: Response) {
  if (!response.ok) throw new Error(`NFL PDF request failed (HTTP ${response.status}).`);

  const finalUrl = getApprovedNflPdfUrl(response.url);
  if (!finalUrl) throw new Error("The NFL request ended at an unapproved or non-PDF URL.");

  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/pdf") throw new Error("The NFL response was not identified as a PDF.");

  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error("The NFL PDF is larger than the 30 MB safety limit.");
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("The NFL PDF response was empty.");
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("The NFL PDF is larger than the 30 MB safety limit.");
  const magic = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  if (magic.length !== 5 || String.fromCharCode(...magic) !== "%PDF-") {
    throw new Error("The NFL response did not contain a valid PDF signature.");
  }
  return bytes;
}

export async function fetchRemoteGamebook(gameId: string, options: FetchRemoteGamebookOptions = {}): Promise<RemoteGamebook> {
  if (!isValidGameId(gameId)) throw new Error("The link contains an invalid NFL game ID.");
  const fetcher = options.fetcher ?? fetch;
  const metadataUrl = new URL(CENTER_GAMEBOOK_ENDPOINT);
  metadataUrl.searchParams.set("game", gameId);

  options.onStage?.("metadata");
  let metadataResponse: Response;
  try {
    metadataResponse = await fetcher(metadataUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("NFL Gamebook Center could not be reached.");
  }
  if (!metadataResponse.ok) {
    const fallback = metadataResponse.status === 404
      ? "This game or its Gamebook is not available yet."
      : `NFL Gamebook Center returned HTTP ${metadataResponse.status}.`;
    throw new Error(await responseMessage(metadataResponse, fallback));
  }
  const metadataType = metadataResponse.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!metadataType.startsWith("application/json")) throw new Error("NFL Gamebook Center returned an invalid response.");

  let metadata: GamebookMetadata;
  try {
    metadata = await metadataResponse.json() as GamebookMetadata;
  } catch {
    throw new Error("NFL Gamebook Center returned unreadable metadata.");
  }
  if (metadata.gameId !== gameId) throw new Error("NFL Gamebook Center returned a different game ID.");
  const gamebookUrl = getApprovedNflPdfUrl(metadata.gamebookUrl);
  if (!gamebookUrl) throw new Error("NFL Gamebook Center returned an unapproved PDF URL.");

  options.onStage?.("pdf");
  let pdfResponse: Response;
  try {
    pdfResponse = await fetcher(gamebookUrl, {
      cache: "no-store",
      headers: { Accept: "application/pdf" },
    });
  } catch {
    throw new Error("The NFL Gamebook PDF could not be downloaded.");
  }

  return {
    bytes: await validateAndReadPdf(pdfResponse),
    fileName: `${gameId}.pdf`,
  };
}
