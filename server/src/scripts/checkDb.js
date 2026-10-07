// npm run check-db  ->  tests the MONGODB_URI in server/.env without starting the API.
import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectDb, explainDbError } from '../db.js';

const masked = config.mongoUri.replace(/\/\/([^:@/]+):([^@]+)@/, '//$1:****@');
console.log(`Checking ${masked}`);
try {
  await connectDb(config.mongoUri);
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log(`OK - database "${mongoose.connection.name}" has ${collections.length} collection(s).`);
  await mongoose.disconnect();
} catch (err) {
  console.error(`FAILED - ${err.message}`);
  const hint = explainDbError(err);
  if (hint) console.error(`Hint: ${hint}`);
  process.exitCode = 1;
}
