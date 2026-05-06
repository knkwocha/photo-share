const router = require('express').Router({ mergeParams: true });
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

// Simple client-side sentiment: analyse word lists
function simpleSentiment(text) {
  const positive = ['love', 'great', 'amazing', 'beautiful', 'awesome', 'fantastic', 'excellent', 'wonderful', 'brilliant', 'stunning', 'gorgeous', 'perfect', 'brilliant'];
  const negative = ['hate', 'terrible', 'awful', 'bad', 'ugly', 'horrible', 'disgusting', 'boring', 'dull', 'poor', 'worst'];
  const lower = text.toLowerCase();
  const posCount = positive.filter(w => lower.includes(w)).length;
  const negCount = negative.filter(w => lower.includes(w)).length;
  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

// GET /api/photos/:photoId/comments
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.username, u.avatar_url
       FROM comments c JOIN users u ON c.user_id = u.id
       WHERE c.photo_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.photoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/photos/:photoId/comments
router.post('/', authenticate, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Comment content required' });

  try {
    const sentiment = simpleSentiment(content);
    const result = await pool.query(
      `INSERT INTO comments (photo_id, user_id, content, sentiment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, content, sentiment, created_at`,
      [req.params.photoId, req.user.id, content.trim(), sentiment]
    );
    const comment = result.rows[0];
    // Attach username for immediate display
    comment.username = req.user.username;
    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// DELETE /api/photos/:photoId/comments/:commentId
router.delete('/:commentId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM comments WHERE id = $1 AND photo_id = $2',
      [req.params.commentId, req.params.photoId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Comment not found' });
    if (result.rows[0].user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Not your comment' });

    await pool.query('DELETE FROM comments WHERE id = $1', [req.params.commentId]);
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
