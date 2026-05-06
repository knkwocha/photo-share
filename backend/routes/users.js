const router = require('express').Router();
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/users/creators — list all creators (public)
router.get('/creators', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, u.bio, u.created_at,
              COUNT(p.id) as photo_count
       FROM users u
       LEFT JOIN photos p ON p.creator_id = u.id AND p.is_published = TRUE
       WHERE u.role IN ('creator','admin') AND u.is_active = TRUE
       GROUP BY u.id ORDER BY photo_count DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch creators' });
  }
});

// GET /api/users/:username — public profile
router.get('/:username', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, avatar_url, bio, role, created_at FROM users
       WHERE username = $1 AND is_active = TRUE`,
      [req.params.username.toLowerCase()]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/users/me — update own profile
router.patch('/me', authenticate, async (req, res) => {
  try {
    const { bio } = req.body;
    const result = await pool.query(
      'UPDATE users SET bio=$1, updated_at=NOW() WHERE id=$2 RETURNING id,username,email,role,bio,avatar_url',
      [bio, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// GET /api/users/me/photos — own photos (creator)
router.get('/me/photos', authenticate, requireRole('creator', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, (SELECT COUNT(*) FROM comments WHERE photo_id = p.id) as comment_count
       FROM photos p WHERE p.creator_id = $1 ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

module.exports = router;
