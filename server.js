import express from 'express';
import multer from 'multer';
import cors from 'cors';
import bodyParser from 'body-parser';
import { parse } from 'csv-parse/sync';
import { Parser as Json2Csv } from 'json2csv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createModel, predictRecord, explainPrediction, summarizeDataset } from './src/model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store of last dataset for chat context
let lastDataset = [];

// Initialize local ML model (small + fast)
const model = createModel();

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, message: 'pong' });
});

app.post('/api/predict', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please attach a CSV file.' });
    }
    if (!/\.csv$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Invalid file type. Only .csv files are accepted.' });
    }

    const csvText = req.file.buffer.toString('utf8');
    const records = parse(csvText, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'CSV appears empty or has no data rows.' });
    }

    // Validate columns (Summary and/or Description may be missing per row, but at least one column must exist in header)
    const headers = Object.keys(records[0] || {});
    const hasSummaryCol = headers.some(h => h.toLowerCase() === 'summary');
    const hasDescriptionCol = headers.some(h => h.toLowerCase() === 'description');
    if (!hasSummaryCol && !hasDescriptionCol) {
      return res.status(400).json({ error: 'CSV must include at least one column: "Summary" or "Description".' });
    }

    // Predict per row
    const augmented = records.map((row, idx) => {
      const summary = row['Summary'] ?? row['summary'] ?? '';
      const description = row['Description'] ?? row['description'] ?? '';
      const text = `${summary}\n${description}`.trim();

      const result = predictRecord(model, text);
      return {
        Row: idx + 1,
        Summary: summary,
        Description: description,
        Priority: result.priority,
        StoryPoints: result.storyPoints,
        EstimateHours: result.estimateHours,
        Confidence: result.confidence,
        Rationale: result.rationale
      };
    });

    lastDataset = augmented;

    const fields = Object.keys(augmented[0] || {});
    const csv = new Json2Csv({ fields }).parse(augmented);

    res.json({
      ok: true,
      meta: { count: augmented.length },
      data: augmented,
      csv
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process CSV. Ensure it is valid and try again.' });
  }
});

// Simple local chat assistant about the latest uploaded dataset & model logic
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string' || message.trim().length < 2) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    

    // intents: stats, why row X, distribution, export, help
    const msg = message.toLowerCase();

    if (!lastDataset.length) {
      return res.json({
        reply: 'No dataset loaded yet. Please upload a CSV first. The CSV must have Summary and/or Description columns.'
      });
    }

    // Why X
    const whyMatch = msg.match(/why\s+(?:row|record|id)?\s*(\d+)/);
    if (whyMatch) {
      const idx = parseInt(whyMatch[1], 10) - 1;
      if (idx >= 0 && idx < lastDataset.length) {
        const row = lastDataset[idx];
        return res.json({ reply: explainPrediction(row) });
      }
    }

    // Distribution / counts
    if (/distribution|count|how many|breakdown|summary of priority/.test(msg)) {
      const { priorityCounts, avgStoryPoints, avgHours } = summarizeDataset(lastDataset);
      const parts = [
        `Priority counts → ${Object.entries(priorityCounts).map(([k,v]) => `${k}: ${v}`).join(', ')}`,
        `Average story points: ${avgStoryPoints.toFixed(2)}`,
        `Average hours: ${avgHours.toFixed(1)}`
      ];
      return res.json({ reply: parts.join('\n') });
    }

    if (/help|what can you do|commands|options/.test(msg)) {
      return res.json({ reply: `You can ask: \n• \"Why 5\" to explain predictions for row 5\n• \"Priority distribution\" to see counts\n• \"Average\" for averages\n• \"Top risky\" to see highest priority rows` });
    }

    if (/top risky|highest priority|critical/.test(msg)) {
      const sorted = [...lastDataset].sort((a,b) => (priorityRank(b.Priority) - priorityRank(a.Priority)) || (b.Confidence - a.Confidence));
      const top = sorted.slice(0, Math.min(5, sorted.length)).map(r => `Row ${r.Row}: ${r.Priority} (SP ${r.StoryPoints}, ~${r.EstimateHours}h)`);
      return res.json({ reply: top.join('\n') });
    }

    // Averages
    if (/average|avg/.test(msg)) {
      const { avgStoryPoints, avgHours } = summarizeDataset(lastDataset);
      return res.json({ reply: `Average story points: ${avgStoryPoints.toFixed(2)} | Average hours: ${avgHours.toFixed(1)}` });
    }

    // Default fallback: echo helpful tip
    return res.json({ reply: 'I can help with distribution, averages, and explaining rows. Try: "Why 1" or "Priority distribution".' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chat failed. Try again.' });
  }
});

app.post("/api/clear", (req, res) => {
  lastDataset = [];
  res.json({ success: true, message: "Dataset cleared" });
});

// Helper for chat sorting
function priorityRank(p) {
  const order = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  return order[p] || 0;
}

// Serve app
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});