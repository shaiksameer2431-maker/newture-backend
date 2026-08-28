import crypto from 'crypto';
import { getDb } from './db.js';

function parseJsonFields(row, table) {
  if (!row) return row;
  const copy = { ...row };
  const jsonFields = {
    support_tickets: ['notification_channels'],
    rules: ['related_questions'],
    feedback: [],
    notices: [],
  };
  const fields = jsonFields[table] || [];
  for (const field of fields) {
    if (copy[field] && typeof copy[field] === 'string') {
      try {
        copy[field] = JSON.parse(copy[field]);
      } catch {
        // keep as string
      }
    }
  }
  if (copy.user_notified !== undefined) copy.user_notified = !!copy.user_notified;
  if (copy.fallback_triggered !== undefined) copy.fallback_triggered = !!copy.fallback_triggered;
  if (copy.is_admin !== undefined) copy.is_admin = !!copy.is_admin;
  if (copy.is_pinned !== undefined) copy.is_pinned = !!copy.is_pinned;
  if (copy.is_read !== undefined) copy.is_read = !!copy.is_read;
  if (copy.is_scheduled_sync !== undefined) copy.is_scheduled_sync = !!copy.is_scheduled_sync;
  return copy;
}

function serializeValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function getPrimaryKey(table) {
  if (table === 'students') return 'reg_no';
  if (table === 'audit_log') return 'id';
  return 'id';
}

class SQLiteQueryBuilder {
  constructor(table) {
    this.table = table;
    this.db = getDb();
    this.operation = 'select';
    this.selectCols = '*';
    this.filters = [];
    this.orderBy = null;
    this.limitVal = null;
    this.single = false;
    this.payload = null;
  }

  select(cols = '*') {
    this.selectCols = cols;
    return this;
  }

  eq(field, value) {
    this.filters.push({ type: 'eq', field, value });
    return this;
  }

  neq(field, value) {
    this.filters.push({ type: 'neq', field, value });
    return this;
  }

  ilike(field, pattern) {
    this.filters.push({ type: 'ilike', field, value: pattern });
    return this;
  }

  order(field, options = {}) {
    this.orderBy = { field, ascending: options.ascending !== false };
    return this;
  }

  limit(n) {
    this.limitVal = n;
    return this;
  }

  single() {
    this.single = true;
    return this;
  }

  insert(rows) {
    this.operation = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows) {
    this.operation = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(data) {
    this.operation = 'update';
    this.payload = data;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  buildWhere() {
    const clauses = [];
    const params = [];
    for (const f of this.filters) {
      if (f.type === 'eq') {
        clauses.push(`${f.field} = ?`);
        params.push(f.value);
      } else if (f.type === 'neq') {
        clauses.push(`${f.field} != ?`);
        params.push(f.value);
      } else if (f.type === 'ilike') {
        const pattern = String(f.value).replace(/%/g, '');
        clauses.push(`${f.field} LIKE ? COLLATE NOCASE`);
        params.push(`%${pattern}%`);
      }
    }
    return {
      sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  executeSelect() {
    const { sql: whereSql, params } = this.buildWhere();
    let sql = `SELECT ${this.selectCols} FROM ${this.table}${whereSql}`;
    if (this.orderBy) {
      sql += ` ORDER BY ${this.orderBy.field} ${this.orderBy.ascending ? 'ASC' : 'DESC'}`;
    }
    if (this.limitVal != null) {
      sql += ` LIMIT ${Number(this.limitVal)}`;
    }

    const rows = this.db.prepare(sql).all(...params).map((row) => parseJsonFields(row, this.table));
    if (this.single) {
      return { data: rows[0] || null, error: rows[0] ? null : { message: 'No rows found' } };
    }
    return { data: rows, error: null };
  }

  executeInsert() {
    const results = [];
    const pk = getPrimaryKey(this.table);
    for (const row of this.payload) {
      const data = { ...row };
      if (!data[pk] && pk === 'id') data[pk] = crypto.randomUUID();
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      const values = keys.map((k) => serializeValue(data[k]));
      const sql = `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
      try {
        this.db.prepare(sql).run(...values);
        const inserted = this.db.prepare(`SELECT * FROM ${this.table} WHERE ${pk} = ?`).get(data[pk]);
        results.push(parseJsonFields(inserted, this.table));
      } catch (error) {
        return { data: null, error: { message: error.message, code: 'SQLITE_ERROR' } };
      }
    }
    return { data: results, error: null };
  }

  executeUpsert() {
    const results = [];
    const pk = getPrimaryKey(this.table);
    for (const row of this.payload) {
      const data = { ...row };
      if (!data[pk] && pk !== 'reg_no' && pk === 'id') {
        data[pk] = crypto.randomUUID();
      }
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      const values = keys.map((k) => serializeValue(data[k]));
      const placeholders = keys.map(() => '?').join(', ');
      const updates = keys.filter((k) => k !== pk).map((k) => `${k} = excluded.${k}`).join(', ');
      const sql = `
        INSERT INTO ${this.table} (${keys.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT(${pk}) DO UPDATE SET ${updates || `${pk} = excluded.${pk}`}
      `;
      try {
        this.db.prepare(sql).run(...values);
        const upserted = this.db.prepare(`SELECT * FROM ${this.table} WHERE ${pk} = ?`).get(data[pk]);
        results.push(parseJsonFields(upserted, this.table));
      } catch (error) {
        return { data: null, error: { message: error.message, code: 'SQLITE_ERROR' } };
      }
    }
    return { data: results, error: null };
  }

  executeUpdate() {
    const { sql: whereSql, params: whereParams } = this.buildWhere();
    if (!whereSql) {
      return { data: null, error: { message: 'Update requires filters', code: 'MISSING_FILTER' } };
    }
    const data = { ...this.payload };
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => serializeValue(data[k]));
    const sql = `UPDATE ${this.table} SET ${setClause}${whereSql}`;
    try {
      this.db.prepare(sql).run(...values, ...whereParams);
      const pk = getPrimaryKey(this.table);
      const idFilter = this.filters.find((f) => f.type === 'eq' && f.field === pk) ||
        this.filters.find((f) => f.type === 'eq' && f.field === 'reg_no') ||
        this.filters.find((f) => f.type === 'eq');
      const updated = idFilter
        ? this.db.prepare(`SELECT * FROM ${this.table} WHERE ${idFilter.field} = ?`).get(idFilter.value)
        : null;
      return { data: updated ? [parseJsonFields(updated, this.table)] : [], error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: 'SQLITE_ERROR' } };
    }
  }

  executeDelete() {
    const { sql: whereSql, params } = this.buildWhere();
    const sql = `DELETE FROM ${this.table}${whereSql || ''}`;
    try {
      this.db.prepare(sql).run(...params);
      return { data: [], error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: 'SQLITE_ERROR' } };
    }
  }

  run() {
    switch (this.operation) {
      case 'select':
        return this.executeSelect();
      case 'insert':
        return this.executeInsert();
      case 'upsert':
        return this.executeUpsert();
      case 'update':
        return this.executeUpdate();
      case 'delete':
        return this.executeDelete();
      default:
        return { data: null, error: { message: 'Unknown operation' } };
    }
  }
}

export function execQuery(builder) {
  return Promise.resolve().then(() => builder.run());
}

export function createSQLiteClient() {
  return {
    from(table) {
      return new SQLiteQueryBuilder(table);
    },
    auth: {
      async getUser(token) {
        try {
          const { verifyToken } = await import('./middleware/auth.js');
          const user = verifyToken(token);
          if (!user) {
            return { data: { user: null }, error: { message: 'Invalid token' } };
          }
          return { data: { user: { id: user.id, email: user.email } }, error: null };
        } catch (error) {
          return { data: { user: null }, error: { message: error.message } };
        }
      },
    },
    channel() {
      return {
        on() { return this; },
        subscribe() { return this; },
      };
    },
    removeChannel() {},
  };
}

export function getDatabaseClient() {
  return createSQLiteClient();
}
