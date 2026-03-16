export const toAsciiDigits = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
};

const ARABIC_NAME_STOPWORDS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'eng', 'prof',
  'استاذ', 'الاستاذ', 'د', 'دكتور', 'الدكتور', 'م', 'مهندس', 'المهندس',
  'حاج', 'الحاج', 'شيخ', 'الشيخ'
]);

export const normalizeArabicName = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u061C]/g, '')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ؤئ]/g, (char) => (char === 'ؤ' ? 'و' : 'ي'))
    .replace(/ة/g, 'ه')
    .replace(/[^\d a-zA-Z\u0600-\u06FF\s]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const getTokenVariants = (token) => {
  const variants = new Set();
  if (!token) return variants;
  variants.add(token);
  if (token.startsWith('ال') && token.length > 4) {
    variants.add(token.slice(2));
  }
  if (token.endsWith('ه') && token.length > 2) {
    variants.add(`${token.slice(0, -1)}ة`);
  }
  if (token.endsWith('ة') && token.length > 2) {
    variants.add(`${token.slice(0, -1)}ه`);
  }
  return variants;
};

const tokenizeName = (value) => {
  const normalized = normalizeArabicName(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .filter((token) => token.length >= 2 && !ARABIC_NAME_STOPWORDS.has(token));
};

const levenshteinDistance = (a, b) => {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
};

const tokenSimilarity = (tokenA, tokenB) => {
  if (!tokenA || !tokenB) return 0;
  if (tokenA === tokenB) return 1;
  const variantsA = getTokenVariants(tokenA);
  const variantsB = getTokenVariants(tokenB);
  for (const variant of variantsA) {
    if (variantsB.has(variant)) return 0.97;
  }

  const minLen = Math.min(tokenA.length, tokenB.length);
  if (minLen >= 3 && (tokenA.startsWith(tokenB) || tokenB.startsWith(tokenA))) {
    return minLen >= 4 ? 0.91 : 0.87;
  }

  const distance = levenshteinDistance(tokenA, tokenB);
  const maxLen = Math.max(tokenA.length, tokenB.length);
  const normalizedDistance = 1 - (distance / maxLen);
  const minAccepted = maxLen >= 6 ? 0.56 : 0.67;
  return normalizedDistance >= minAccepted ? normalizedDistance : 0;
};

export const scoreNameMatch = (inputName, candidateName) => {
  const inputTokens = tokenizeName(inputName);
  const candidateTokens = tokenizeName(candidateName);
  if (!inputTokens.length || !candidateTokens.length) {
    return {
      score: 0,
      firstNameScore: 0,
      inputCoverage: 0,
      candidateCoverage: 0,
      fullNameScore: 0,
      orderScore: 0
    };
  }

  const usedCandidateIndexes = new Set();
  const matchedIndexPairs = [];
  let inputTokenScoreSum = 0;
  for (let inputIdx = 0; inputIdx < inputTokens.length; inputIdx += 1) {
    const token = inputTokens[inputIdx];
    let bestSim = 0;
    let bestIdx = -1;
    for (let idx = 0; idx < candidateTokens.length; idx += 1) {
      if (usedCandidateIndexes.has(idx)) continue;
      const sim = tokenSimilarity(token, candidateTokens[idx]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = idx;
      }
    }
    if (bestIdx >= 0 && bestSim > 0) {
      usedCandidateIndexes.add(bestIdx);
      inputTokenScoreSum += bestSim;
      matchedIndexPairs.push([inputIdx, bestIdx]);
    }
  }

  let candidateCoverageSum = 0;
  for (const candidateToken of candidateTokens) {
    let best = 0;
    for (const inputToken of inputTokens) {
      const sim = tokenSimilarity(candidateToken, inputToken);
      if (sim > best) best = sim;
    }
    candidateCoverageSum += best;
  }

  const inputCoverage = inputTokenScoreSum / inputTokens.length;
  const candidateCoverage = candidateCoverageSum / candidateTokens.length;
  const firstNameScore = tokenSimilarity(inputTokens[0], candidateTokens[0]);
  const normalizedInput = inputTokens.join(' ');
  const normalizedCandidate = candidateTokens.join(' ');
  const fullNameDistance = levenshteinDistance(normalizedInput, normalizedCandidate);
  const fullNameScore = Math.max(
    0,
    1 - (fullNameDistance / Math.max(normalizedInput.length, normalizedCandidate.length))
  );
  const inOrderMatches = matchedIndexPairs.filter(([inputIdx, candidateIdx], pairIdx, pairs) => {
    if (pairIdx === 0) return true;
    return inputIdx >= pairs[pairIdx - 1][0] && candidateIdx >= pairs[pairIdx - 1][1];
  }).length;
  const orderScore = matchedIndexPairs.length ? inOrderMatches / matchedIndexPairs.length : 0;
  const tokenCountDeltaPenalty = Math.min(Math.abs(inputTokens.length - candidateTokens.length) * 0.03, 0.12);
  const score = Math.max(
    0,
    (firstNameScore * 0.34)
      + (inputCoverage * 0.24)
      + (candidateCoverage * 0.2)
      + (fullNameScore * 0.14)
      + (orderScore * 0.08)
      - tokenCountDeltaPenalty
  );

  return {
    score,
    firstNameScore,
    inputCoverage,
    candidateCoverage,
    fullNameScore,
    orderScore
  };
};

export const findTopUserMatches = (inputName, users, options = {}) => {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.45;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(Math.trunc(options.limit), 10)) : 3;

  const normalizedInput = normalizeArabicName(inputName);
  if (!normalizedInput || !Array.isArray(users) || !users.length) return [];

  const matches = [];

  for (const user of users) {
    const normalizedCandidate = user.normalizedName || normalizeArabicName(user.name);
    const {
      score,
      firstNameScore,
      inputCoverage,
      candidateCoverage,
      fullNameScore,
      orderScore
    } = scoreNameMatch(normalizedInput, normalizedCandidate);

    if (score >= threshold) {
      matches.push({
        id: user.id,
        name: user.name,
        score: Number(score.toFixed(4)),
        firstNameScore: Number(firstNameScore.toFixed(4)),
        inputCoverage: Number(inputCoverage.toFixed(4)),
        candidateCoverage: Number(candidateCoverage.toFixed(4)),
        fullNameScore: Number(fullNameScore.toFixed(4)),
        orderScore: Number(orderScore.toFixed(4)),
      });
    }
  }

  matches.sort((a, b) => (
    b.score - a.score
      || b.firstNameScore - a.firstNameScore
      || b.inputCoverage - a.inputCoverage
      || b.candidateCoverage - a.candidateCoverage
      || b.fullNameScore - a.fullNameScore
      || b.orderScore - a.orderScore
  ));

  return matches.slice(0, limit);
};

export const findBestUserMatch = (inputName, users, options = {}) => {
  const best = findTopUserMatches(inputName, users, { ...options, limit: 1 });
  return best[0]
    ? { id: best[0].id, name: best[0].name, score: best[0].score }
    : null;
};
