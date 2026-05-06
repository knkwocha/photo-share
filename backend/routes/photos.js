const router = require('express').Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadImageToBlob, deleteImageFromBlob, analyzeImage } = require('../config/azure');
const { cacheGet, cacheSet, cacheDel, cacheDelPattern } = require('../config/cache');

// Multer: store in memory for streaming to Azure Blob
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images are allowed'));
  },
});

// ─── POST /api/photos — Upload a photo (creator only) ────────────────────────
router.post('/', authenticate, requireRole('creator', 'admin'), upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const { title, caption, location, people_present } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const ext = path.extname(req.file.originalname) || '.jpg';
    const blobName = `${uuidv4()}${ext}`;
    const blobUrl = await uploadImageToBlob(req.file.buffer, blobName, req.file.mimetype);

    // Azure Cognitive Services: analyse image in background
    let aiData = { tags: [], description: '', isAdultContent: false, dominantColors: [] };
    try { aiData = await analyzeImage(blobUrl); } catch (_) {}

    if (aiData.isAdultContent) {
      await deleteImageFromBlob(blobName);
      return res.status(422).json({ error: 'Image rejected: adult content detected' });
    }

    const people = Array.isArray(people_present)
      ? people_present
      : people_present ? people_present.split(',').map(s => s.trim()) : [];

    const result = await pool.query(
      `INSERT INTO photos
        (creator_id, title, caption, location, people_present, blob_url, blob_name, tags, ai_description, dominant_colors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.user.id, title, caption || null, location || null, people,
       blobUrl, blobName, aiData.tags, aiData.description, aiData.dominantColors]
    );

    await cacheDelPattern('photos:list:*');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ─── GET /api/photos — List / search photos ───────────────────────────────────
router.get('/', async (req, res) => {
  const { search, tag, creator, page = 1, limit = 20, sort = 'newest' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const cacheKey = `photos:list:${JSON.stringify(req.query)}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const conditions = ['p.is_published = TRUE', 'p.is_adult_content = FALSE'];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.title ILIKE $${params.length} OR p.caption ILIKE $${params.length} OR p.location ILIKE $${params.length})`);
    }
    if (tag) {
      params.push(tag);
      conditions.push(`$${params.length} = ANY(p.tags)`);
    }
    if (creator) {
      params.push(creator);
      conditions.push(`u.username = $${params.length}`);
    }

    const orderMap = {
      newest: 'p.created_at DESC',
      oldest: 'p.created_at ASC',
      top_rated: 'p.average_rating DESC, p.rating_count DESC',
      most_viewed: 'p.view_count DESC',
    };
    const orderBy = orderMap[sort] || orderMap.newest;

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const query = `
      SELECT p.*, u.username as creator_username, u.avatar_url as creator_avatar,
             (SELECT COUNT(*) FROM comments WHERE photo_id = p.id) as comment_count
      FROM photos p
      JOIN users u ON p.creator_id = u.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const countQuery = `SELECT COUNT(*) FROM photos p JOIN users u ON p.creator_id = u.id ${where}`;
    const [rows, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params.slice(0, -2)),
    ]);

    const response = {
      photos: rows.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit)),
    };

    await cacheSet(cacheKey, response, 60); // 60-second TTL
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// ─── GET /api/photos/:id — Single photo ───────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.username as creator_username, u.avatar_url as creator_avatar,
              (SELECT COUNT(*) FROM comments WHERE photo_id = p.id) as comment_count
       FROM photos p JOIN users u ON p.creator_id = u.id
       WHERE p.id = $1 AND p.is_published = TRUE`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Photo not found' });

    // Increment view count (non-blocking)
    pool.query('UPDATE photos SET view_count = view_count + 1 WHERE id = $1', [req.params.id]).catch(() => {});

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch photo' });
  }
});

// ─── PATCH /api/photos/:id — Update metadata (creator/owner only) ─────────────
router.patch('/:id', authenticate, requireRole('creator', 'admin'), async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM photos WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Photo not found' });
    if (existing.rows[0].creator_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Not your photo' });

    const { title, caption, location, people_present } = req.body;
    const people = Array.isArray(people_present)
      ? people_present
      : people_present ? people_present.split(',').map(s => s.trim()) : existing.rows[0].people_present;

    const result = await pool.query(
      `UPDATE photos SET title=$1, caption=$2, location=$3, people_present=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [title || existing.rows[0].title, caption ?? existing.rows[0].caption,
       location ?? existing.rows[0].location, people, req.params.id]
    );
    await cacheDelPattern('photos:list:*');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ─── DELETE /api/photos/:id — Delete photo (creator/owner only) ───────────────
router.delete('/:id', authenticate, requireRole('creator', 'admin'), async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM photos WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Photo not found' });
    if (existing.rows[0].creator_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Not your photo' });

    await deleteImageFromBlob(existing.rows[0].blob_name);
    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);
    await cacheDelPattern('photos:list:*');
    res.json({ message: 'Photo deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ─── POST /api/photos/:id/rate — Rate a photo (consumer only, once) ───────────
router.post('/:id/rate', authenticate, async (req, res) => {
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'Rating must be 1–5' });

    await pool.query(
      `INSERT INTO ratings (photo_id, user_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (photo_id, user_id) DO UPDATE SET rating = $3`,
      [req.params.id, req.user.id, rating]
    );

    const result = await pool.query(
      'SELECT average_rating, rating_count FROM photos WHERE id = $1',
      [req.params.id]
    );
    await cacheDel(`photos:${req.params.id}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Rating failed' });
  }
});

module.exports = router;
