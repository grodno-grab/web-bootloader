#!/usr/bin/env node
/**
 * Fetch a page, sign it, and produce config.json for VITE_CONFIG_URL.
 *
 * Usage:
 *   node scripts/sign.mjs --url <url> [--keys <key1.key>[,<key2.key>...]]
 *
 * Arguments:
 *   --url   Immutable URL where the page is hosted
 *   --keys  Comma-separated list of private key files (default: all *.key in .keys/)
 *
 * Output:
 *   config.json — publish this file to VITE_CONFIG_URL
 *
 * Examples:
 *   npm run sign -- --url https://ipfs.io/ipfs/Qm...
 *   npm run sign -- --url https://ipfs.io/ipfs/Qm... --keys .keys/alice.key,.keys/bob.key
 */

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

// Parse arguments
const args = process.argv.slice(2);
let url = null;
let keyFiles = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url')  url = args[++i];
  else if (args[i] === '--keys') keyFiles = args[++i].split(',').map(k => k.trim());
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

// Fetch page content
console.log(`Fetching ${url} …`);
const response = await fetch(url);
if (!response.ok) {
  console.error(`Fetch failed: HTTP ${response.status}`);
  process.exit(1);
}
const html = await response.text();
const htmlBytes = Buffer.from(html, 'utf8');
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
writeFileSync('config.json', JSON.stringify({ url, contentSize: htmlBytes.length, urlSignatures, contentSignatures }, null, 2));
console.log('');
console.log('config.json written — publish it to VITE_CONFIG_URL');
