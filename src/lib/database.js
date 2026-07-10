import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from './st-rules.js';

let db = null;

export async function initDatabase(userDataPath) {
  const dbDir = userDataPath || '.';
  if (!fs.existsSync(dbDir) && dbDir !== '.') {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'cotador-st.db');
  logger.info(`Initializing database at: ${dbPath}`);

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Create tables
  await db.exec(`
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
      status TEXT,
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
      FOREIGN KEY(quoteItemId) REFERENCES QuoteItem(id) ON DELETE CASCADE,
      FOREIGN KEY(supplierId) REFERENCES Supplier(id)
    );
  `);

  // Schema migration for Phase 2: Add columns to QuoteResult if they don't exist
  try {
    const columns = await db.all("PRAGMA table_info(QuoteResult)");
    const hasReviewStatus = columns.some(c => c.name === 'reviewStatus');
    if (!hasReviewStatus) {
      logger.info('Migrating SQLite tables to Phase 2 schema...');
      await db.exec(`
        ALTER TABLE QuoteResult ADD COLUMN reviewStatus TEXT DEFAULT 'PENDENTE';
        ALTER TABLE QuoteResult ADD COLUMN notes TEXT;
        ALTER TABLE QuoteResult ADD COLUMN confidence REAL;
        ALTER TABLE QuoteResult ADD COLUMN capturedAt DATETIME DEFAULT CURRENT_TIMESTAMP;
      `);
      logger.info('Database migration completed successfully.');
    }
  } catch (err) {
    logger.error(`Database migration failed: ${err.message}`);
  }

  // Insert default suppliers
  const suppliers = ['ANB', 'Profarma', 'Santa Cruz'];
  for (const name of suppliers) {
    await db.run(
      'INSERT OR IGNORE INTO Supplier (name, active) VALUES (?, 1)',
      name
    );
  }

  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

export async function saveSearch(rawText, parsed) {
  const result = await db.run(
    'INSERT INTO ProductSearch (rawText, normalizedName, dosage, presentation) VALUES (?, ?, ?, ?)',
    rawText,
    parsed.name,
    parsed.dosage,
    parsed.presentation
  );
  return result.lastID;
}

export async function createQuote(status = 'pending') {
  const result = await db.run(
    'INSERT INTO Quote (status) VALUES (?)',
    status
  );
  return result.lastID;
}

export async function updateQuoteStatus(quoteId, status) {
  await db.run(
    'UPDATE Quote SET status = ? WHERE id = ?',
    status,
    quoteId
  );
}

export async function createQuoteItem(quoteId, rawText, parsed, status = 'pending') {
  const result = await db.run(
    'INSERT INTO QuoteItem (quoteId, rawText, normalizedName, dosage, presentation, status) VALUES (?, ?, ?, ?, ?, ?)',
    quoteId,
    rawText,
    parsed.name,
    parsed.dosage,
    parsed.presentation,
    status
  );
  return result.lastID;
}

export async function saveQuoteResult(result) {
  await db.run(
    `INSERT INTO QuoteResult (
      quoteItemId, supplierId, supplierProductName, laboratory, dosage, presentation,
      price, hasST, stStatus, availability, isValidOption, ignoreReason, recommendationStatus, 
      reviewStatus, notes, confidence, capturedAt, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    result.source
  );
}

export async function getQuotes() {
  return await db.all('SELECT * FROM Quote ORDER BY createdAt DESC LIMIT 30');
}

export async function getQuoteDetails(quoteId) {
  const quote = await db.get('SELECT * FROM Quote WHERE id = ?', quoteId);
  if (!quote) return null;

  const items = await db.all('SELECT * FROM QuoteItem WHERE quoteId = ?', quoteId);
  for (const item of items) {
    const results = await db.all(`
      SELECT qr.*, s.name as supplierName 
      FROM QuoteResult qr
      JOIN Supplier s ON qr.supplierId = s.id
      WHERE qr.quoteItemId = ?
    `, item.id);
    item.results = results;
  }

  quote.items = items;
  return quote;
}

/**
 * Updates a result record and triggers automatic recommendation recalculation.
 */
export async function updateQuoteResult(resultId, fields) {
  logger.info(`Updating QuoteResult #${resultId} with fields: ${JSON.stringify(fields)}`);
  
  // Find the quoteItemId first
  const result = await db.get('SELECT quoteItemId FROM QuoteResult WHERE id = ?', resultId);
  if (!result) {
    throw new Error(`QuoteResult with ID ${resultId} not found.`);
  }
  
  const { quoteItemId } = result;

  // Build dynamic update query
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setString = keys.map(k => `${k} = ?`).join(', ');

  await db.run(
    `UPDATE QuoteResult SET ${setString} WHERE id = ?`,
    ...values,
    resultId
  );

  // Recalculate recommendations for the parent QuoteItem
  await recalculateQuoteItemRecommendations(quoteItemId);

  return quoteItemId;
}

/**
 * Recalculates recommendation statuses based on prices, availability, ST rules, and manual review.
 */
export async function recalculateQuoteItemRecommendations(quoteItemId) {
  logger.info(`Recalculating recommendations for QuoteItem #${quoteItemId}`);

  const results = await db.all('SELECT * FROM QuoteResult WHERE quoteItemId = ?', quoteItemId);
  
  const processed = results.map(res => {
    let isValidOption = false;
    let ignoreReason = '';
    let recStatus = '';

    const isAvailable = res.availability === 'disponível';
    const isApproved = res.reviewStatus !== 'REJEITADO';
    const stValid = isValidST(res.stStatus);
    const hasST = res.stStatus === 'COM_ST' || res.stStatus === 'ST_INCLUSO';

    if (res.reviewStatus === 'REJEITADO') {
      ignoreReason = 'Rejeitado pelo usuário';
      recStatus = 'Ignorado — rejeitado';
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

  // Filter valid options and sort by ST priority first, then by price ascending
  const validOptions = processed
    .filter(r => r.isValidOption)
    .sort((a, b) => {
      const priorityA = getSTPriority(a.stStatus);
      const priorityB = getSTPriority(b.stStatus);
      if (priorityA !== priorityB) {
        return priorityA - priorityB; // Prefer priority 1 (COM_ST, ST_INCLUSO) over 2 (ST_SEPARADO)
      }
      return a.price - b.price; // If priority is same, sort by price
    });

  if (validOptions.length > 0) {
    const bestItem = validOptions[0];
    bestItem.recommendationStatus = 'Melhor preço com ST';
    
    // If there is a second option, check if it's valid
    if (validOptions.length > 1) {
      validOptions[1].recommendationStatus = 'Segunda opção com ST';
    }
  }

  // Save all updated statuses back to DB
  for (const res of processed) {
    // Find updated status from sorted list if it is a valid option
    let finalRecStatus = res.recommendationStatus;
    if (res.isValidOption) {
      const match = validOptions.find(vo => vo.id === res.id);
      if (match) {
        finalRecStatus = match.recommendationStatus;
      }
    }

    await db.run(
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
