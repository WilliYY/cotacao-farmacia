import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';
import { isValidST, getSTPriority } from './st-rules.js';
import { buildQuoteSummary } from './quote-summary.js';

let dbInstance = null;
let isPostgres = false;
let pgPool = null;
let sqliteDb = null;

const POSTGRES_CAMEL_CASE_KEYS = [
  'rawText', 'normalizedName', 'createdAt', 'quoteId', 'searchText', 'correctionType',
  'correctionMessage', 'confidenceStatus', 'refinementSuggestion', 'quoteItemId',
  'supplierId', 'supplierProductName', 'hasST', 'stStatus', 'isValidOption',
  'ignoreReason', 'recommendationStatus', 'reviewStatus', 'capturedAt', 'unitPrice',
  'auditStatus', 'auditSummary', 'priceSourceLabel', 'liveFailureReason', 'failureCode',
  'timedOut', 'searchFallback', 'searchCount', 'lastSearchedAt', 'canonicalName',
  'lastConfirmedAt', 'clientCode', 'updatedAt', 'supplierName', 'farmaciaPopular',
  'farmaciaPopularCategory', 'farmaciaPopularCoverage', 'farmaciaPopularNotes'
].reduce((keys, name) => keys.set(name.toLowerCase(), name), new Map());

export function normalizePostgresRow(row) {
  if (!row || typeof row !== 'object') return row;
  const normalized = { ...row };
  for (const [key, value] of Object.entries(row)) {
    const camelCaseKey = POSTGRES_CAMEL_CASE_KEYS.get(key.toLowerCase());
    if (camelCaseKey && normalized[camelCaseKey] === undefined) {
      normalized[camelCaseKey] = value;
    }
  }
  return normalized;
}

const CANONICAL_SUPPLIER_NAMES = new Map([
  [1, 'ANB'],
  [2, 'Profarma'],
  [3, 'Santa Cruz'],
  [4, 'DM Paraná']
]);

const CANONICAL_SUPPLIER_IDS = new Map(
  Array.from(CANONICAL_SUPPLIER_NAMES, ([id, name]) => [name, id])
);

function resolveSqliteDirectory(userDataPath) {
  const configuredPath = (process.env.DATABASE_PATH || '').trim();

  if (!configuredPath) {
    return userDataPath || '.';
  }

  if (configuredPath.toLowerCase() === 'local') {
    return path.join(process.cwd(), 'data');
  }

  return path.resolve(configuredPath);
}

function translateQuery(sql, params) {
  if (!isPostgres) return { sql, params };
  
  // 1. Convert ? to $1, $2, etc.
  let index = 1;
  let translatedSql = sql.replace(/\?/g, () => `$${index++}`);
  
  // 2. Convert INSERT OR IGNORE to ON CONFLICT DO NOTHING
  if (translatedSql.toUpperCase().includes('INSERT OR IGNORE INTO SUPPLIER')) {
    translatedSql = translatedSql.replace(/INSERT OR IGNORE INTO Supplier/gi, 'INSERT INTO Supplier');
    translatedSql += ' ON CONFLICT (name) DO NOTHING';
  }
  
  return { sql: translatedSql, params };
}

const dbWrapper = {
  exec: async (sql) => {
    if (isPostgres) {
      await pgPool.query(sql);
    } else {
      await sqliteDb.exec(sql);
    }
  },
  run: async (sql, ...params) => {
    const { sql: tSql, params: tParams } = translateQuery(sql, params);
    if (isPostgres) {
      let finalSql = tSql;
      if (tSql.trim().toUpperCase().startsWith('INSERT ')) {
        finalSql += ' RETURNING id';
      }
      const res = await pgPool.query(finalSql, tParams);
      const lastID = res.rows[0]?.id || null;
      return { lastID };
    } else {
      return await sqliteDb.run(tSql, ...tParams);
    }
  },
  get: async (sql, ...params) => {
    const { sql: tSql, params: tParams } = translateQuery(sql, params);
    if (isPostgres) {
      const res = await pgPool.query(tSql, tParams);
      return normalizePostgresRow(res.rows[0]) || null;
    } else {
      return await sqliteDb.get(tSql, ...tParams);
    }
  },
  all: async (sql, ...params) => {
    const { sql: tSql, params: tParams } = translateQuery(sql, params);
    if (isPostgres) {
      const res = await pgPool.query(tSql, tParams);
      return res.rows.map(normalizePostgresRow);
    } else {
      return await sqliteDb.all(tSql, ...tParams);
    }
  }
};

export async function initDatabase(userDataPath) {
  isPostgres = process.env.DB_TYPE === 'postgres';
  logger.info(`Database type: ${isPostgres ? 'PostgreSQL' : 'SQLite'}`);

  if (isPostgres) {
    try {
      const pg = await import('pg');
      pgPool = new pg.default.Pool({
        host: process.env.PG_HOST || 'localhost',
        port: parseInt(process.env.PG_PORT || '5432', 10),
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || 'yourpassword',
        database: process.env.PG_DATABASE || 'cotador_st'
      });
      
      // Test Postgres connection
      const client = await pgPool.connect();
      logger.info('Connected to PostgreSQL successfully.');
      client.release();
    } catch (err) {
      logger.error(`PostgreSQL connection failed: ${err.message}`);
      logger.warn('Falling back to SQLite due to PostgreSQL error.');
      isPostgres = false;
    }
  }

  if (!isPostgres) {
    const dbDir = resolveSqliteDirectory(userDataPath);
    if (!fs.existsSync(dbDir) && dbDir !== '.') {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'cotador-st.db');
    logger.info(`Initializing SQLite database at: ${dbPath}`);

    sqliteDb = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
  }

  dbInstance = dbWrapper;

  // Create tables depending on database type
  if (isPostgres) {
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS ProductSearch (
        id SERIAL PRIMARY KEY,
        rawText TEXT,
        normalizedName TEXT,
        dosage TEXT,
        presentation TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Supplier (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE,
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS Quote (
        id SERIAL PRIMARY KEY,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS QuoteItem (
        id SERIAL PRIMARY KEY,
        quoteId INTEGER,
        rawText TEXT,
        normalizedName TEXT,
        dosage TEXT,
        presentation TEXT,
        ean TEXT,
        quantity INTEGER DEFAULT 1,
        searchText TEXT,
        correctionType TEXT,
        correctionMessage TEXT,
        status TEXT,
        confidenceStatus TEXT,
        refinementSuggestion TEXT,
        FOREIGN KEY(quoteId) REFERENCES Quote(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS QuoteResult (
        id SERIAL PRIMARY KEY,
        quoteItemId INTEGER,
        supplierId INTEGER,
        supplierProductName TEXT,
        laboratory TEXT,
        dosage TEXT,
        presentation TEXT,
        price REAL,
        hasST INTEGER,
        stStatus TEXT,
        availability TEXT,
        isValidOption INTEGER,
        ignoreReason TEXT,
        recommendationStatus TEXT,
        reviewStatus TEXT DEFAULT 'PENDENTE',
        notes TEXT,
        confidence REAL,
        capturedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        source TEXT,
        ean TEXT,
        packaging TEXT,
        quantity INTEGER DEFAULT 1,
        unitPrice REAL,
        auditStatus TEXT DEFAULT 'OK',
        auditSummary TEXT,
        priceSourceLabel TEXT,
        liveFailureReason TEXT,
        failureCode TEXT,
        timedOut INTEGER DEFAULT 0,
        searchFallback TEXT,
        farmaciaPopular INTEGER DEFAULT 0,
        farmaciaPopularCategory TEXT,
        farmaciaPopularCoverage TEXT,
        farmaciaPopularNotes TEXT,
        FOREIGN KEY(quoteItemId) REFERENCES QuoteItem(id) ON DELETE CASCADE,
        FOREIGN KEY(supplierId) REFERENCES Supplier(id)
      );

      CREATE TABLE IF NOT EXISTS SystemLog (
        id SERIAL PRIMARY KEY,
        level VARCHAR(10),
        message TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS SearchPopularity (
        id SERIAL PRIMARY KEY,
        query VARCHAR(255) UNIQUE,
        searchCount INTEGER DEFAULT 1,
        lastSearchedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS QueryCorrection (
        id SERIAL PRIMARY KEY,
        alias TEXT UNIQUE,
        canonicalName TEXT,
        source TEXT,
        confidence REAL DEFAULT 1,
        confirmations INTEGER DEFAULT 1,
        lastConfirmedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS SupplierCredentials (
        id SERIAL PRIMARY KEY,
        supplierId INTEGER UNIQUE,
        url TEXT,
        username TEXT,
        password TEXT,
        clientCode TEXT,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS ProductSearch (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rawText TEXT,
        normalizedName TEXT,
        dosage TEXT,
        presentation TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Supplier (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS Quote (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS QuoteItem (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quoteId INTEGER,
        rawText TEXT,
        normalizedName TEXT,
        dosage TEXT,
        presentation TEXT,
        ean TEXT,
        quantity INTEGER DEFAULT 1,
        searchText TEXT,
        correctionType TEXT,
        correctionMessage TEXT,
        status TEXT,
        confidenceStatus TEXT,
        refinementSuggestion TEXT,
        FOREIGN KEY(quoteId) REFERENCES Quote(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS QuoteResult (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quoteItemId INTEGER,
        supplierId INTEGER,
        supplierProductName TEXT,
        laboratory TEXT,
        dosage TEXT,
        presentation TEXT,
        price REAL,
        hasST INTEGER,
        stStatus TEXT,
        availability TEXT,
        isValidOption INTEGER,
        ignoreReason TEXT,
        recommendationStatus TEXT,
        reviewStatus TEXT DEFAULT 'PENDENTE',
        notes TEXT,
        confidence REAL,
        capturedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT,
        ean TEXT,
        packaging TEXT,
        quantity INTEGER DEFAULT 1,
        unitPrice REAL,
        auditStatus TEXT DEFAULT 'OK',
        auditSummary TEXT,
        priceSourceLabel TEXT,
        liveFailureReason TEXT,
        failureCode TEXT,
        timedOut INTEGER DEFAULT 0,
        searchFallback TEXT,
        farmaciaPopular INTEGER DEFAULT 0,
        farmaciaPopularCategory TEXT,
        farmaciaPopularCoverage TEXT,
        farmaciaPopularNotes TEXT,
        FOREIGN KEY(quoteItemId) REFERENCES QuoteItem(id) ON DELETE CASCADE,
        FOREIGN KEY(supplierId) REFERENCES Supplier(id)
      );

      CREATE TABLE IF NOT EXISTS SystemLog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS SearchPopularity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT UNIQUE,
        searchCount INTEGER DEFAULT 1,
        lastSearchedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS QueryCorrection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alias TEXT UNIQUE,
        canonicalName TEXT,
        source TEXT,
        confidence REAL DEFAULT 1,
        confirmations INTEGER DEFAULT 1,
        lastConfirmedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS SupplierCredentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplierId INTEGER UNIQUE,
        url TEXT,
        username TEXT,
        password TEXT,
        clientCode TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Schema migrations checking
  try {
    let hasReviewStatus = true;
    if (isPostgres) {
      const colCheck = await dbInstance.all(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='quoteresult' AND column_name='reviewstatus'
      `);
      hasReviewStatus = colCheck.length > 0;
    } else {
      const resColumns = await dbInstance.all("PRAGMA table_info(QuoteResult)");
      hasReviewStatus = resColumns.some(c => c.name === 'reviewStatus');
    }

    if (!hasReviewStatus) {
      logger.info('Migrating tables to Phase 2 schema...');
      await dbInstance.exec(`
        ALTER TABLE QuoteResult ADD COLUMN reviewStatus TEXT DEFAULT 'PENDENTE';
        ALTER TABLE QuoteResult ADD COLUMN notes TEXT;
        ALTER TABLE QuoteResult ADD COLUMN confidence REAL;
        ALTER TABLE QuoteResult ADD COLUMN capturedAt DATETIME DEFAULT CURRENT_TIMESTAMP;
      `);
    }

    let hasEan = true;
    if (isPostgres) {
      const colCheck = await dbInstance.all(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='quoteresult' AND column_name='ean'
      `);
      hasEan = colCheck.length > 0;
    } else {
      const resColumns = await dbInstance.all("PRAGMA table_info(QuoteResult)");
      hasEan = resColumns.some(c => c.name === 'ean');
    }

    if (!hasEan) {
      logger.info('Migrating tables to granular EAN/Packaging schema...');
      await dbInstance.exec(`
        ALTER TABLE QuoteResult ADD COLUMN ean TEXT;
        ALTER TABLE QuoteResult ADD COLUMN packaging TEXT;
        ALTER TABLE QuoteResult ADD COLUMN quantity INTEGER DEFAULT 1;
        ALTER TABLE QuoteResult ADD COLUMN unitPrice REAL;
        
        ALTER TABLE QuoteItem ADD COLUMN ean TEXT;
        ALTER TABLE QuoteItem ADD COLUMN quantity INTEGER DEFAULT 1;
      `);
      logger.info('Granular database migration completed successfully.');
    }

    let hasConfidenceStatus = true;
    if (isPostgres) {
      const colCheck = await dbInstance.all(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='quoteitem' AND column_name='confidencestatus'
      `);
      hasConfidenceStatus = colCheck.length > 0;
    } else {
      const resColumns = await dbInstance.all("PRAGMA table_info(QuoteItem)");
      hasConfidenceStatus = resColumns.some(c => c.name === 'confidenceStatus');
    }

    if (!hasConfidenceStatus) {
      logger.info('Migrating tables to vague description refinement schema...');
      await dbInstance.exec(`
        ALTER TABLE QuoteItem ADD COLUMN confidenceStatus TEXT;
        ALTER TABLE QuoteItem ADD COLUMN refinementSuggestion TEXT;
      `);
      logger.info('Vague description database migration completed successfully.');
    }

    let hasAuditStatus = true;
    if (isPostgres) {
      const colCheck = await dbInstance.all(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='quoteresult' AND column_name='auditstatus'
      `);
      hasAuditStatus = colCheck.length > 0;
    } else {
      const resColumns = await dbInstance.all("PRAGMA table_info(QuoteResult)");
      hasAuditStatus = resColumns.some(c => c.name === 'auditStatus');
    }

    if (!hasAuditStatus) {
      logger.info('Migrating tables to quote audit schema...');
      await dbInstance.exec(`
        ALTER TABLE QuoteResult ADD COLUMN auditStatus TEXT DEFAULT 'OK';
        ALTER TABLE QuoteResult ADD COLUMN auditSummary TEXT;
      `);
      logger.info('Quote audit database migration completed successfully.');
    }

    let hasSearchText = true;
    if (isPostgres) {
      const colCheck = await dbInstance.all(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='quoteitem' AND column_name='searchtext'
      `);
      hasSearchText = colCheck.length > 0;
    } else {
      const itemColumns = await dbInstance.all("PRAGMA table_info(QuoteItem)");
      hasSearchText = itemColumns.some(c => c.name === 'searchText');
    }

    if (!hasSearchText) {
      logger.info('Migrating tables to contextual query intelligence schema...');
      await dbInstance.exec(`
        ALTER TABLE QuoteItem ADD COLUMN searchText TEXT;
        ALTER TABLE QuoteItem ADD COLUMN correctionType TEXT;
        ALTER TABLE QuoteItem ADD COLUMN correctionMessage TEXT;
      `);
      logger.info('Contextual query intelligence migration completed successfully.');
    }

    const evidenceColumnDefinitions = [
      ['priceSourceLabel', 'TEXT'],
      ['liveFailureReason', 'TEXT'],
      ['failureCode', 'TEXT'],
      ['timedOut', 'INTEGER DEFAULT 0'],
      ['searchFallback', 'TEXT'],
      ['farmaciaPopular', 'INTEGER DEFAULT 0'],
      ['farmaciaPopularCategory', 'TEXT'],
      ['farmaciaPopularCoverage', 'TEXT'],
      ['farmaciaPopularNotes', 'TEXT']
    ];
    let existingEvidenceColumns;
    if (isPostgres) {
      const colCheck = await dbInstance.all(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='quoteresult'
      `);
      existingEvidenceColumns = new Set(colCheck.map(column => String(column.column_name).toLowerCase()));
    } else {
      const resultColumns = await dbInstance.all("PRAGMA table_info(QuoteResult)");
      existingEvidenceColumns = new Set(resultColumns.map(column => String(column.name).toLowerCase()));
    }

    const missingEvidenceColumns = evidenceColumnDefinitions.filter(
      ([name]) => !existingEvidenceColumns.has(name.toLowerCase())
    );
    if (missingEvidenceColumns.length > 0) {
      logger.info('Migrating tables to live supplier evidence schema...');
      for (const [name, definition] of missingEvidenceColumns) {
        await dbInstance.exec(`ALTER TABLE QuoteResult ADD COLUMN ${name} ${definition}`);
      }
      logger.info('Live supplier evidence database migration completed successfully.');
    }
  } catch (err) {
    logger.error(`Database migration checking failed: ${err.message}`);
  }

  // Insert default suppliers
  const suppliers = [
    { id: 1, name: 'ANB' },
    { id: 2, name: 'Profarma' },
    { id: 3, name: 'Santa Cruz' },
    { id: 4, name: 'DM Paraná' }
  ];
  for (const supplier of suppliers) {
    await dbInstance.run(
      'INSERT OR IGNORE INTO Supplier (id, name, active) VALUES (?, ?, 1)',
      supplier.id,
      supplier.name
    );
  }

  await reconcileCanonicalSupplierReferences();

  return dbInstance;
}

export function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return dbInstance;
}

export async function getSupplierIdByName(name) {
  if (!dbInstance) return null;
  const supplier = await dbInstance.get(
    'SELECT id FROM Supplier WHERE name = ? AND active = 1',
    name
  );
  return supplier?.id || null;
}

export async function resolveSupplierDatabaseId(supplierReference) {
  if (!dbInstance) return null;

  const numericReference = Number.parseInt(String(supplierReference), 10);
  const isNumericReference = Number.isInteger(numericReference) && String(numericReference) === String(supplierReference);
  const supplierName = isNumericReference
    ? CANONICAL_SUPPLIER_NAMES.get(numericReference)
    : String(supplierReference || '').trim();

  if (supplierName) {
    const supplierId = await getSupplierIdByName(supplierName);
    if (supplierId) return supplierId;
  }

  if (!isNumericReference) return null;
  const supplier = await dbInstance.get('SELECT id FROM Supplier WHERE id = ? AND active = 1', numericReference);
  return supplier?.id || null;
}

export async function reconcileCanonicalSupplierReferences() {
  if (!dbInstance) return;

  for (const [canonicalId, supplierName] of CANONICAL_SUPPLIER_NAMES) {
    const databaseId = await getSupplierIdByName(supplierName);
    if (!databaseId || databaseId === canonicalId) continue;

    const canonicalIdOwner = await dbInstance.get('SELECT name FROM Supplier WHERE id = ?', canonicalId);
    if (canonicalIdOwner && canonicalIdOwner.name !== supplierName) continue;

    const orphanCredentials = await dbInstance.get(
      'SELECT * FROM SupplierCredentials WHERE supplierId = ?',
      canonicalId
    );
    const currentCredentials = await dbInstance.get(
      'SELECT * FROM SupplierCredentials WHERE supplierId = ?',
      databaseId
    );

    if (orphanCredentials && !currentCredentials) {
      await dbInstance.run(
        'UPDATE SupplierCredentials SET supplierId = ? WHERE supplierId = ?',
        databaseId,
        canonicalId
      );
    } else if (orphanCredentials && currentCredentials) {
      if (String(orphanCredentials.updatedAt || '') > String(currentCredentials.updatedAt || '')) {
        await dbInstance.run(
          `UPDATE SupplierCredentials
           SET url = ?, username = ?, password = ?, clientCode = ?, updatedAt = ?
           WHERE supplierId = ?`,
          orphanCredentials.url,
          orphanCredentials.username,
          orphanCredentials.password,
          orphanCredentials.clientCode,
          orphanCredentials.updatedAt,
          databaseId
        );
      }
      await dbInstance.run('DELETE FROM SupplierCredentials WHERE supplierId = ?', canonicalId);
    }

    await dbInstance.run(
      'UPDATE QuoteResult SET supplierId = ? WHERE supplierId = ?',
      databaseId,
      canonicalId
    );
  }
}

export async function saveSearch(rawText, parsed) {
  const result = await dbInstance.run(
    'INSERT INTO ProductSearch (rawText, normalizedName, dosage, presentation) VALUES (?, ?, ?, ?)',
    rawText,
    parsed.name,
    parsed.dosage,
    parsed.presentation
  );
  
  await trackSearchPopularity(rawText);

  return result.lastID;
}

export async function trackSearchPopularity(rawText) {
  const query = rawText.trim().toLowerCase();
  if (!query) return;
  try {
    await dbInstance.run(`
      INSERT INTO SearchPopularity (query, searchCount, lastSearchedAt) 
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(query) DO UPDATE SET 
        searchCount = searchCount + 1,
        lastSearchedAt = CURRENT_TIMESTAMP
    `, query);
  } catch (e) {
    logger.error(`Failed to track search popularity: ${e.message}`);
  }
}

export async function getPopularSearches() {
  try {
    return await dbInstance.all('SELECT query, searchCount FROM SearchPopularity ORDER BY searchCount DESC, lastSearchedAt DESC LIMIT 10');
  } catch (e) {
    logger.error(`Failed to get popular searches: ${e.message}`);
    return [];
  }
}

export async function createQuote(status = 'pending') {
  const result = await dbInstance.run(
    'INSERT INTO Quote (status) VALUES (?)',
    status
  );
  return result.lastID;
}

export async function updateQuoteStatus(quoteId, status) {
  await dbInstance.run(
    'UPDATE Quote SET status = ? WHERE id = ?',
    status,
    quoteId
  );
}

export async function createQuoteItem(quoteId, rawText, parsed, status = 'pending', intelligence = {}) {
  const result = await dbInstance.run(
    'INSERT INTO QuoteItem (quoteId, rawText, normalizedName, dosage, presentation, ean, quantity, searchText, correctionType, correctionMessage, status, confidenceStatus, refinementSuggestion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    quoteId,
    rawText,
    parsed.name,
    parsed.dosage,
    parsed.presentation,
    parsed.ean || null,
    parsed.quantity || 1,
    intelligence.searchText || parsed.originalTerms || rawText,
    intelligence.correctionType || null,
    intelligence.correctionMessage || null,
    status,
    parsed.confidenceStatus || 'ALTA',
    parsed.refinementSuggestion || ''
  );
  return result.lastID;
}

export async function updateQuoteItemStatus(quoteItemId, status) {
  await dbInstance.run('UPDATE QuoteItem SET status = ? WHERE id = ?', status, quoteItemId);
}

export async function saveQuoteResult(result) {
  const qty = result.quantity || 1;
  const unitPrice = result.price ? (Number(result.price) / Number(qty)) : 0;

  await dbInstance.run(
    `INSERT INTO QuoteResult (
      quoteItemId, supplierId, supplierProductName, laboratory, dosage, presentation,
      price, hasST, stStatus, availability, isValidOption, ignoreReason, recommendationStatus, 
      reviewStatus, notes, confidence, capturedAt, source, ean, packaging, quantity, unitPrice,
      auditStatus, auditSummary, priceSourceLabel, liveFailureReason, failureCode, timedOut, searchFallback,
      farmaciaPopular, farmaciaPopularCategory, farmaciaPopularCoverage, farmaciaPopularNotes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    result.quoteItemId,
    result.supplierId,
    result.supplierProductName,
    result.laboratory,
    result.dosage,
    result.presentation,
    result.price,
    result.hasST ? 1 : 0,
    result.stStatus,
    result.availability,
    result.isValidOption ? 1 : 0,
    result.ignoreReason,
    result.recommendationStatus,
    result.reviewStatus || 'PENDENTE',
    result.notes || null,
    result.confidence ?? 1.0,
    result.capturedAt || new Date().toISOString(),
    result.source,
    result.ean || null,
    result.packaging || null,
    qty,
    unitPrice,
    result.auditStatus || 'OK',
    result.auditSummary || null,
    result.priceSourceLabel || null,
    result.liveFailureReason || null,
    result.failureCode || null,
    result.timedOut ? 1 : 0,
    result.searchFallback || null,
    result.farmaciaPopular ? 1 : 0,
    result.farmaciaPopularCategory || null,
    result.farmaciaPopularCoverage || null,
    result.farmaciaPopularNotes || null
  );
}

export async function getQuotes() {
  if (isPostgres) {
    return await dbInstance.all(`
      SELECT q.*, COALESCE(STRING_AGG(qi.rawText, ' | ' ORDER BY qi.id), '') AS searchTerms
      FROM Quote q
      LEFT JOIN QuoteItem qi ON qi.quoteId = q.id
      GROUP BY q.id, q.createdAt, q.status
      ORDER BY q.createdAt DESC
    `);
  }

  return await dbInstance.all(`
    SELECT q.*, COALESCE(GROUP_CONCAT(qi.rawText, ' | '), '') AS searchTerms
    FROM Quote q
    LEFT JOIN QuoteItem qi ON qi.quoteId = q.id
    GROUP BY q.id
    ORDER BY q.createdAt DESC
  `);
}

export async function getLearnedCorrections() {
  try {
    return await dbInstance.all(`
      SELECT alias, canonicalName, source, confidence, confirmations
      FROM QueryCorrection
      ORDER BY confirmations DESC, lastConfirmedAt DESC
    `);
  } catch (error) {
    logger.error(`Failed to load learned query corrections: ${error.message}`);
    return [];
  }
}

export async function recordQueryCorrection(alias, canonicalName, source = 'LIVE_RESULT', confidence = 1) {
  const normalizedAlias = String(alias || '').trim().toLowerCase();
  const normalizedCanonical = String(canonicalName || '').trim().toLowerCase();
  if (!normalizedAlias || !normalizedCanonical || normalizedAlias === normalizedCanonical) return;

  await dbInstance.run(`
    INSERT INTO QueryCorrection (alias, canonicalName, source, confidence, confirmations, lastConfirmedAt)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(alias) DO UPDATE SET
      canonicalName = excluded.canonicalName,
      source = excluded.source,
      confidence = excluded.confidence,
      confirmations = CASE
        WHEN QueryCorrection.canonicalName = excluded.canonicalName
          THEN QueryCorrection.confirmations + 1
        ELSE 1
      END,
      lastConfirmedAt = CURRENT_TIMESTAMP
  `, normalizedAlias, normalizedCanonical, source, confidence);
}

export async function getQuoteDetails(quoteId) {
  const quote = await dbInstance.get('SELECT * FROM Quote WHERE id = ?', quoteId);
  if (!quote) return null;

  const items = await dbInstance.all('SELECT * FROM QuoteItem WHERE quoteId = ?', quoteId);
  for (const item of items) {
    const results = await dbInstance.all(`
      SELECT qr.*, COALESCE(s.name, qr.source, 'N/A') as supplierName
      FROM QuoteResult qr
      LEFT JOIN Supplier s ON qr.supplierId = s.id
      WHERE qr.quoteItemId = ?
    `, item.id);
    item.results = results;
  }

  quote.items = items;
  quote.summary = buildQuoteSummary(items);
  return quote;
}

export async function updateQuoteResult(resultId, fields) {
  logger.info(`Updating QuoteResult #${resultId} with fields: ${JSON.stringify(fields)}`);
  
  const result = await dbInstance.get('SELECT quoteItemId, price, quantity FROM QuoteResult WHERE id = ?', resultId);
  if (!result) {
    throw new Error(`QuoteResult with ID ${resultId} not found.`);
  }
  
  const { quoteItemId } = result;

  const newPrice = fields.price !== undefined ? fields.price : result.price;
  const newQty = fields.quantity !== undefined ? fields.quantity : result.quantity;
  const unitPrice = newPrice ? (newPrice / (newQty || 1)) : 0;
  
  fields.unitPrice = unitPrice;

  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setString = keys.map(k => `${k} = ?`).join(', ');

  await dbInstance.run(
    `UPDATE QuoteResult SET ${setString} WHERE id = ?`,
    ...values,
    resultId
  );

  await recalculateQuoteItemRecommendations(quoteItemId);

  return quoteItemId;
}

export async function recalculateQuoteItemRecommendations(quoteItemId) {
  logger.info(`Recalculating recommendations for QuoteItem #${quoteItemId}`);

  const results = await dbInstance.all('SELECT * FROM QuoteResult WHERE quoteItemId = ?', quoteItemId);
  
  const processed = results.map(res => {
    let isValidOption = false;
    let ignoreReason = '';
    let recStatus = '';

    const normalizedAvailability = String(res.availability || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const isAvailable = normalizedAvailability === 'disponivel';
    const isApproved = res.reviewStatus !== 'REJEITADO';
    const auditBlocked = res.auditStatus === 'BLOQUEADO' && res.reviewStatus !== 'APROVADO';
    const stValid = isValidST(res.stStatus);

    if (res.reviewStatus === 'REJEITADO') {
      ignoreReason = 'Rejeitado pelo usuário';
      recStatus = 'Ignorado — rejeitado';
    } else if (auditBlocked) {
      ignoreReason = res.auditSummary || 'Bloqueado pela auditoria';
      recStatus = 'Precisa revisar cotação';
    } else if (!isAvailable) {
      ignoreReason = 'Sem estoque';
      recStatus = 'Sem estoque';
    } else if (res.stStatus === 'SEM_ST') {
      ignoreReason = 'Sem ST';
      recStatus = 'Ignorado — sem ST';
    } else if (res.stStatus === 'ST_DESCONHECIDO') {
      ignoreReason = 'Precisa revisar ST';
      recStatus = 'Precisa revisar ST';
    } else if (stValid && isAvailable && isApproved) {
      isValidOption = true;
      if (res.stStatus === 'ST_SEPARADO') {
        recStatus = 'ST separado — conferir custo final';
      } else {
        recStatus = 'Válido com ST';
      }
    }

    return {
      ...res,
      isValidOption,
      ignoreReason,
      recommendationStatus: recStatus
    };
  });

  const validOptions = processed
    .filter(r => r.isValidOption)
    .sort((a, b) => {
      const priorityA = getSTPriority(a.stStatus);
      const priorityB = getSTPriority(b.stStatus);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return a.unitPrice - b.unitPrice;
    });

  if (validOptions.length > 0) {
    const bestItem = validOptions[0];
    bestItem.recommendationStatus = 'Melhor preço com ST';
    
    if (validOptions.length > 1) {
      validOptions[1].recommendationStatus = 'Segunda opção com ST';
    }
  }

  for (const res of processed) {
    let finalRecStatus = res.recommendationStatus;
    if (res.isValidOption) {
      const match = validOptions.find(vo => vo.id === res.id);
      if (match) {
        finalRecStatus = match.recommendationStatus;
      }
    }

    await dbInstance.run(
      `UPDATE QuoteResult SET 
        isValidOption = ?, 
        ignoreReason = ?, 
        recommendationStatus = ? 
      WHERE id = ?`,
      res.isValidOption ? 1 : 0,
      res.ignoreReason,
      finalRecStatus,
      res.id
    );
  }
}

// Log persistence helper
export async function saveLogToDb(level, message) {
  if (!dbInstance) return;
  try {
    await dbInstance.run(
      'INSERT INTO SystemLog (level, message) VALUES (?, ?)',
      level,
      message
    );
  } catch (err) {
    // Fail silently to avoid infinite log loops
  }
}

export async function getSystemLogs(limit = 100) {
  if (!dbInstance) return [];
  try {
    return await dbInstance.all('SELECT * FROM SystemLog ORDER BY timestamp DESC LIMIT ?', limit);
  } catch (err) {
    return [];
  }
}

// Supplier credentials storage operations with safeStorage encryption helper
let safeStorageInstance = null;
async function getSafeStorage() {
  if (safeStorageInstance !== null) return safeStorageInstance;
  if (process.versions && process.versions.electron) {
    try {
      const electron = await import('electron');
      if (electron.safeStorage && electron.safeStorage.isEncryptionAvailable()) {
        safeStorageInstance = {
          encryptString: (str) => electron.safeStorage.encryptString(str),
          decryptString: (buf) => electron.safeStorage.decryptString(buf),
          storageMode: 'dpapi'
        };
      }
    } catch (e) {
      // Bypassed (e.g. running in terminal testing context)
    }
  }
  if (!safeStorageInstance) {
    safeStorageInstance = {
      encryptString: (str) => Buffer.from(str, 'utf8'),
      decryptString: (buf) => buf.toString('utf8'),
      storageMode: 'plain'
    };
  }
  return safeStorageInstance;
}

function decryptLegacyPlainPassword(value) {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return decoded || value;
  } catch {
    return value;
  }
}

async function decryptStoredPassword(value) {
  if (!value) return value;

  if (value.startsWith('plain:')) {
    return decryptLegacyPlainPassword(value.slice('plain:'.length));
  }

  const storage = await getSafeStorage();

  if (value.startsWith('dpapi:')) {
    const encryptedBuffer = Buffer.from(value.slice('dpapi:'.length), 'base64');
    return storage.decryptString(encryptedBuffer);
  }

  try {
    const encryptedBuffer = Buffer.from(value, 'base64');
    return storage.decryptString(encryptedBuffer);
  } catch {
    return decryptLegacyPlainPassword(value);
  }
}

export async function saveSupplierCredentials(supplierReference, url, username, password, clientCode) {
  if (!dbInstance) return;
  const supplierId = await resolveSupplierDatabaseId(supplierReference);
  if (!supplierId) throw new Error(`Distribuidora nao encontrada: ${supplierReference}`);

  let encryptedPassword;
  if (String(process.env.CREDENTIAL_STORAGE_MODE || '').toLowerCase() === 'plain') {
    encryptedPassword = `plain:${Buffer.from(password || '', 'utf8').toString('base64')}`;
  } else {
    const storage = await getSafeStorage();
    encryptedPassword = `${storage.storageMode}:${storage.encryptString(password || '').toString('base64')}`;
  }
  await dbInstance.run(
    `INSERT INTO SupplierCredentials (supplierId, url, username, password, clientCode) 
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(supplierId) DO UPDATE SET 
       url=excluded.url,
       username=excluded.username,
       password=excluded.password,
       clientCode=excluded.clientCode,
       updatedAt=CURRENT_TIMESTAMP`,
    supplierId, url, username, encryptedPassword, clientCode
  );
}

export async function getSupplierCredentials(supplierReference) {
  if (!dbInstance) return null;
  const supplierId = await resolveSupplierDatabaseId(supplierReference);
  if (!supplierId) return null;
  const row = await dbInstance.get('SELECT * FROM SupplierCredentials WHERE supplierId = ?', supplierId);
  if (!row) return null;
  row.canonicalSupplierId = CANONICAL_SUPPLIER_IDS.get(CANONICAL_SUPPLIER_NAMES.get(Number(supplierReference)) || '') ||
    CANONICAL_SUPPLIER_IDS.get(String(supplierReference || '').trim()) || null;
  if (row.password) {
    try {
      row.password = await decryptStoredPassword(row.password);
    } catch (err) {
      logger.warn(`Stored credentials could not be read for supplierId ${supplierId}.`);
      row.password = '';
      row.passwordUnreadable = true;
    }
  }
  return row;
}

export async function getAllSupplierCredentials() {
  if (!dbInstance) return [];
  const rows = await dbInstance.all(`
    SELECT c.*, s.name AS supplierName
    FROM SupplierCredentials c
    INNER JOIN Supplier s ON s.id = c.supplierId
  `);
  for (const row of rows) {
    row.canonicalSupplierId = CANONICAL_SUPPLIER_IDS.get(row.supplierName) || null;
    if (row.password) {
      try {
        row.password = await decryptStoredPassword(row.password);
      } catch (err) {
        logger.warn(`Stored credentials could not be read for supplierId ${row.supplierId}.`);
        row.password = '';
        row.passwordUnreadable = true;
      }
    }
  }
  return rows;
}

export async function closeDatabase() {
  if (isPostgres && pgPool) {
    await pgPool.end();
    pgPool = null;
  } else if (sqliteDb) {
    await sqliteDb.close();
    sqliteDb = null;
  }
  dbInstance = null;
}
