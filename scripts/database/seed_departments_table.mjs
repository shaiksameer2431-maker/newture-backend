import { getDb } from '../../src/database/db.js';
import crypto from 'node:crypto';

const db = getDb();

const depts = [
  { code: 'CSE', name: 'Computer Science and Engineering', hod: 'Dr. C. Rajendra', contact_number: '0861-2313842', email: 'hodcse@necn.ac.in', location: 'CSE Block, NECN' },
  { code: 'ECE', name: 'Electronics and Communication Engineering', hod: 'Dr. K. Murali', contact_number: '0861-2313842', email: 'hodece@necn.ac.in', location: 'ECE Block, NECN' },
  { code: 'EEE', name: 'Electrical and Electronics Engineering', hod: 'Dr. G. Venkateswarlu', contact_number: '0861-2313842', email: 'hodeee@necn.ac.in', location: 'EEE Block, NECN' },
  { code: 'MECH', name: 'Mechanical Engineering', hod: 'Dr. B. V. Krishnaiah', contact_number: '0861-2313842', email: 'hodmech@necn.ac.in', location: 'Mechanical Block, NECN' },
  { code: 'CIVIL', name: 'Civil Engineering', hod: 'Dr. K. Yugandhara Reddy', contact_number: '0861-2313842', email: 'hodcivil@necn.ac.in', location: 'Civil Block, NECN' },
  { code: 'MCA', name: 'Master of Computer Applications', hod: 'Dr. A. V. S. S. Subba Rao', contact_number: '0861-2313842', email: 'hodmca@necn.ac.in', location: 'PG Block, NECN' },
  { code: 'MBA', name: 'Master of Business Administration', hod: 'Dr. V. V. Giri', contact_number: '0861-2313842', email: 'hodmba@necn.ac.in', location: 'PG Block, NECN' },
  { code: 'FED', name: 'Freshman Engineering Department', hod: 'Dr. O. Suneel Kumar', contact_number: '0861-2313842', email: 'hodfed@necn.ac.in', location: 'FED Block, NECN' }
];

const delStmt = db.prepare(`DELETE FROM departments WHERE upper(code) = ?`);
const insStmt = db.prepare(`
  INSERT INTO departments (id, code, name, hod, contact_number, email, location, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

for (const d of depts) {
  delStmt.run(d.code);
  insStmt.run(crypto.randomUUID(), d.code, d.name, d.hod, d.contact_number, d.email, d.location);
}

console.log('Successfully populated official NECN department records in SQLite!');
