/**
 * Cloudflare Worker for R2 File Upload
 * Handles ID card image uploads to Cloudflare R2 storage
 * 
 * Endpoint: POST /upload
 * Headers: Content-Type: multipart/form-data
 * Body: file (image), side (front/back)
 * 
 * Response: { success: true, url: "https://pub-...r2.dev/idcard_front_1234567890.jpg" }
 */

// R2 Binding - Configure in Cloudflare Dashboard
// Variable name: R2_BUCKET
// Bucket: orders

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow POST to /upload
    const url = new URL(request.url);
    
    if (request.method !== 'POST' || url.pathname !== '/upload') {
      return jsonResponse({ error: 'Method not allowed. Use POST /upload' }, 405);
    }

    try {
      // Parse form data
      const formData = await request.formData();
      const file = formData.get('file');
      const side = formData.get('side') || 'unknown';

      // Validate file
      if (!file || !(file instanceof File)) {
        return jsonResponse({ error: 'No file provided or invalid file format' }, 400);
      }

      // Validate file type (images only)
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        return jsonResponse({ error: `Invalid file type: ${file.type}. Only images are allowed.` }, 400);
      }

      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        return jsonResponse({ error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size is 10MB.` }, 400);
      }

      // Generate unique filename
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const extension = file.name.split('.').pop() || 'jpg';
      const fileName = `idcards/${side}_${timestamp}_${randomId}.${extension}`;

      // Check if R2 bucket is bound
      if (!env.R2_BUCKET) {
        console.error('R2_BUCKET binding not configured');
        
        // Return a mock response for development/testing
        // In production, make sure to bind your R2 bucket in Cloudflare dashboard
        const mockUrl = `${url.origin}/mock-upload/${fileName}`;
        return jsonResponse({
          success: true,
          url: mockUrl,
          filename: fileName,
          side: side,
          size: file.size,
          type: file.type,
          note: 'R2 not configured - returning mock URL'
        });
      }

      // Upload to R2
      await env.R2_BUCKET.put(fileName, file.stream(), {
        httpMetadata: {
          contentType: file.type,
          contentDisposition: `inline; filename="${file.name}"`,
        },
        customMetadata: {
          side: side,
          uploadedAt: new Date().toISOString(),
          source: 'print-manager-app',
        },
      });

      // Generate public URL
      // Replace with your actual R2 public domain
      const publicUrl = `https://pub-edc4c80125a74d37b7f5fbdb576a4ecf.r2.dev/${fileName}`;

      console.log(`[Upload] ${side} uploaded: ${fileName} (${(file.size / 1024).toFixed(1)}KB)`);

      return jsonResponse({
        success: true,
        url: publicUrl,
        filename: fileName,
        side: side,
        size: file.size,
        type: file.type,
        timestamp: timestamp
      });

    } catch (error) {
      console.error('[Upload Error]', error);
      
      return jsonResponse({
        error: 'Upload failed',
        message: error.message || 'Unknown error occurred',
        status: 'error'
      }, 500);
    }
  },
};

// Helper function for JSON responses
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

/*
=============================================================================
  SETUP INSTRUCTIONS:
=============================================================================

1. Go to Cloudflare Dashboard → Workers & Pages → Create Worker
2. Paste this code into the worker editor
3. Go to Settings → Bindings → Add R2 Bucket Binding:
   - Variable name: R2_BUCKET
   - Select your "orders" bucket
4. Deploy the worker

5. Your worker will be available at: https://orders.usastud42.workers.dev
   Upload endpoint: https://orders.usastud42.workers.dev/upload

6. Make sure your R2 bucket has public access enabled:
   - Go to R2 bucket settings → Allow Access → Enable "Allow Public Access"
   - This gives you the public URL: https://pub-xxx.r2.dev/

=============================================================================
*/
