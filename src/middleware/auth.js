import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../database/db.js';
import { getJwtSecret } from '../config/index.js';

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { id: payload.id, email: payload.email, isAdmin: !!payload.isAdmin };
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header.' });
  }
  const token = authHeader.split(' ')[1];
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized session: Invalid token' });
  }
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Admin role required.' });
    }
    next();
  });
}

export function loginUser(email, password) {
  const db = getDb();
  const user = db.prepare(`
    SELECT id, email, password_hash, full_name, role, is_admin
    FROM users WHERE email = ?
  `).get(email.trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return { error: 'Invalid email or password' };
  }

  const token = signToken(user);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, datetime('now', '+7 days'), datetime('now'))
  `).run(crypto.randomUUID(), user.id, tokenHash);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      isAdmin: !!user.is_admin,
    },
  };
}

export function logoutUser(token) {
  if (!token) return;
  const db = getDb();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}
