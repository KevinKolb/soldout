#!/usr/bin/env python3
"""
Simple development server for Shows Admin
Run this script and visit http://localhost:8080/addshows.html
"""

import http.server
import socketserver
import json
import os
from pathlib import Path

PORT = 8080

class ShowsHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        """Handle POST requests to save-shows.php"""
        if self.path == '/save-shows.php':
            # Read the request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                # Parse JSON request
                data = json.loads(post_data.decode('utf-8'))
                xml_content = data.get('xml', '')

                if not xml_content:
                    self.send_error(400, "No XML data provided")
                    return

                # Write to shows.xml
                shows_path = Path(__file__).parent.parent / 'web' / 'shows.xml'
                with open(shows_path, 'w', encoding='utf-8') as f:
                    f.write(xml_content)

                # Send success response
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                response = json.dumps({'success': True, 'message': 'Shows saved successfully'})
                self.wfile.write(response.encode('utf-8'))

                print(f"✓ Shows saved to {shows_path}")

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()

                response = json.dumps({'error': str(e)})
                self.wfile.write(response.encode('utf-8'))

                print(f"✗ Error saving shows: {e}")
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def main():
    # Change to the parent directory (soldoutcomedydotcom)
    os.chdir(Path(__file__).parent.parent)

    with socketserver.TCPServer(("", PORT), ShowsHandler) as httpd:
        print("=" * 60)
        print("  SOLD OUT! Comedy - Shows Admin Server")
        print("=" * 60)
        print(f"\n  Server running at: http://localhost:{PORT}")
        print(f"  Admin interface:   http://localhost:{PORT}/admin/addshows.html")
        print("\n  Press Ctrl+C to stop the server\n")
        print("=" * 60)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n✓ Server stopped")

if __name__ == "__main__":
    main()
