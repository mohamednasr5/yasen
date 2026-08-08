/**
 * Cloudflare Worker - OCR Document Scanner
 * Integrates with OpenRouter API using Qwen2.5-VL-7B for text extraction
 * 
 * Endpoints:
 * - POST /ocr - Process document image and extract text
 * - POST /upload - Upload to R2 (existing functionality)
 * 
 * Environment Variables (set in Cloudflare Dashboard):
 * - OPENROUTER_API_KEY: Your OpenRouter API key
 * - R2_BUCKET: R2 bucket binding (optional, for file storage)
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      // OCR Endpoint
      if (request.method === 'POST' && url.pathname === '/ocr') {
        return handleOcrRequest(request, env, corsHeaders);
      }

      // R2 Upload Endpoint (existing)
      if (request.method === 'POST' && url.pathname === '/upload') {
        return handleUploadRequest(request, env, corsHeaders);
      }

      // Health check
      if (request.method === 'GET' && url.pathname === '/health') {
        return jsonResponse({ 
          status: 'ok', 
          service: 'OCR Worker',
          endpoints: ['/ocr', '/upload', '/health']
        }, corsHeaders);
      }

      // 404 for unknown routes
      return jsonResponse({ error: 'Not found' }, { ...corsHeaders, status: 404 });

    } catch (err) {
      console.error('[Worker] Error:', err);
      return jsonResponse({ 
        error: 'Internal server error', 
        message: err.message 
      }, { ...corsHeaders, status: 500 });
    }
  }
};

/**
 * Handle OCR Request
 * Processes document image and extracts text using Qwen2.5-VL-7B
 */
async function handleOcrRequest(request, env, corsHeaders) {
  // Check for API key
  if (!env.OPENROUTER_API_KEY) {
    return jsonResponse({
      success: false,
      error: 'OpenRouter API key not configured'
    }, { ...corsHeaders, status: 500 });
  }

  // Parse form data
  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return jsonResponse({
      success: false,
      error: 'Invalid form data'
    }, { ...corsHeaders, status: 400 });
  }

  const file = formData.get('file');
  
  if (!file) {
    return jsonResponse({
      success: false,
      error: 'No file provided'
    }, { ...corsHeaders, status: 400 });
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return jsonResponse({
      success: false,
      error: 'Invalid file type. Please upload an image (JPEG, PNG, WebP)'
    }, { ...corsHeaders, status: 400 });
  }

  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return jsonResponse({
      success: false,
      error: 'File too large. Maximum size is 10MB'
    }, { ...corsHeaders, status: 400 });
  }

  console.log(`[OCR] Processing file: ${file.name} (${file.size} bytes, ${file.type})`);

  try {
    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = arrayBufferToBase64(arrayBuffer);
    const mimeType = file.type || 'image/jpeg';
    const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

    // Call OpenRouter API with Qwen2.5-VL-7B
    const ocrResult = await callOpenRouterOCR(imageDataUrl, env.OPENROUTER_API_KEY);

    // Return successful response
    return jsonResponse({
      success: true,
      text: ocrResult.text,
      json: ocrResult.json,
      language: ocrResult.language,
      confidence: ocrResult.confidence,
      model: 'qwen/qwen-2.5-vl-7b-instruct',
      processedAt: new Date().toISOString()
    }, corsHeaders);

  } catch (err) {
    console.error('[OCR] Processing error:', err);
    return jsonResponse({
      success: false,
      error: 'Failed to process image',
      details: err.message
    }, { ...corsHeaders, status: 500 });
  }
}

/**
 * Call OpenRouter API for OCR using Qwen2.5-VL-7B Vision Model
 */
async function callOpenRouterOCR(imageDataUrl, apiKey) {
  const prompt = `أنت متخصص في استخراج النصوص من الصور (OCR). 

المهمة:
1. استخرج كل النصوص من هذه الصورة بدقة عالية
2. حافظ على الترتيب والتنسيق الأصلي للنص
3. إذا كان النص عربياً، اكتبه بالعربية
4. إذا كان النص إنجليزياً، اكتبه بالإنجليزية
5. إذا كان مختلطاً، حافظ على كل لغة كما هي

القواعد:
- لا تضف أي تعليقات أو شروحات من عندك
- لا تترجم النص، اكتبه كما هو موجود
- احتفظ بالأرقام والتواريخ والعناوين كما هي
- إذا كانت الصورة تحتوي على جدول، حاول الحفاظ على هيكله

أعد النص المستخرج فقط بدون أي مقدمة أو خاتمة:`;

  const requestBody = {
    model: 'qwen/qwen-2.5-vl-7b-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl
            }
          }
        ]
      }
    ],
    max_tokens: 4096,
    temperature: 0.1,  // Low temperature for more accurate OCR
    top_p: 0.95
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://print-manager.app',  // Required by OpenRouter
      'X-Title': 'Print Manager OCR'  // Optional app identification
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OpenRouter] API Error:', response.status, errorText);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = await response.json();
  console.log('[OpenRouter] Response received');

  // Extract text from response
  const extractedText = data.choices?.[0]?.message?.content || '';
  
  // Detect language
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const detectedLanguage = arabicPattern.test(extractedText) ? 'arabic' : 'english';

  // Try to parse any structured data (if model returns JSON format)
  let jsonData = null;
  try {
    // Check if response looks like JSON
    const trimmedText = extractedText.trim();
    if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
      jsonData = JSON.parse(trimmedText);
    }
  } catch (e) {
    // Not JSON, that's fine - treat as plain text
  }

  return {
    text: extractedText,
    json: jsonData,
    language: detectedLanguage,
    confidence: 'high',  // Qwen2.5-VL is highly accurate
    usage: data.usage
  };
}

/**
 * Handle R2 Upload Request (existing functionality)
 */
async function handleUploadRequest(request, env, corsHeaders) {
  if (!env.R2_BUCKET) {
    return jsonResponse({
      success: false,
      error: 'R2 bucket not configured'
    }, { ...corsHeaders, status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const side = formData.get('side') || 'unknown';

  if (!file) {
    return jsonResponse({
      success: false,
      error: 'No file provided'
    }, { ...corsHeaders, status: 400 });
  }

  // Generate unique filename
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `uploads/${side}_${timestamp}_${random}.${ext}`;

  // Upload to R2
  await env.R2_BUCKET.put(fileName, file.stream(), {
    httpMetadata: {
      contentType: file.type
    },
    customMetadata: {
      uploadedAt: new Date().toISOString(),
      side: side
    }
  });

  // Generate public URL (adjust based on your R2 public bucket settings)
  const publicUrl = `https://pub-edc4c80125a74d37b7f5fbdb576a4ecf.r2.dev/${fileName}`;

  return jsonResponse({
    success: true,
    url: publicUrl,
    key: fileName
  }, corsHeaders);
}

/**
 * Helper: Create JSON response
 */
function jsonResponse(data, options = {}) {
  const { status = 200, headers = {} } = options;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

/**
 * Helper: Convert ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
