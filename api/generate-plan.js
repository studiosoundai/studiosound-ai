export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { projectName, releaseDate, genre, careerStage, city, details } = req.body;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert music marketing strategist specializing in independent artist release campaigns. Generate detailed, actionable release plans.`
          },
          {
            role: 'user',
            content: `Create a detailed 30-day release plan for an independent music artist with these details:
- Project Name: ${projectName}
- Release Date: ${releaseDate}
- Genre: ${genre}
- Career Stage: ${careerStage}
- City: ${city}
- Additional Details: ${details || 'None provided'}

Return ONLY a JSON array of timeline items. Each item must have these exact fields:
- "date": specific date or time reference (e.g. "June 15, 2026" or "4 weeks out")
- "task": short action title
- "detail": specific actionable details including platform names, best posting times for their city timezone, genre-specific tips

Return exactly 8 timeline items covering pre-release through post-release. Format as valid JSON array only, no other text.`
          }
        ],
        max_tokens: 1500
      })
    });
    const data = await response.json();
    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }
    const content = data.choices[0].message.content;
    const timeline = JSON.parse(content);
    return res.status(200).json({ timeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}