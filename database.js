import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';

let db = null;

export async function initDatabase(userDataPath) {
  const dbDir = userDataPath || '.';
  if (!fs.existsSync(dbDir) && dbDir !== '.') {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'cotador-st.db');

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
      capturedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      source TEXT,
      FOREIGN KEY(quoteItemId) REFERENCES QuoteItem(id) ON DELETE CASCADE,
      FOREIGN KEY(supplierId) REFERENCES Supplier(id)
    );
  `);

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

// Database helper queries
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
      price, hasST, stStatus, availability, isValidOption, ignoreReason, recommendationStatus, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    result.source
  );
}

export async function getQuotes() {
  return await db.all('SELECT * FROM Quote ORDER BY createdAt DESC LIMIT 20');
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
