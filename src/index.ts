import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { pool, initDb } from './db';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', async (req: Request, res: Response) => {
  try {
    const dbRes = await pool.query('SELECT 1 AS ok');
    if (dbRes.rows[0]?.ok === 1) {
      res.status(200).json({ status: 'ok', database: 'connected' });
      return;
    }
    res.status(503).json({ status: 'error', database: 'unexpected response' });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.get('/users', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch users',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/users', async (req: Request, res: Response) => {
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: 'name and email are required' });
    return;
  }

  try {
    const result = await pool.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create user',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

async function startServer() {
  try {
    await initDb();
  } catch (err) {
    console.warn('Initial DB connection warning (will retry on requests):', err instanceof Error ? err.message : err);
  }

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

startServer();
