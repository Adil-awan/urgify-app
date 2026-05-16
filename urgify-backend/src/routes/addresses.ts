import express, { Response } from 'express';
import { prisma } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all saved addresses for a user
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId as string;
  try {
    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

// Save a new address
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const { label, street, city, lat, lng } = req.body;
  const userId = req.user?.userId as string;

  if (!label || !street || !city || !lat || !lng) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const address = await prisma.address.create({
      data: { userId, label, street, city, lat, lng }
    });
    res.status(201).json(address);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save address' });
  }
});

// Delete a saved address
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId as string;
  const addressId = String(req.params.id);

  try {
    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address) return res.status(404).json({ error: 'Address not found' });
    if (address.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });

    await prisma.address.delete({ where: { id: addressId } });
    res.json({ message: 'Address deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

export default router;
