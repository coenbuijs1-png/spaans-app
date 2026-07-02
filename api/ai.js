// Vercel Serverless Function — AI-hulp voor DuoCoengo (oefeningen + uitleg).
// Zelfde beveiliging als /api/chat: Firebase ID-token verplicht, de Anthropic-key
// (env ANTHROPIC_API_KEY) blijft server-side. Twee modi:
//   mode:"zinnen" → 5 verse NL→doeltaal zinsparen (JSON) voor een lesonderwerp
//   mode:"uitleg" → korte Nederlandse uitleg waarom een antwoord fout was
const FIREBASE_API_KEY = "AIzaSyBdvFBunJqnFDN-MlNfe51Z_rqMoAd2xEs"; // publieke Firebase web-key
const AI_MODEL = process.env.AI_MODEL || "claude-haiku-4-5-20251001"; // snel & goedkoop voor oefeningen

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'ANTHROPIC_API_KEY ontbreekt in Vercel.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { idToken, mode } = body || {};

  // Alleen ingelogde gebruikers
  if (!idToken) { res.status(401).json({ error: 'Niet ingelogd.' }); return; }
  try {
    const vr = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
    });
    const vj = await vr.json();
    if (!vr.ok || !vj.users || !vj.users.length) { res.status(401).json({ error: 'Sessie ongeldig.' }); return; }
  } catch (e) { res.status(401).json({ error: 'Kon sessie niet verifiëren.' }); return; }

  async function vraagClaude(system, user, maxTokens) {
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    });
    const aj = await ar.json();
    if (!ar.ok) throw new Error((aj.error && aj.error.message) || 'AI-fout');
    return (aj.content && aj.content[0] && aj.content[0].text) || '';
  }

  try {
    if (mode === 'zinnen') {
      const taal = String(body.taal || 'Spaans').slice(0, 20);
      const onderwerp = String(body.onderwerp || '').slice(0, 120);
      const woorden = String(body.woorden || '').slice(0, 300);
      const system = 'Je maakt oefenzinnen voor een Nederlandse beginner die ' + taal + ' leert. Antwoord UITSLUITEND met geldige JSON, geen andere tekst.';
      const user = 'Lesonderwerp: "' + onderwerp + '". Bekende woorden: ' + woorden + '.\n' +
        'Maak 5 korte, natuurlijke oefenzinnen (max 8 woorden) die dit onderwerp oefenen met alleen veelvoorkomende woorden.\n' +
        'JSON-formaat: {"zinnen":[{"nl":"Nederlandse zin","doel":"' + taal + 'e vertaling"}]}';
      const tekst = await vraagClaude(system, user, 600);
      let data;
      try { data = JSON.parse(tekst.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()); }
      catch (e) { res.status(502).json({ error: 'AI gaf geen geldige JSON.' }); return; }
      const zinnen = (data.zinnen || []).filter(z => z && z.nl && z.doel).slice(0, 6)
        .map(z => ({ nl: String(z.nl).slice(0, 120), doel: String(z.doel).slice(0, 120) }));
      res.status(200).json({ zinnen });
    } else if (mode === 'uitleg') {
      const taal = String(body.taal || 'Spaans').slice(0, 20);
      const vraag = String(body.vraag || '').slice(0, 200);
      const antwoord = String(body.antwoord || '').slice(0, 200);
      const juist = String(body.juist || '').slice(0, 200);
      const system = 'Je bent een vriendelijke ' + taal + '-docent voor Nederlanders. Leg in maximaal 3 korte zinnen in het Nederlands uit. Wees bemoedigend en concreet.';
      const user = 'Opgave: "' + vraag + '". De student antwoordde: "' + antwoord + '". Het juiste antwoord is: "' + juist + '". Leg kort uit waarom het juiste antwoord klopt en wat het verschil is met het antwoord van de student.';
      const tekst = await vraagClaude(system, user, 250);
      res.status(200).json({ tekst: tekst.trim() });
    } else {
      res.status(400).json({ error: 'Onbekende mode.' });
    }
  } catch (e) {
    res.status(502).json({ error: String(e.message || 'AI niet bereikbaar').slice(0, 200) });
  }
};
