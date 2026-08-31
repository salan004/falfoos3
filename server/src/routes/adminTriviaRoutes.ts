import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/requireAdmin';
import {
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  setVerified,
  ListQuestionsParams,
} from '../games/trivia/QuestionAdminService';
import { previewImport, commitImport, ImportRowPreview, ImportCommitResult } from '../games/trivia/TriviaImportService';

export const adminTriviaRoutes = Router();

adminTriviaRoutes.use(requireAdmin);

adminTriviaRoutes.get('/questions', (req: Request, res: Response) => {
  try {
    const params: ListQuestionsParams = {
      page: parseInt(String(req.query.page ?? '1'), 10),
      pageSize: parseInt(String(req.query.pageSize ?? '20'), 10),
      search: req.query.search as string | undefined,
      category: req.query.category as string | undefined,
      difficulty: req.query.difficulty as string | undefined,
      verified: req.query.verified !== undefined ? parseInt(String(req.query.verified), 10) : undefined,
      language: req.query.language as string | undefined,
      sort: req.query.sort as string | undefined,
      order: req.query.order as 'asc' | 'desc' | undefined,
    };

    const result = listQuestions(params);
    res.json(result);
  } catch (err) {
    console.error('[AdminTrivia] List questions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTriviaRoutes.get('/questions/:id', (req: Request, res: Response) => {
  try {
    const question = getQuestion(req.params.id);
    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    res.json({ question });
  } catch (err) {
    console.error('[AdminTrivia] Get question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTriviaRoutes.post('/questions', (req: Request, res: Response) => {
  try {
    const input = req.body as {
      question: string;
      choices: string[];
      correct_idx: number;
      category: string;
      difficulty: string;
      tags?: string[];
      source?: string;
      verified?: number;
      language?: string;
    };

    if (!input || typeof input !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const result = createQuestion(input);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(201).json(result);
  } catch (err) {
    console.error('[AdminTrivia] Create question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTriviaRoutes.put('/questions/:id', (req: Request, res: Response) => {
  try {
    const input = req.body as {
      question?: string;
      choices?: string[];
      correct_idx?: number;
      category?: string;
      difficulty?: string;
      tags?: string[];
      source?: string;
      verified?: number;
      language?: string;
    };

    if (!input || typeof input !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const result = updateQuestion(req.params.id, input);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error('[AdminTrivia] Update question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTriviaRoutes.delete('/questions/:id', (req: Request, res: Response) => {
  try {
    const result = deleteQuestion(req.params.id);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  } catch (err) {
    console.error('[AdminTrivia] Delete question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTriviaRoutes.patch('/questions/:id/verify', (req: Request, res: Response) => {
  try {
    const verified = req.body?.verified;
    if (verified !== 0 && verified !== 1) {
      res.status(400).json({ error: 'verified must be 0 or 1' });
      return;
    }

    const result = setVerified(req.params.id, verified);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error('[AdminTrivia] Verify question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTriviaRoutes.post('/questions/import/preview', (req: Request, res: Response) => {
  try {
    if (!req.is('multipart/form-data')) {
      res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
      return;
    }

    const contentType = req.headers['content-type'] ?? '';
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > 1024 * 1024) {
      res.status(413).json({ error: 'File too large. Maximum 1 MB.' });
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fileContent = buffer.toString('utf8');
        const mimeType = contentType.split(';')[0].trim();

        const result = previewImport(fileContent, mimeType);
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid file';
        res.status(400).json({ error: message });
      }
    });
  } catch (err) {
    console.error('[AdminTrivia] Import preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTriviaRoutes.post('/questions/import/commit', (req: Request, res: Response) => {
  try {
    const rows = req.body?.rows as ImportRowPreview[];
    if (!Array.isArray(rows)) {
      res.status(400).json({ error: 'rows array is required' });
      return;
    }

    const result: ImportCommitResult = commitImport(rows);
    res.json(result);
  } catch (err) {
    console.error('[AdminTrivia] Import commit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});