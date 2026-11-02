// snake_case -> camelCase cho khóa cột (chỉ nông một tầng: cột JSON giữ nguyên khóa của chính nó).
const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function camelRow(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row) || row instanceof Date) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

module.exports = { toCamel, camelRow };
