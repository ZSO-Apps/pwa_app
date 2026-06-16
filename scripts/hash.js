// Usage: node scripts/hash.js <password>
import bcrypt from 'bcryptjs';
const pw = process.argv[2];
if (!pw) { console.error('Usage: node scripts/hash.js <password>'); process.exit(1); }
console.log(bcrypt.hashSync(pw, 10));
