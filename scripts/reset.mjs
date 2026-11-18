const PORT = process.env.PORT || 7822;
const r = await fetch(`http://127.0.0.1:${PORT}/api/reset`, { method: 'POST' });
console.log(r.ok ? 'reset ok' : 'reset failed');
process.exit(r.ok ? 0 : 1);
