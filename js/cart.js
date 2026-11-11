// Local cart: one row is one concrete court/date/start slot; quantity is always one.
(() => {
  const KEY = 'ggo.cart';
  const read = (storage = globalThis.localStorage) => {
    try {
      const raw = storage.getItem(KEY);
      const rows = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows)) return [];
      return rows.filter((r) => r && Number.isInteger(Number(r.venueId)) && Number.isInteger(Number(r.courtId)) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{2}:\d{2}$/.test(r.start))
        .map(({ venueId, courtId, date, start }) => ({ venueId: Number(venueId), courtId: Number(courtId), date, start }));
    } catch { return []; }
  };
  const saveCart = (rows, storage = globalThis.localStorage) => {
    try { storage.setItem(KEY, JSON.stringify(Array.isArray(rows) ? rows : [])); } catch { /* storage may be unavailable */ }
    globalThis.dispatchEvent?.(new Event('ggo-cart-change'));
    return read(storage);
  };
  const loadCart = (storage) => read(storage);
  const same = (a, b) => Number(a.venueId) === Number(b.venueId) && Number(a.courtId) === Number(b.courtId) && a.date === b.date && a.start === b.start;
  const addCart = (item) => {
    const rows = read();
    if (rows.some((r) => same(r, item))) return false;
    saveCart([...rows, { venueId: Number(item.venueId), courtId: Number(item.courtId), date: item.date, start: item.start }]);
    return true;
  };
  const removeCart = (item) => saveCart(read().filter((r) => !same(r, item)));
  const countCart = (rows = read()) => rows.length;
  const totalCart = (rows, prices) => rows.reduce((sum, r) => sum + (Number(prices.get(JSON.stringify([r.venueId, r.courtId, r.date, r.start]))) || 0), 0);
  globalThis.GgoCart = { KEY, saveCart, loadCart, addCart, removeCart, countCart, totalCart, same };
})();
