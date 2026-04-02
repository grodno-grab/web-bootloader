#!/usr/bin/env node
/**
 * Generate an ML-DSA-65 key pair.
 *
 * Usage:
 *   node scripts/keygen.mjs [name]
 *
 * Creates in .keys/:
 *   <name>.key  — private key, keep safe, NEVER commit (.keys/ is gitignored)
 *   <name>.pub  — public key, add to VITE_PUBLIC_KEYS in .env.local
 *
 * Default name: "signer"
 */

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const name = process.argv[2] || 'signer';

mkdirSync('.keys', { recursive: true });

const seed = randomBytes(32);
const { publicKey, secretKey } = ml_dsa65.keygen(seed);

const pubFile = `.keys/${name}.pub`;
const keyFile = `.keys/${name}.key`;

writeFileSync(pubFile, Buffer.from(publicKey).toString('base64'));
writeFileSync(keyFile, Buffer.from(secretKey).toString('base64'));

console.log(`Public key  → ${pubFile}`);
console.log(`Private key → ${keyFile}  ← keep safe, .keys/ is gitignored`);
console.log('');
console.log('Append to VITE_PUBLIC_KEYS in .env.local (use | as separator between keys):');
console.log(Buffer.from(publicKey).toString('base64'));
