import natural from 'natural';

// Tiny local ML using Naive Bayes + TF-IDF-like scoring. No external downloads.
// We "train" with curated seed phrases to keep the model small and portable.

const tokenizer = new natural.WordPunctTokenizer();
const stopwords = new Set(['the','a','an','and','or','but','to','of','in','on','for','with','by','at','is','are','be','this','that','it','as','from','into','via','over','under','we','i','you']);

function clean(text = '') {
  const lower = (text || '').toLowerCase();
  const tokens = tokenizer.tokenize(lower)
    .filter(t => /[a-z0-9#]+/.test(t))
    .filter(t => !stopwords.has(t));
  return tokens.join(' ');
}

function seeds() {
  return {
    Critical: [
      'production outage critical sev1 service down multiple customers cannot login 500 error',
      'security breach data leak pii exposed urgent incident',
      'payment gateway failing checkout blocked revenue impact',
      'data loss corruption cannot recover backups failing',
      'deadlock crash on startup app unusable after update'
    ],
    High: [
      'performance degradation slow response timeout frequent errors spike',
      'api failing intermittently flaky retries required',
      'priority customer blocked cannot complete workflow',
      'migration deadline approaching key dependency broken',
      'compliance issue needs fix before release'
    ],
    Medium: [
      'feature enhancement add filter sorting column',
      'ui bug misaligned button typography issue minor',
      'edge case validation error specific inputs',
      'refactor module cleanup improve maintainability',
      'add logging metrics monitoring'
    ],
    Low: [
      'cosmetic request color change microcopy tweak',
      'documentation update readme faq add examples',
      'typo fix grammar correction',
      'small improvement non urgent backlog',
      'developer tooling dx polish'
    ]
  };
}

function trainPriorityClassifier() {
  const classifier = new natural.BayesClassifier();
  const s = seeds();
  Object.entries(s).forEach(([label, arr]) => {
    arr.forEach(txt => classifier.addDocument(clean(txt), label));
  });
  classifier.train();
  return classifier;
}

// Heuristic story points mapping using length + risk keywords
const fib = [1,2,3,5,8,13];
const complexityKeywords = {
  tiny: ['typo','copy','text','docs','readme','color','padding','icon'],
  small: ['validation','minor','ui','tooltip','css','logging','small','refactor'],
  medium: ['api','schema','cache','queue','oauth','retry','pagination','migration','feature'],
  large: ['payment','encryption','security','outage','deadlock','data loss','race condition','recovery','multi-tenant','compliance']
};

function scoreComplexity(text) {
  const t = clean(text);
  const len = Math.max(1, t.split(' ').length);
  let score = Math.min(1, len / 120); // 0..1 by length
  const addIf = (list, w) => list.forEach(k => { if (t.includes(k)) score += w; });
  addIf(complexityKeywords.tiny, -0.2);
  addIf(complexityKeywords.small, 0.05);
  addIf(complexityKeywords.medium, 0.15);
  addIf(complexityKeywords.large, 0.35);
  return Math.max(0, Math.min(1.5, score));
}

function toFib(score) {
  // Map 0..1.5 to Fibonacci buckets
  const thresholds = [0.15, 0.3, 0.5, 0.8, 1.1, 1.5];
  for (let i=0;i<thresholds.length;i++) {
    if (score <= thresholds[i]) return fib[i];
  }
  return 13;
}

function estimateHoursFn(points, text) {
  // Base mapping with adjustments by risk/time words
  const base = {1:4, 2:6, 3:8, 5:16, 8:32, 13:56};
  let hours = base[points] || 8;
  const t = clean(text);
  if (/spike|investigate|unknown|legacy|undocumented/.test(t)) hours *= 1.3;
  if (/well-defined|simple|trivial|straightforward/.test(t)) hours *= 0.8;
  if (/cross-team|multiple services|coordination|dependency/.test(t)) hours *= 1.25;
  return Math.round(hours);
}

export function createModel() {
  const classifier = trainPriorityClassifier();
  return { classifier };
}

export function predictRecord(model, text) {
  const content = clean(text || '');
  if (!content) {
    // If both Summary & Description are missing, fall back to lowest reasonable estimates
    return {
      priority: 'Low',
      storyPoints: 1,
      estimateHours: 4,
      confidence: 0.4,
      rationale: 'No text provided. Falling back to conservative defaults.'
    };
  }

  let priority = 'Medium';
  let confidence = 0.6;

  try {
    const classifications = model.classifier.getClassifications(content);
    // classifications is sorted highest first in natural
    if (classifications && classifications.length) {
      priority = classifications[0].label;
      const top = classifications[0].value;
      const second = classifications[1]?.value || 1e-9;
      confidence = Math.max(0.5, Math.min(0.99, (top / (top + second))));
    }
  } catch (e) {
    // noop, keep defaults
  }

  // Keyword overrides for obvious emergencies
  const raw = (text || '').toLowerCase();
  if (/sev1|p0|outage|down|cannot login|payment failed|data loss|security|breach/.test(raw)) {
    priority = 'Critical';
    confidence = Math.max(confidence, 0.85);
  }

  const cScore = scoreComplexity(text || '');
  const storyPoints = toFib(cScore);
  const estimateHours = estimateHoursFn(storyPoints, text || '');
  

  const rationale = buildRationale(priority, storyPoints, estimateHours, raw);

  return { priority, storyPoints, estimateHours, confidence: Number(confidence.toFixed(2)), rationale };
}

function buildRationale(priority, sp, hours, raw) {
  const cues = [];
  if (/outage|down|unreachable/.test(raw)) cues.push('service outage');
  if (/security|breach|encryption/.test(raw)) cues.push('security risk');
  if (/payment|checkout/.test(raw)) cues.push('revenue impact');
  if (/typo|copy|color|css/.test(raw)) cues.push('cosmetic');
  if (/migration|schema|api|integration/.test(raw)) cues.push('system integration');
  return `Priority ${priority} based on cues: ${cues.join(', ') || 'general classification'}. Story Points ~${sp}, Est ~${hours}h.`;
}

export function explainPrediction(row) {
  return `Row ${row.Row}: Priority ${row.Priority} (confidence ${row.Confidence}). ${row.Rationale}`;
}

export function summarizeDataset(data) {
  const priorityCounts = data.reduce((acc, r) => { acc[r.Priority] = (acc[r.Priority]||0)+1; return acc; }, {});
  const avg = (arr) => arr.reduce((a,b)=>a+b,0) / Math.max(1, arr.length);
  const avgStoryPoints = avg(data.map(r => Number(r.StoryPoints)||0));
  const avgHours = avg(data.map(r => Number(r.EstimateHours)||0));
  return { priorityCounts, avgStoryPoints, avgHours };
}