import { randomBytes, scryptSync } from "node:crypto";

const salt = randomBytes(16);
console.log(`scrypt:${salt.toString("hex")}:${scryptSync(process.argv[2] ?? "", salt, 32).toString("hex")}`);
