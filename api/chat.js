// Vercel Serverless Function — Claude-gespreksproxy voor DuoCoengo.
// De Anthropic-key staat veilig server-side (env var ANTHROPIC_API_KEY) en komt
// NOOIT in de browser. Toegang is beveiligd met een Firebase ID-token, zodat
// alleen ingelogde gebruikers de (betaalde) AI kunnen aanroepen.
const FIREBASE_API_KEY = "AIzaSyBdvFBunJqnFDN-MlNfe51Z_rqMoAd2xEs"; // publieke Firebase web-key (mag publiek zijn)
// Haiku 4.5: snel, goedkoop en bewezen werkend op deze key (zelfde als /api/ai).
// Via de env-var CHAT_MODEL is een zwaarder model in te stellen zonder code-wijziging.
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-haiku-4-5-20251001";

module.exports = async function handler(req, res) {
  // CORS — de app kan draaien vanaf Vercel, GitHub Pages of als geïnstalleerde PWA.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'Server niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in Vercel.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { idToken, system, messages } = body || {};

  // 1) Verifieer het Firebase ID-token (alleen ingelogde gebruikers).
  if (!idToken) { res.status(401).json({ error: 'Niet ingelogd.' }); return; }
  try {
    const vr = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    const vj = await vr.json();
    if (!vr.ok || !vj.users || !vj.users.length) { res.status(401).json({ error: 'Sessie ongeldig — log opnieuw in.' }); return; }
  } catch (e) { res.status(401).json({ error: 'Kon sessie niet verifiëren.' }); return; }

  // 2) Valideer en begrens de invoer.
  if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: 'Geen berichten.' }); return; }
  const safeMessages = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, 2000)
  }));
  const safeSystem = String(system || '').slice(0, 4000);

  // 3) Roep Claude aan met de server-side key.
  try {
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CHAT_MODEL, max_tokens: 320, system: safeSystem, messages: safeMessages })
    });
    const aj = await ar.json();
    if (!ar.ok) { res.status(502).json({ error: (aj.error && aj.error.message) || 'AI-fout', model: CHAT_MODEL }); return; }
    const text = (aj.content && aj.content[0] && aj.content[0].text) || '';
    res.status(200).json({ text });
  } catch (e) {
    res.status(502).json({ error: 'Kon de AI niet bereiken.' });
  }
};
