import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';

export function base64ToBytes(b64: string): Uint8Array {
  const std = b64.trim().replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(std), (c) => c.charCodeAt(0));
}

export function verifySignature(
  pubKeyB64: string,
  sigB64: string,
  message: Uint8Array,
): boolean {
  try {
    const pubKey = base64ToBytes(pubKeyB64);
    const sig = base64ToBytes(sigB64);
    return ml_dsa65.verify(pubKey, message, sig);
  } catch {
    return false;
  }
}
