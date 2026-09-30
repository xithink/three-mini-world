import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BSON, MongoClient } from 'mongodb';
import { loadProjectEnv } from './loadEnv.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

loadProjectEnv(projectRoot);

const defaultExportDir = resolve(
  projectRoot,
  '..',
  'db-export-2026-08-13T03-17-14-298Z',
  'db-export-2026-08-13T03-17-14-298Z',
);
const exportDir = resolve(process.argv[2] ?? defaultExportDir);
const manifestPath = resolve(exportDir, 'manifest.json');
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018';

if (!existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const databaseName = process.env.MONGO_DB_NAME ?? manifest.database ?? 'three_mini_world';
const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });

try {
  await client.connect();
  const db = client.db(databaseName);

  for (const collectionInfo of manifest.collections ?? []) {
    const filePath = resolve(exportDir, collectionInfo.file);

    if (!existsSync(filePath)) {
      throw new Error(`Collection export file not found: ${filePath}`);
    }

    const collection = db.collection(collectionInfo.name);
    const records = BSON.EJSON.parse(readFileSync(filePath, 'utf8'), { relaxed: true });

    if (!Array.isArray(records)) {
      throw new Error(`Collection export is not an array: ${filePath}`);
    }

    await collection.deleteMany({});

    if (records.length > 0) {
      await collection.insertMany(records, { ordered: true });
    }

    console.log(`${collectionInfo.name}: imported ${records.length} records`);
  }
} finally {
  await client.close();
}
