const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'drum_room.db');
const db = new sqlite3.Database(dbPath);

const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const getQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const getOne = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const beginTransaction = () => {
  return new Promise((resolve, reject) => {
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const commitTransaction = () => {
  return new Promise((resolve, reject) => {
    db.run('COMMIT', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const rollbackTransaction = () => {
  return new Promise((resolve, reject) => {
    db.run('ROLLBACK', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const withTransaction = async (operation) => {
  try {
    await beginTransaction();
    const result = await operation();
    await commitTransaction();
    return result;
  } catch (err) {
    await rollbackTransaction();
    throw err;
  }
};

const VALID_STATUSES = ['待领出', '已领出', '待巡检', '维护中', '停用中', '恢复可用'];

const isValidStatus = (status) => VALID_STATUSES.includes(status);

const validatePositiveInteger = (value, fieldName) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error(`${fieldName} 必须是非负整数`);
  }
  return num;
};

const validateRequiredString = (value, fieldName, maxLength = 255) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} 不能为空`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} 长度不能超过 ${maxLength} 个字符`);
  }
  return value.trim();
};

const validateWearLevel = (value, fieldName = '磨损等级') => {
  const num = Number(value);
  if (isNaN(num) || num < 0 || num > 10) {
    throw new Error(`${fieldName} 必须在 0-10 之间`);
  }
  return num;
};

const getCurrentTimeISO = () => {
  return new Date().toISOString();
};

const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`PRAGMA foreign_keys = ON`);

      db.run(`CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS rack_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS drum_skins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_number TEXT NOT NULL UNIQUE,
        type TEXT,
        brand TEXT,
        purchase_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS drums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drum_number TEXT NOT NULL UNIQUE,
        name TEXT,
        type TEXT,
        size TEXT,
        current_status TEXT DEFAULT '待领出',
        skin_id INTEGER,
        position_id INTEGER,
        shift_id INTEGER,
        tension TEXT,
        wear_level INTEGER DEFAULT 0,
        total_uses INTEGER DEFAULT 0,
        inspection_interval_days INTEGER DEFAULT 7,
        last_inspection_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (skin_id) REFERENCES drum_skins(id),
        FOREIGN KEY (position_id) REFERENCES rack_positions(id),
        FOREIGN KEY (shift_id) REFERENCES shifts(id)
      )`);
      
      db.run(`ALTER TABLE drums ADD COLUMN inspection_interval_days INTEGER DEFAULT 7`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.log('Note:', err.message);
        }
      });
      
      db.run(`ALTER TABLE drums ADD COLUMN last_inspection_date DATETIME`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.log('Note:', err.message);
        }
      });

      db.run(`CREATE TABLE IF NOT EXISTS usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drum_id INTEGER NOT NULL,
        staff_name TEXT NOT NULL,
        shift_id INTEGER,
        purpose TEXT,
        checkout_time DATETIME,
        return_time DATETIME,
        expected_return_time DATETIME,
        tension_before TEXT,
        tension_after TEXT,
        wear_before INTEGER,
        wear_after INTEGER,
        edge_wear TEXT,
        notes TEXT,
        is_overdue INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (drum_id) REFERENCES drums(id),
        FOREIGN KEY (shift_id) REFERENCES shifts(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS inspection_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drum_id INTEGER NOT NULL,
        staff_name TEXT NOT NULL,
        shift_id INTEGER,
        tension TEXT,
        wear_level INTEGER,
        edge_wear TEXT,
        needs_repair INTEGER DEFAULT 0,
        repair_notes TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (drum_id) REFERENCES drums(id),
        FOREIGN KEY (shift_id) REFERENCES shifts(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS maintenance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drum_id INTEGER NOT NULL,
        staff_name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        skin_replaced INTEGER DEFAULT 0,
        new_skin_id INTEGER,
        need_reinspection INTEGER DEFAULT 0,
        reinspected INTEGER DEFAULT 0,
        reinspection_date DATETIME,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (drum_id) REFERENCES drums(id),
        FOREIGN KEY (new_skin_id) REFERENCES drum_skins(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS deactivation_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drum_id INTEGER NOT NULL,
        staff_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        approved INTEGER DEFAULT 0,
        approved_by TEXT,
        approved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (drum_id) REFERENCES drums(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS extension_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usage_record_id INTEGER NOT NULL,
        drum_id INTEGER NOT NULL,
        staff_name TEXT NOT NULL,
        extension_hours INTEGER NOT NULL,
        reason TEXT NOT NULL,
        original_expected_return_time DATETIME NOT NULL,
        new_expected_return_time DATETIME,
        approval_status TEXT DEFAULT 'pending',
        approved_by TEXT,
        approved_at DATETIME,
        approval_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usage_record_id) REFERENCES usage_records(id),
        FOREIGN KEY (drum_id) REFERENCES drums(id)
      )`);

      db.all(`SELECT name FROM sqlite_master WHERE type='table'`, (err, tables) => {
        if (err) {
          reject(err);
        } else {
          console.log('Database tables initialized:', tables.map(t => t.name));
          resolve(db);
        }
      });
    });
  });
};

module.exports = { 
  db, 
  initDatabase,
  runQuery,
  getQuery,
  getOne,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  withTransaction,
  VALID_STATUSES,
  isValidStatus,
  validatePositiveInteger,
  validateRequiredString,
  validateWearLevel,
  getCurrentTimeISO
};
