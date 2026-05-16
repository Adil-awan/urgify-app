import express, { Response } from 'express';
import { prisma } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all active categories
router.get('/', async (req, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Admin: Add or Update category
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized' });

  const { name, icon, isActive } = req.body;
  try {
    const category = await prisma.category.upsert({
      where: { name },
      update: { icon, isActive },
      create: { name, icon, isActive: isActive ?? true }
    });
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save category' });
  }
});

export default router;
