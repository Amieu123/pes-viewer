# PES Parser Server - Uses pyembroidery for accurate rendering
# Run hidden: pythonw pes_server.py

from flask import Flask, request, jsonify
from flask_cors import CORS
import pyembroidery
from PIL import Image
import base64
import tempfile
import os
import logging

# Disable Flask logging for silent operation
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app)

@app.route('/parse', methods=['POST'])
def parse_pes():
    """Parse PES file and return PNG thumbnail using pyembroidery's write_png"""
    try:
        data = request.json
        if not data or 'fileData' not in data:
            return jsonify({'error': 'No file data provided'}), 400

        file_bytes = base64.b64decode(data['fileData'])

        # Write PES to temp file
        with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as tmp:
            tmp.write(file_bytes)
            pes_path = tmp.name

        # Create temp PNG path
        png_path = pes_path.replace('.pes', '.png')

        try:
            pattern = pyembroidery.read(pes_path)
            if not pattern:
                return jsonify({'error': 'Failed to parse PES file'}), 400

            # Use pyembroidery's write_png for accurate colors
            pyembroidery.write_png(pattern, png_path)

            # Convert PNG to WebP
            thumb_path = pes_path.replace('.pes', '_thumb.webp')
            preview_path = pes_path.replace('.pes', '_preview.webp')

            with Image.open(png_path) as img:
                # Convert to RGB with gray background (#E3E3E3)
                if img.mode in ('RGBA', 'LA', 'P'):
                    background = Image.new('RGB', img.size, (227, 227, 227))
                    if img.mode == 'P':
                        img = img.convert('RGBA')
                    background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')

                # Thumbnail: 30% quality, full size
                img.save(thumb_path, 'WEBP', quality=30, method=4)

                # Preview: 70% quality, full size
                img.save(preview_path, 'WEBP', quality=70, method=4)

            # Read images and convert to base64
            with open(thumb_path, 'rb') as f:
                thumb_data = base64.b64encode(f.read()).decode('utf-8')
            with open(preview_path, 'rb') as f:
                preview_data = base64.b64encode(f.read()).decode('utf-8')

            # Get info
            stitch_count = pattern.count_stitches()
            color_count = len(pattern.threadlist)
            bounds = pattern.bounds()

            # Get thread colors
            threads = []
            for thread in pattern.threadlist:
                # Get color - pyembroidery returns ARGB as large int
                color = thread.color
                if color is not None and color != 0:
                    # Extract RGB from ARGB (ignore alpha)
                    r = (color >> 16) & 0xFF
                    g = (color >> 8) & 0xFF
                    b = color & 0xFF
                    hex_color = f'#{r:02X}{g:02X}{b:02X}'
                else:
                    hex_color = '#000000'

                threads.append({
                    'color': hex_color,
                    'code': thread.catalog_number or thread.chart or '',
                    'name': thread.description or ''
                })

            return jsonify({
                'success': True,
                'thumbnail': f'data:image/webp;base64,{thumb_data}',
                'preview': f'data:image/webp;base64,{preview_data}',
                'stitchCount': stitch_count,
                'colorCount': color_count,
                'threads': threads,
                'bounds': {
                    'minX': bounds[0] if bounds else 0,
                    'minY': bounds[1] if bounds else 0,
                    'maxX': bounds[2] if bounds else 0,
                    'maxY': bounds[3] if bounds else 0
                }
            })

        finally:
            # Clean up temp files
            for path in [pes_path, png_path, thumb_path, preview_path]:
                if os.path.exists(path):
                    os.unlink(path)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    import threading
    from werkzeug.serving import make_server

    # Limit concurrent requests with a semaphore
    MAX_THREADS = 20
    request_semaphore = threading.Semaphore(MAX_THREADS)

    # Wrap the app to limit concurrency
    original_app = app.wsgi_app
    def limited_app(environ, start_response):
        with request_semaphore:
            return original_app(environ, start_response)
    app.wsgi_app = limited_app

    server = make_server('localhost', 5000, app, threaded=True)
    server.daemon_threads = True
    print(f'PES Server running on http://localhost:5000 (max {MAX_THREADS} concurrent requests)')
    server.serve_forever()
