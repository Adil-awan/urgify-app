import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';
import { Role } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

const isDatabaseConnectivityError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return (
    code === 'P1001' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    message.includes('can\'t reach database server') ||
    message.includes('getaddrinfo')
  );
};

// Register User (everyone starts as CUSTOMER)
router.post('/register', async (req, res): Promise<any> => {
  const { name, email, password } = req.body;
  console.log('Registration request received:', { name, email, passwordLength: password?.length });

  try {
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.CUSTOMER,
      },
    });

    // No worker profile created at registration anymore

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
  } catch (error: any) {
    console.error('Registration error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });
    if (isDatabaseConnectivityError(error)) {
      return res.status(503).json({
        error: 'Database is temporarily unreachable. Please check backend database settings and try again.'
      });
    }
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login User
router.post('/login', async (req, res): Promise<any> => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || (!user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
  } catch (error: any) {
    console.error('Login error:', error);
    if (isDatabaseConnectivityError(error)) {
      return res.status(503).json({
        error: 'Database is temporarily unreachable. Please check backend database settings and try again.'
      });
    }
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Upgrade to Worker (Opt-in flow)
router.post('/upgrade-to-worker', authenticateToken, async (req: any, res: Response): Promise<any> => {
  const userId = req.user.userId;
  const { phone, photoUrl, skills, certificates, cnicFrontUrl, cnicBackUrl } = req.body;

  try {
    console.log('Upgrading user to worker:', userId);

    // Update basic user info (phone and photo if provided)
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        role: Role.WORKER,
        phone: phone || undefined,
        photoUrl: photoUrl || undefined
      }
    });

    console.log('User role updated to WORKER. Now upserting worker profile...');

    // Initialize or update worker profile
    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        skills: skills || [],
        certificates: certificates || [],
        cnicFrontUrl: cnicFrontUrl || null,
        cnicBackUrl: cnicBackUrl || null,
        isVerified: false
      },
      create: {
        userId,
        skills: skills || [],
        certificates: certificates || [],
        cnicFrontUrl: cnicFrontUrl || null,
        cnicBackUrl: cnicBackUrl || null,
        accountExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days trial for new workers
      }
    });

    console.log('Worker profile created/updated successfully.');

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Successfully upgraded to Worker role',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        photoUrl: user.photoUrl
      },
      token
    });
  } catch (error: any) {
    console.error('Upgrade Error Details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });

    // Check for specific Prisma errors
    let errorMsg = 'Failed to upgrade to Worker';
    if (isDatabaseConnectivityError(error)) {
      errorMsg = 'Database is temporarily unreachable. Please check backend database settings and try again.';
    }
    if (error.code === 'P2002') errorMsg = 'A worker profile already exists for this user.';
    if (error.code === 'P2025') errorMsg = 'User not found in the database.';

    res.status(500).json({
      error: errorMsg,
      details: error.message
    });
  }
});

// Get current user profile with worker details
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        workerProfile: {
          include: { portfolio: true }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Exclude password
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update profile details
router.put('/profile', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const { phone, photoUrl, skills, certificates } = req.body;

  try {
    // 1. Update basic User info (Phone, Photo)
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        phone: phone || undefined,
        photoUrl: photoUrl || undefined
      }
    });

    // 2. If worker, update WorkerProfile (Skills, Certificates)
    if (updatedUser.role === Role.WORKER) {
      await prisma.workerProfile.update({
        where: { userId },
        data: {
          skills: skills || undefined,
          certificates: certificates || undefined
          // CNIC and Verification status remain untouched here
        }
      });
    }

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    console.error('[ProfileUpdate] Error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update the user's push notification token
router.put('/push-token', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const { pushToken } = req.body;
  const userId = req.user?.userId;

  if (!pushToken) return res.status(400).json({ error: 'Push token is required' });

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: pushToken }
    });
    res.json({ message: 'Push token updated successfully' });
  } catch (error) {
    console.error('[PushTokenUpdate] Error:', error);
    res.status(500).json({ error: 'Failed to update push token' });
  }
});

export default router;
