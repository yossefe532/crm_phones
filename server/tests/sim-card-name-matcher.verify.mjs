import { findBestUserMatch, findTopUserMatches, normalizeArabicName } from '../utils/sim-card-name-matcher.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const users = [
  { id: 1, name: 'أحمد عبد الله' },
  { id: 2, name: 'احمد عبدالله' },
  { id: 3, name: 'محمود السيد' },
  { id: 4, name: 'عبدالرحمن علي' },
];

const scoredUsers = users.map((user) => ({
  ...user,
  normalizedName: normalizeArabicName(user.name),
}));

const run = () => {
  const topMatches = findTopUserMatches('أ / أحمد عبد الله ٢', scoredUsers, { threshold: 0.45, limit: 3 });
  assert(Array.isArray(topMatches), 'topMatches must be array');
  assert(topMatches.length >= 1, 'topMatches should include at least one candidate');
  assert(topMatches[0].id === 1 || topMatches[0].id === 2, 'best candidate should be أحمد عبد الله variant');
  assert(topMatches.every((m, idx) => idx === 0 || m.score <= topMatches[idx - 1].score), 'topMatches should be sorted by score desc');

  const bestMatch = findBestUserMatch('احمد عبدالله', scoredUsers, { threshold: 0.45 });
  assert(bestMatch, 'findBestUserMatch should return a match');
  assert(bestMatch.id === 1 || bestMatch.id === 2, 'findBestUserMatch should stay backward compatible');
  assert(typeof bestMatch.score === 'number', 'findBestUserMatch score should be numeric');

  const noMatch = findTopUserMatches('اسم غير موجود تماماً', scoredUsers, { threshold: 0.8, limit: 3 });
  assert(noMatch.length === 0, 'high threshold should be able to return no matches');

  console.log('SIM card name matcher verification passed.');
};

run();
