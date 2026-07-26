#!/usr/bin/env node
/**
 * Fetch a page, sign it, and produce config.json for VITE_CONFIG_URL.
 *
 * Usage:
 *   node scripts/sign.mjs --url <url> [--file <path>] [--sha256 <hex>] [--keys <key1.key>[,<key2.key>...]]
 *   node scripts/sign.mjs --merge <a.json>[,<b.json>...] [--pubkeys "<k1>|<k2>"] [--file <path>]
 *
 * Arguments:
 *   --url      Immutable URL where the page is hosted (always signed as-is)
 *   --file     Sign this local file instead of downloading the page. Use it when the caller has
 *              already fetched and validated the bytes, so the verified bytes are the signed ones.
 *              In merge mode, verify against this file instead of downloading.
 *   --sha256   Expected SHA-256 of the page. Signing aborts on mismatch.
 *   --keys     Comma-separated list of private key files (default: all *.key in .keys/)
 *   --merge    Combine configs produced by separate signers into one, in the order listed.
 *   --pubkeys  Public keys separated by "|", exactly as in VITE_PUBLIC_KEYS. When given, the merged
 *              config is verified the way the bootloader verifies it, so a wrong signer order is
 *              caught here rather than by a page that refuses to load.
 *   --out      Output file (default: config.json)
 *
 * Output:
 *   config.json — publish this file to VITE_CONFIG_URL
 *
 * Examples:
 *   npm run sign -- --url https://ipfs.io/ipfs/Qm...
 *   npm run sign -- --url https://ipfs.io/ipfs/Qm... --keys .keys/alice.key,.keys/bob.key
 *   npm run sign -- --url https://host/page.html --file page.html --sha256 7c902acf...
 *   npm run sign -- --merge alice.json,bob.json --pubkeys "$VITE_PUBLIC_KEYS"
 */

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Parse arguments
const args = process.argv.slice(2);
let url = null;
let keyFiles = null;
let file = null;
let expectedSha = null;
let mergeFiles = null;
let pubKeys = null;
let outFile = 'config.json';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url')  url = args[++i];
  else if (args[i] === '--keys') keyFiles = args[++i].split(',').map(k => k.trim());
  else if (args[i] === '--file') file = args[++i];
  else if (args[i] === '--sha256') expectedSha = args[++i];
  else if (args[i] === '--merge') mergeFiles = args[++i].split(',').map(f => f.trim());
  else if (args[i] === '--pubkeys') pubKeys = args[++i].split('|').map(k => k.trim()).filter(Boolean);
  else if (args[i] === '--out') outFile = args[++i];
}

/** Read the page bytes the signatures apply to, normalised the way the bootloader normalises them. */
async function loadPage(pageUrl) {
  let raw;
  if (file) {
    console.log(`Reading ${file} …`);
    raw = readFileSync(file);
  } else {
    console.log(`Fetching ${pageUrl} …`);
    const response = await fetch(pageUrl);
    if (!response.ok) {
      console.error(`Fetch failed: HTTP ${response.status}`);
      process.exit(1);
    }
    raw = Buffer.from(await response.arrayBuffer());
  }
  return raw;
}

if (mergeFiles) {
  if (mergeFiles.length < 2) {
    console.error('--merge needs at least two config files');
    process.exit(1);
  }

  const configs = mergeFiles.map(f => ({ name: f, config: JSON.parse(readFileSync(f, 'utf8')) }));
  const [{ config: first }] = configs;

  for (const { name, config } of configs) {
    if (config.url !== first.url) {
      console.error(`Signers did not sign the same URL:\n  ${mergeFiles[0]}: ${first.url}\n  ${name}: ${config.url}`);
      process.exit(1);
    }
    if (config.contentSize !== first.contentSize) {
      console.error(`Signers did not sign the same content (contentSize ${first.contentSize} vs ${config.contentSize} in ${name})`);
      process.exit(1);
    }
    if (config.urlSignatures?.length !== 1 || config.contentSignatures?.length !== 1) {
      console.error(`${name} must hold exactly one signature per array — merge single-signer configs only`);
      process.exit(1);
    }
  }

  const merged = {
    url: first.url,
    contentSize: first.contentSize,
    urlSignatures: configs.map(c => c.config.urlSignatures[0]),
    contentSignatures: configs.map(c => c.config.contentSignatures[0]),
  };

  if (new Set(merged.contentSignatures).size !== merged.contentSignatures.length) {
    console.error('The same signature appears twice — the same key signed more than once');
    process.exit(1);
  }

  if (pubKeys) {
    if (pubKeys.length !== merged.urlSignatures.length) {
      console.error(`--pubkeys lists ${pubKeys.length} key(s) but ${merged.urlSignatures.length} config(s) were merged`);
      process.exit(1);
    }

    const raw = await loadPage(merged.url);
    const page = Buffer.from(raw.toString('utf8'), 'utf8');
    const verifyAt = (keyIndex, sigIndex) => {
      const key = Buffer.from(pubKeys[keyIndex], 'base64');
      return ml_dsa65.verify(key, Buffer.from(merged.url, 'utf8'), Buffer.from(merged.urlSignatures[sigIndex], 'base64'))
        && ml_dsa65.verify(key, page, Buffer.from(merged.contentSignatures[sigIndex], 'base64'));
    };

    const wrong = pubKeys.map((_, i) => i).filter(i => !verifyAt(i, i));
    if (wrong.length > 0) {
      // Every signature may still be valid — just listed against the wrong key. Say which order works.
      const order = pubKeys.map((_, keyIndex) =>
        merged.urlSignatures.findIndex((_, sigIndex) => verifyAt(keyIndex, sigIndex)));
      const hint = order.every(i => i >= 0) && new Set(order).size === order.length
        ? `\nSignatures do match a different order — list the configs as: ${order.map(i => mergeFiles[i]).join(',')}`
        : '\nSome signature does not match any configured key at all.';
      console.error(`Merged config fails verification for key(s) at position ${wrong.map(i => i + 1).join(', ')}.${hint}`);
      process.exit(1);
    }
    console.log(`Verified ${pubKeys.length} signature(s) against the configured key order`);
  }

  writeFileSync(outFile, JSON.stringify(merged, null, 2));
  console.log(`${outFile} written from ${mergeFiles.join(', ')} — publish it to VITE_CONFIG_URL`);
  process.exit(0);
}

if (!url) {
  console.error('Usage: node scripts/sign.mjs --url <url> [--keys <key1>[,<key2>...]]');
  process.exit(1);
}

// Discover keys from .keys/ if not specified
if (!keyFiles) {
  let files;
  try {
    files = readdirSync('.keys').filter(f => f.endsWith('.key'));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    console.error('No .key files found in .keys/ — run npm run keygen first, or pass --keys explicitly');
    process.exit(1);
  }
  keyFiles = files.sort().map(f => `.keys/${f}`);
  console.log(`Using keys: ${keyFiles.join(', ')}`);
}

const rawBytes = await loadPage(url);

if (expectedSha) {
  const actualSha = createHash('sha256').update(rawBytes).digest('hex');
  if (actualSha !== expectedSha.trim().toLowerCase()) {
    console.error(`SHA-256 mismatch — refusing to sign:\n  expected ${expectedSha.trim().toLowerCase()}\n  actual   ${actualSha}`);
    process.exit(1);
  }
  console.log(`SHA-256 verified: ${actualSha}`);
}

// Decode and re-encode so the signed bytes match what the bootloader verifies after TextDecoder
const htmlBytes = Buffer.from(rawBytes.toString('utf8'), 'utf8');
const urlBytes = Buffer.from(url, 'utf8');

// Sign with each key
const urlSignatures = [];
const contentSignatures = [];

for (const keyFile of keyFiles) {
  const secretKey = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
  urlSignatures.push(Buffer.from(ml_dsa65.sign(secretKey, urlBytes)).toString('base64'));
  contentSignatures.push(Buffer.from(ml_dsa65.sign(secretKey, htmlBytes)).toString('base64'));
  console.log(`Signed with ${keyFile}`);
}

// Write config
writeFileSync(outFile, JSON.stringify({ url, contentSize: htmlBytes.length, urlSignatures, contentSignatures }, null, 2));
console.log('');
console.log(`${outFile} written — publish it to VITE_CONFIG_URL`);
