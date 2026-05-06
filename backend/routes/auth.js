const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register/consumer  — open registration for consumers
router.post('/register/consumer', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'username, email and password are required' });

    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'consumer')
       RETURNING id, username, email, role, created_at`,
      [username.toLowerCase().trim(), email.toLowerCase().trim(), hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.code === '23505') {
      const field = err.detail?.includes('username') ? 'username' : 'email';
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/register/creator — gated by secret key (no public enrolment)
router.post('/register/creator', async (req, res) => {
  try {
    const { username, email, password, creatorSecret } = req.body;
    if (creatorSecret !== process.env.CREATOR_REGISTRATION_SECRET)
      return res.status(403).json({ error: 'Invalid creator registration key' });

    if (!username || !email || !password)
      return res.status(400).json({ error: 'username, email and password are required' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'creator')
       RETURNING id, username, email, role, created_at`,
      [username.toLowerCase().trim(), email.toLowerCase().trim(), hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.code === '23505') {
      const field = err.detail?.includes('username') ? 'username' : 'email';
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required' });

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase().trim()]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const { password_hash, ...safeUser } = user;
    res.json({ token: signToken(safeUser), user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, role, avatar_url, bio, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
