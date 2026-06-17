export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { prompt } = req.body;
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({ 
        model: 'gpt-image-1', 
        prompt: prompt,
        n: 1,
        size: '1024x1024'
      })
    });
    const text = await response.text();
    return res.status(200).json({ raw: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}