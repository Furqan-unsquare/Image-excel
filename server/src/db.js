import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './config.js';

const RESOLVER_ERRORS = new Set(['ECONNREFUSED', 'ETIMEOUT', 'ESERVFAIL', 'ECONNRESET', 'EREFUSED', 'ETIMEDOUT']);

function srvHost(uri) {
  const m = /^mongodb\+srv:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(uri || '');
  return m ? m[1] : null;
}

// Atlas "mongodb+srv://" addresses need a DNS SRV lookup. On some Windows PCs
// Node's own resolver points at 127.0.0.1 (VPN, ad-blocker or adapter settings),
// so the lookup fails with "querySrv ECONNREFUSED" even though the browser works.
// When that happens, Node is switched to public DNS servers and the lookup retried.
async function ensureSrvLookupWorks(uri) {
  const host = srvHost(uri);
  if (!host) return;
  const record = `_mongodb._tcp.${host}`;
  try {
    await dns.promises.resolveSrv(record);
    return;
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      throw new Error(`MongoDB host "${host}" does not exist. Check the cluster address in MONGODB_URI.`);
    }
    if (!RESOLVER_ERRORS.has(err.code)) throw err;
    const previous = dns.getServers().join(', ');
    dns.setServers(config.dnsServers);
    try {
      await dns.promises.resolveSrv(record);
      console.log(`[db] DNS server ${previous} could not resolve Atlas; using ${config.dnsServers.join(', ')} instead`);
    } catch (retryErr) {
      throw new Error(
        `Cannot look up the MongoDB Atlas address (${retryErr.code}). Check your internet connection, ` +
          'or use the "standard connection string" (mongodb://…, not mongodb+srv://) from Atlas → Connect → Drivers.',
      );
    }
  }
}

export function explainDbError(err) {
  const msg = String(err?.message || err);
  if (/bad auth|authentication failed/i.test(msg)) {
    return 'MongoDB username or password is wrong. In Atlas → Database Access check the user, and URL-encode special characters in the password (@ → %40, # → %23, / → %2F).';
  }
  if (/whitelist|IP that isn't|not authorized to access|ReplicaSetNoPrimary|Server selection timed out/i.test(msg)) {
    return "Could not reach the Atlas cluster. In Atlas → Network Access add your current IP address (or 0.0.0.0/0 for testing), and check that the cluster isn't paused.";
  }
  if (/ECONNREFUSED 127\.0\.0\.1:27017|connect ECONNREFUSED/i.test(msg)) {
    return 'No MongoDB server is running at that address. Start MongoDB locally or set MONGODB_URI to your Atlas connection string.';
  }
  return null;
}

export async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await ensureSrvLookupWorks(uri);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log(`[db] connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
}
