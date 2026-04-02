// ════════════════════════════════════════════
// AI service — shared API call layer
// ════════════════════════════════════════════

const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

async function _request(url, headers, body) {
  if (IS_TAURI) {
    const { invoke } = window.__TAURI__.core;
    const result = await invoke('call_ai_api', {
      url,
      headers: Object.entries(headers),
      body: JSON.stringify(body),
    });
    return JSON.parse(result);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function callClaude(history, apiKey) {
  const data = await _request(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': apiKey || '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    { model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: history }
  );
  if (data.error) throw new Error(data.error.message);
  return data.content?.map(b => b.text || '').join('') || 'No response.';
}

export async function callGPT(history, apiKey) {
  const data = await _request(
    'https://api.openai.com/v1/chat/completions',
    { Authorization: 'Bearer ' + apiKey },
    { model: 'gpt-4o', max_tokens: 1000, messages: history }
  );
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || 'No response.';
}

export async function callGemini(history, apiKey) {
  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const data = await _request(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {},
    { contents }
  );
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
}

export async function callAI(model, history, apiKey) {
  if (model === 'claude')  return callClaude(history, apiKey);
  if (model === 'gpt')     return callGPT(history, apiKey);
  if (model === 'gemini')  return callGemini(history, apiKey);
  throw new Error('Unknown AI model: ' + model);
}
