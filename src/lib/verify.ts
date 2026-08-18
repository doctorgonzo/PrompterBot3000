/**
 * Discord signs every interaction request with Ed25519. If we don't verify it,
 * anyone who learns the endpoint URL can make the bot say anything — and Discord
 * actively probes the endpoint with bad signatures and disables it if we accept one.
 */

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

type ImportedKey = { key: CryptoKey; algorithm: string };

// Cached per isolate so we import the key once, not once per interaction.
let cached: ImportedKey | null = null;

async function importPublicKey(publicKey: string): Promise<ImportedKey> {
  if (cached) return cached;
  const raw = hexToBytes(publicKey);

  // Workers exposes the standard "Ed25519" name; older runtimes only had
  // "NODE-ED25519". Try the standard one, fall back so this can't break on a
  // compatibility-date change.
  try {
    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    cached = { key, algorithm: "Ed25519" };
  } catch {
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" } as unknown as Parameters<
        typeof crypto.subtle.importKey
      >[2],
      false,
      ["verify"],
    );
    cached = { key, algorithm: "NODE-ED25519" };
  }

  return cached;
}

/**
 * Verifies the signature over (timestamp + raw body). The body must be the exact
 * bytes Discord sent — re-serializing parsed JSON changes the signature.
 */
export async function verifyDiscordRequest(
  request: Request,
  rawBody: string,
  publicKey: string,
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return false;

  try {
    const { key, algorithm } = await importPublicKey(publicKey);
    return await crypto.subtle.verify(
      algorithm,
      key,
      hexToBytes(signature),
      encoder.encode(timestamp + rawBody),
    );
  } catch {
    return false;
  }
}
