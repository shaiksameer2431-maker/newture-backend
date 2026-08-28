import { Router } from 'express';
import { loginUser, logoutUser, requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const result = loginUser(email, password);
    if (result.error) {
      return res.status(401).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    logoutUser(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
