// AI router: every task has an ordered list of free providers. If one fails (daily limit,
// overload, timeout), the next is tried automatically. Order can be changed in .env.
const cloudflare = require('./cloudflare');
const groq = require('./groq');
const huggingface = require('./huggingface');

const PROVIDERS = { cloudflare, groq, huggingface };
const DEFAULT_ORDER = {
  chat: 'groq,cloudflare',          // Groq: ~1,000 requests a day per model, very fast
  vision: 'groq,cloudflare',
  embed: 'cloudflare,huggingface',  // must stay bge-m3 to match the stored index
  image: 'huggingface,cloudflare'   // HF keeps the photo's shape; Cloudflare is the backup
};

class AllProvidersFailedError extends Error {
  constructor(task, failures) {
    const allLimits = failures.length && failures.every(f => /DAILY_AI_LIMIT|RATE_LIMIT/.test(f.code || '') || /limit|quota|overload|allocation/i.test(f.message));
    super(allLimits
      ? 'The free AI allowance is used up on every provider right now. Please try again later.'
      : `No AI provider could do "${task}": ${failures.map(f => `${f.provider}: ${f.message}`).join(' | ')}`);
    this.code = allLimits ? 'DAILY_AI_LIMIT' : 'AI_UNAVAILABLE';
    this.failures = failures;
  }
}

function orderFor(task) {
  const raw = process.env[`AI_${task.toUpperCase()}_ORDER`] || DEFAULT_ORDER[task];
  return raw.split(',').map(s => s.trim()).filter(name => PROVIDERS[name]?.[task === 'image' ? 'editImage' : task] && PROVIDERS[name].isConfigured());
}

const lastProvider = {};

async function run(task, fn) {
  const order = orderFor(task);
  if (!order.length) throw new AllProvidersFailedError(task, [{ provider: 'none', message: 'no provider configured' }]);
  const failures = [];
  for (const name of order) {
    try {
      const result = await fn(PROVIDERS[name]);
      if (failures.length) console.log(`[AI] ${task}: used ${name} after ${failures.map(f => f.provider).join(', ')} failed`);
      lastProvider[task] = name;
      return result;
    } catch (err) {
      console.warn(`[AI] ${task} via ${name} failed: ${err.message}`);
      failures.push({ provider: name, code: err.code, message: err.message });
    }
  }
  throw new AllProvidersFailedError(task, failures);
}

module.exports = {
  MODELS: cloudflare.MODELS,
  cosine: cloudflare.cosine,
  toJpeg: cloudflare.toJpeg,
  DailyLimitError: cloudflare.DailyLimitError,
  MissingCredentialsError: cloudflare.MissingCredentialsError,
  AllProvidersFailedError,
  lastProvider,
  orderFor,
  isConfigured: () => ['chat', 'vision', 'image'].every(t => orderFor(t).length > 0),
  status: () => Object.fromEntries(Object.keys(DEFAULT_ORDER).map(t => [t, orderFor(t)])),

  // `fast: true` asks for the cheapest model (used for simple yes/no checks)
  chat: (messages, opts = {}) => run('chat', p => p.chat(messages, p === cloudflare && opts.fast ? { ...opts, model: cloudflare.MODELS.fast } : opts)),
  vision: (image, instruction, opts) => run('vision', p => p.vision(image, instruction, opts)),
  embed: texts => run('embed', p => p.embed(texts)),
  editImage: async (prompt, images) => {
    const image = await run('image', p => p.editImage(prompt, images));
    return { image, provider: lastProvider.image };
  }
};
