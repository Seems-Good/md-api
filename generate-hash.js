#!/usr/bin/env node

// Generate SHA-256 password hash for markdown editor
const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
  console.log('\nPassword Hash Generator\n');
  console.log('Usage: node generate-hash.js <password>\n');
  console.log('Example: node generate-hash.js mySecurePassword123\n');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(password).digest('hex');

console.log('\nPassword Hash Generated!\n');
console.log('Password:', password);
console.log('Hash:', hash);
console.log('\nAdd this to wrangler-simple.toml:\n');
console.log('MASTER_PASSWORD_HASH = "' + hash + '"\n');
