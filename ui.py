#!/usr/bin/env python3
import pygame
import os
import sys
import json
import time
import base64
import webbrowser
import http.server
import socketserver
import ssl
import urllib.parse
import threading
from io import BytesIO
import qrcode
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.exceptions import SpotifyException
from datetime import datetime, timedelta

def try_display():
    os.environ['SDL_VIDEODRIVER'] = 'x11'
    os.environ['DISPLAY'] = ':0'
    
    try:
        pygame.init()
        screen = pygame.display.set_mode((800, 480), pygame.FULLSCREEN)
        return screen, 'x11'
    except:
        os.environ['SDL_VIDEODRIVER'] = 'fbcon'
        try:
            pygame.quit()
            pygame.init()
            screen = pygame.display.set_mode((800, 480), pygame.FULLSCREEN)
            return screen, 'fbcon'
        except:
            return None, None

def load_image(path, size=None):
    try:
        img = pygame.image.load(path)
        if size:
            img = pygame.transform.scale(img, size)
        return img
    except:
        surf = pygame.Surface(size or (100, 100))
        surf.fill((255, 255, 255))
        return surf

class PythonSpotifyPlayer:
    def __init__(self):
        self.screen, driver = try_display()
        if not self.screen:
            raise Exception("No display available")
        
        pygame.mouse.set_visible(False)
        self.WIDTH, self.HEIGHT = 800, 480
        self.clock = pygame.time.Clock()
        
        # Spotify config - VUL JE EIGEN CREDENTIALS IN!
        self.CLIENT_ID = "9223c22abe2a4a5e89929bebeaf113f2"      # 👈 VERANDER DIT
        self.CLIENT_SECRET = "39cfca99e8ce4fcc879768e32c0219e7"  # 👈 VERANDER DIT
        self.REDIRECT_URI = "https://192.168.9.186:8888/callback"
        
        # Token file
        self.TOKEN_FILE = "/root/.spotify_token.json"

        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.CERT_FILE = os.path.join(base_dir, "cert.pem")  # 👈 cert.pem in je huidige folder
        self.KEY_FILE = os.path.join(base_dir, "key.pem")    # 👈 key.pem in je huidige folder
        
        print(f"📁 Cert: {self.CERT_FILE}")
        print(f"📁 Key: {self.KEY_FILE}")
        
        # Check of files bestaan
        if not os.path.exists(self.CERT_FILE):
            print("❌ cert.pem not found in current folder!")
        if not os.path.exists(self.KEY_FILE):
            print("❌ key.pem not found in current folder!")
        
        # Spotify client
        self.sp = None
        self.login_state = "checking"  # checking, logged_out, logged_in, auth_pending
        self.auth_url = None
        self.qr_image = None
        self.auth_code = None
        
        # Spotify data
        self.current_track = {
            'artist': 'Artist',
            'track': 'Song name',
            'duration': 0,
            'progress': 0,
            'is_playing': False,
            'cover_url': None,
            'cover_surface': None
        }
        
        # Laad images
        self.images = {
            'back': load_image('icons/turn-back.png', (40, 40)),
            'logo': load_image('icons/spotify.png', (48, 48)),
            'forward': load_image('icons/forward-button.png', (40, 40)),
            'reverse': load_image('icons/forward-button.png', (40, 40)),
            'pause': load_image('icons/pause.png', (60, 60)),
            'play': load_image('icons/play.png', (60, 60)),
            'history': load_image('icons/history.png', (66, 66)),
            'search': load_image('icons/search.png', (66, 66)),
            'heart': load_image('icons/heart.png', (66, 66)),
            'list': load_image('icons/list-text.png', (66, 66)),
        }
        
        # UI element posities
        self.positions = {
            'back_button': (20, 20),
            'clock': (700, 20),
            'logo': (376, 16),
            'cover': (429, 66),
            'song_name': (470, 99),
            'artist': (556, 158),
            'play_button': (574, 265),
            'prev_button': (522, 325),
            'next_button': (686, 325),
            'timeline': (504, 382),
            'current_time': (456, 375),
            'total_time': (722, 375),
            'liked_playlist': (54, 101),
            'search': (236, 101),
            'recent': (236, 276),
            'playlist_list': (54, 276),
            'qr_area': (250, 100, 300, 300),
            'login_button': (350, 420, 100, 40)
        }
        
        # App rechthoeken voor klik detectie
        self.app_rects = {
            'liked_playlist': pygame.Rect(54, 101, 153, 153),
            'search': pygame.Rect(236, 101, 153, 153),
            'recent': pygame.Rect(236, 276, 153, 152),
            'playlist_list': pygame.Rect(54, 276, 153, 152),
            'back': pygame.Rect(20, 20, 40, 40),
            'login': pygame.Rect(350, 420, 100, 40),
            'open_browser': pygame.Rect(250, 420, 200, 40),
            'qr': pygame.Rect(250, 100, 300, 300)
        }
        
        # Timeline
        self.timeline_width = 200
        
        # Fonts
        try:
            self.title_font = pygame.font.Font(None, 36)
            self.artist_font = pygame.font.Font(None, 24)
            self.time_font = pygame.font.Font(None, 15)
            self.clock_font = pygame.font.Font(None, 24)
            self.button_font = pygame.font.Font(None, 28)
        except:
            self.title_font = pygame.font.SysFont(None, 36)
            self.artist_font = pygame.font.SysFont(None, 24)
            self.time_font = pygame.font.SysFont(None, 15)
            self.clock_font = pygame.font.SysFont(None, 24)
            self.button_font = pygame.font.SysFont(None, 28)
        
        # Initialiseer Spotify
        self.init_spotify()
    
    def start_https_server(self):
        """Start HTTPS server voor callback"""
        class CallbackHandler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self):
                if self.path.startswith('/callback'):
                    query = urllib.parse.urlparse(self.path).query
                    params = urllib.parse.parse_qs(query)
                    
                    if 'code' in params:
                        code = params['code'][0]
                        
                        # Success response
                        self.send_response(200)
                        self.send_header('Content-type', 'text/html')
                        self.end_headers()
                        
                        html = """<html><body><h1>✅ Login Successful!</h1></body></html>"""
                        self.wfile.write(html.encode())
                        
                        # Store auth code
                        self.server.player.auth_code = code
                        print(f"✅ Got auth code: {code}")
                        
                        # Stop server
                        threading.Thread(target=self.server.shutdown).start()
                        return
                
                # Default response
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                self.wfile.write(b"Spotify Callback Server")
        
        try:
            # SSL context met jouw certificates
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certfile=self.CERT_FILE, keyfile=self.KEY_FILE)
            
            # Start HTTPS server
            with socketserver.TCPServer(("0.0.0.0", 8888), CallbackHandler) as httpd:
                httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
                httpd.player = self
                print("✅ HTTPS server running on https://localhost:8888")
                httpd.serve_forever()
                
        except Exception as e:
            print(f"❌ HTTPS server error: {e}")
    
    def init_spotify(self):
        """Initialiseer Spotify met HTTPS"""
        try:
            scope = "user-read-playback-state user-modify-playback-state user-read-currently-playing"
            
            # Spotify OAuth met HTTPS
            self.auth_manager = SpotifyOAuth(
                client_id=self.CLIENT_ID,
                client_secret=self.CLIENT_SECRET,
                redirect_uri=self.REDIRECT_URI,  # HTTPS URL
                scope=scope,
                cache_path=self.TOKEN_FILE,
                show_dialog=True
            )
            
            # Start HTTPS server in background thread
            server_thread = threading.Thread(target=self.start_https_server, daemon=True)
            server_thread.start()
            time.sleep(2)  # Wacht tot server start
            
            # Genereer auth URL
            self.auth_url = self.auth_manager.get_authorize_url()
            self.login_state = "logged_out"
            
            print(f"🔗 Login URL: {self.auth_url}")
            
        except Exception as e:
            print(f"❌ Spotify init error: {e}")
            self.login_state = "error"
    
    def generate_qr_code(self):
        """Genereer QR code van auth URL"""
        if self.auth_url:
            try:
                qr = qrcode.QRCode(
                    version=1,
                    error_correction=qrcode.constants.ERROR_CORRECT_L,
                    box_size=10,
                    border=4,
                )
                qr.add_data(self.auth_url)
                qr.make(fit=True)
                
                # Maak PIL image
                img = qr.make_image(fill_color="black", back_color="white")
                
                # Converteer naar pygame surface
                img_bytes = BytesIO()
                img.save(img_bytes, format='PNG')
                img_bytes.seek(0)
                
                # Laad in pygame
                self.qr_image = pygame.image.load(img_bytes)
                self.qr_image = pygame.transform.scale(self.qr_image, (300, 300))
                
                print("✅ QR code generated")
            except Exception as e:
                print(f"❌ QR code error: {e}")
    
    def save_token(self, token_info):
        """Sla token op in file"""
        try:
            with open(self.TOKEN_FILE, 'w') as f:
                json.dump(token_info, f)
            print("✅ Token saved")
        except Exception as e:
            print(f"❌ Token save error: {e}")
    
    def handle_auth_callback(self, url):
        """Handle de callback URL na login"""
        try:
            # Parse de code uit de URL
            if "code=" in url:
                code = url.split("code=")[1].split("&")[0]
                
                # Haal token op
                token_info = self.auth_manager.get_access_token(code)
                
                if token_info:
                    # Sla token op
                    self.save_token(token_info)
                    
                    # Maak nieuwe client
                    self.sp = spotipy.Spotify(auth_manager=self.auth_manager)
                    self.login_state = "logged_in"
                    print("✅ Login successful!")
                    return True
            
            print("❌ Failed to get token from callback")
            return False
            
        except Exception as e:
            print(f"❌ Callback error: {e}")
            return False
    
    def get_current_playback(self):
        """Haal huidige playback info op"""
        if not self.sp or self.login_state != "logged_in":
            return None
        
        try:
            playback = self.sp.current_playback()
            
            if not playback or not playback.get('item'):
                return None
            
            item = playback['item']
            
            # Track info
            track_name = item.get('name', 'Unknown Track')
            artists = ", ".join([artist['name'] for artist in item.get('artists', [])])
            
            # Album cover
            cover_url = None
            if item.get('album') and item['album'].get('images'):
                cover_url = item['album']['images'][0]['url']
            
            return {
                'track': track_name,
                'artist': artists,
                'duration': item.get('duration_ms', 0),
                'progress': playback.get('progress_ms', 0),
                'is_playing': playback.get('is_playing', False),
                'cover_url': cover_url
            }
            
        except SpotifyException as e:
            print(f"Spotify API error: {e}")
            return None
        except Exception as e:
            print(f"Playback error: {e}")
            return None
    
    def load_cover_image(self, url):
        """Laad album cover van URL"""
        if not url:
            return None
        
        try:
            import requests
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                img_bytes = BytesIO(response.content)
                surface = pygame.image.load(img_bytes)
                # Schaal naar juiste grootte
                surface = pygame.transform.scale(surface, (350, 390))
                return surface
        except:
            pass
        
        return None
    
    def control_playback(self, action):
        """Controleer playback"""
        if not self.sp or self.login_state != "logged_in":
            return False
        
        try:
            if action == "playpause":
                playback = self.sp.current_playback()
                if playback and playback.get('is_playing'):
                    self.sp.pause_playback()
                else:
                    self.sp.start_playback()
            elif action == "next":
                self.sp.next_track()
            elif action == "prev":
                self.sp.previous_track()
            elif action == "seek":
                # Hier zou je seek kunnen implementeren
                pass
            
            return True
            
        except Exception as e:
            print(f"Control error: {e}")
            return False
    
    def draw_background(self):
        self.screen.fill((20, 20, 20))
    
    def draw_login_screen(self):
        """Teken login scherm"""
        # Titel
        title = self.title_font.render("Spotify Login Required", True, (255, 255, 255))
        self.screen.blit(title, (self.WIDTH//2 - title.get_width()//2, 50))
        
        # Instructies
        instr = self.artist_font.render("Scan QR code to login", True, (200, 200, 200))
        self.screen.blit(instr, (self.WIDTH//2 - instr.get_width()//2, 100))
        
        # QR code
        qr_x, qr_y, qr_w, qr_h = self.positions['qr_area']
        
        if self.qr_image:
            # Teken QR code
            self.screen.blit(self.qr_image, (qr_x, qr_y))
            
            # Border rond QR
            pygame.draw.rect(self.screen, (100, 100, 100), (qr_x-2, qr_y-2, qr_w+4, qr_h+4), 2)
        else:
            # Placeholder
            pygame.draw.rect(self.screen, (50, 50, 50), (qr_x, qr_y, qr_w, qr_h))
            qr_text = self.artist_font.render("Generating QR...", True, (150, 150, 150))
            self.screen.blit(qr_text, (qr_x + 90, qr_y + 140))
        
        # Open in browser knop
        browser_rect = self.app_rects['open_browser']
        pygame.draw.rect(self.screen, (30, 215, 96), browser_rect, border_radius=10)
        browser_text = self.button_font.render("OPEN IN BROWSER", True, (255, 255, 255))
        self.screen.blit(browser_text, (browser_rect.x + 10, browser_rect.y + 10))
        
        # Back knop
        self.screen.blit(self.images['back'], self.positions['back_button'])
        
        # Toon verkorte URL
        if self.auth_url:
            url_short = self.auth_url[:50] + "..." if len(self.auth_url) > 50 else self.auth_url
            url_text = self.time_font.render(f"URL: {url_short}", True, (180, 180, 180))
            self.screen.blit(url_text, (250, 410))
    
    def draw_player_screen(self):
        """Teken het normale player scherm"""
        self.draw_app_buttons()
        self.draw_now_playing()
        self.draw_controls()
        self.draw_timeline()
        self.draw_player_text()
        self.draw_header()
    
    def draw_app_buttons(self):
        # Liked Playlist (groen)
        pygame.draw.rect(self.screen, (51, 127, 96), self.app_rects['liked_playlist'], border_radius=20)
        self.screen.blit(self.images['heart'], (98, 151))
        
        # Search (paars)
        pygame.draw.rect(self.screen, (58, 53, 102), self.app_rects['search'], border_radius=20)
        self.screen.blit(self.images['search'], (280, 145))
        
        # Recent (oranje)
        pygame.draw.rect(self.screen, (215, 88, 5), self.app_rects['recent'], border_radius=20)
        self.screen.blit(self.images['history'], (280, 319))
        
        # Playlist List (blauw)
        pygame.draw.rect(self.screen, (41, 60, 103), self.app_rects['playlist_list'], border_radius=20)
        self.screen.blit(self.images['list'], (98, 319))
    
    def draw_now_playing(self):
        # Album cover
        cover_rect = pygame.Rect(self.positions['cover'], (350, 390))
        
        if self.current_track['cover_surface']:
            # Toon geladen cover
            self.screen.blit(self.current_track['cover_surface'], self.positions['cover'])
        else:
            # Placeholder
            pygame.draw.rect(self.screen, (60, 60, 60), cover_rect, border_radius=35)
            note_text = self.title_font.render("♪", True, (100, 100, 100))
            self.screen.blit(note_text, (cover_rect.centerx - 10, cover_rect.centery - 20))
    
    def draw_controls(self):
        # Vorige knop
        try:
            prev_img = pygame.transform.rotate(self.images['reverse'], 180)
            self.screen.blit(prev_img, self.positions['prev_button'])
        except:
            points = [(522+20, 325+20), (522+35, 325+5), (522+35, 325+35)]
            pygame.draw.polygon(self.screen, (255, 255, 255), points)
        
        # Play/Pause knop
        play_char = self.images['pause'] if self.current_track['is_playing'] else self.images['play']
        self.screen.blit(play_char, self.positions['play_button'])
        
        # Volgende knop
        try:
            next_img = self.images['forward']
            self.screen.blit(next_img, self.positions['next_button'])
        except:
            points = [(686+20, 325+20), (686+5, 325+5), (686+5, 325+35)]
            pygame.draw.polygon(self.screen, (255, 255, 255), points)
    
    def draw_timeline(self):
        # Timeline achtergrond
        timeline_bg = pygame.Rect(self.positions['timeline'], (self.timeline_width, 10))
        pygame.draw.rect(self.screen, (46, 46, 47), timeline_bg, border_radius=12)
        
        # Timeline voortgang
        if self.current_track['duration'] > 0:
            progress_width = (self.current_track['progress'] / self.current_track['duration']) * self.timeline_width
            progress_rect = pygame.Rect(self.positions['timeline'], (progress_width, 10))
            pygame.draw.rect(self.screen, (255, 255, 255), progress_rect, border_radius=12)
    
    def draw_player_text(self):
        # Song naam
        song_name_rect = pygame.Rect(470, 99, 268, 59)
        track_text = self.title_font.render(self.current_track['track'][:20], True, (255, 255, 255))
        track_rect = track_text.get_rect(midtop=(song_name_rect.centerx, song_name_rect.top))
        self.screen.blit(track_text, track_rect)
        
        # Artiest
        artist_rect = pygame.Rect(556, 158, 96, 40)
        artist_text = self.artist_font.render(self.current_track['artist'][:15], True, (255, 255, 255))
        artist_rect_obj = artist_text.get_rect(midtop=(artist_rect.centerx, artist_rect.top))
        self.screen.blit(artist_text, artist_rect_obj)
        
        # Tijden
        def ms_to_time(ms):
            m = ms // 60000
            s = (ms % 60000) // 1000
            return f"{m}:{s:02d}"
        
        current_time = self.time_font.render(
            ms_to_time(self.current_track['progress']), 
            True, (255, 255, 255)
        )
        total_time = self.time_font.render(
            ms_to_time(self.current_track['duration']), 
            True, (255, 255, 255)
        )
        
        self.screen.blit(current_time, self.positions['current_time'])
        self.screen.blit(total_time, self.positions['total_time'])
        
        # Klok
        current_time_str = time.strftime("%H:%M")
        clock_text = self.clock_font.render(current_time_str, True, (255, 255, 255))
        self.screen.blit(clock_text, self.positions['clock'])
    
    def draw_header(self):
        # Terug knop
        self.screen.blit(self.images['back'], self.positions['back_button'])
        
        # Spotify logo
        self.screen.blit(self.images['logo'], self.positions['logo'])
        
        # Login status indicator
        if self.login_state == "logged_in":
            status_color = (0, 255, 0)  # Groen
        else:
            status_color = (255, 165, 0)  # Oranje
        
        pygame.draw.circle(self.screen, status_color, (780, 40), 8)
    
    def handle_login_click(self, pos):
        """Handle clicks op login scherm"""
        if self.app_rects['back'].collidepoint(pos):
            return 'back'
        
        if self.app_rects['open_browser'].collidepoint(pos) and self.auth_url:
            webbrowser.open(self.auth_url)
            print(f"Opened browser with URL: {self.auth_url}")
            return None
        
        return None
    
    def handle_player_click(self, pos):
        """Handle clicks op player scherm"""
        if self.app_rects['back'].collidepoint(pos):
            return 'back'
        
        # Check play/pause
        play_center = (574 + 30, 265 + 30)
        if ((pos[0] - play_center[0])**2 + (pos[1] - play_center[1])**2) <= 900:
            self.control_playback("playpause")
            return None
        
        # Check vorige
        prev_center = (522 + 20, 325 + 20)
        if ((pos[0] - prev_center[0])**2 + (pos[1] - prev_center[1])**2) <= 400:
            self.control_playback("prev")
            return None
        
        # Check volgende
        next_center = (686 + 20, 325 + 20)
        if ((pos[0] - next_center[0])**2 + (pos[1] - next_center[1])**2) <= 400:
            self.control_playback("next")
            return None
        
        # Check timeline (voor toekomstige seek functionaliteit)
        timeline_rect = pygame.Rect(504, 382, 200, 30)
        if timeline_rect.collidepoint(pos):
            # Hier zou je seek kunnen implementeren
            return None
        
        return None
    
    def update_playback_data(self):
        """Update playback data van Spotify API"""
        if self.login_state == "logged_in":
            data = self.get_current_playback()
            if data:
                # Update track info
                self.current_track.update({
                    'artist': data.get('artist', 'Artist'),
                    'track': data.get('track', 'Song name'),
                    'duration': data.get('duration', 0),
                    'progress': data.get('progress', 0),
                    'is_playing': data.get('is_playing', False),
                })
                
                # Laad nieuwe cover indien nodig
                new_cover_url = data.get('cover_url')
                if new_cover_url != self.current_track['cover_url']:
                    self.current_track['cover_url'] = new_cover_url
                    self.current_track['cover_surface'] = self.load_cover_image(new_cover_url)
    
    def run(self):
        running = True
        last_update = 0
        
        while running:
            current_time = time.time()
            
            # Update playback data elke 2 seconden
            if current_time - last_update >= 2:
                self.update_playback_data()
                last_update = current_time
            
            # Simuleer progress als afspelen
            if self.current_track['is_playing'] and self.current_track['duration'] > 0:
                self.current_track['progress'] = min(
                    self.current_track['progress'] + 2000,  # 2 seconden per update
                    self.current_track['duration']
                )
            
            # Event handling
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        running = False
                    elif event.key == pygame.K_BACKSPACE:
                        return 'back'
                elif event.type == pygame.MOUSEBUTTONDOWN:
                    if self.login_state == "logged_in":
                        result = self.handle_player_click(event.pos)
                    else:
                        result = self.handle_login_click(event.pos)
                    
                    if result == 'back':
                        return
            
            # Teken juiste scherm
            self.draw_background()
            
            if self.login_state == "logged_in":
                self.draw_player_screen()
            else:
                self.draw_login_screen()
            
            pygame.display.flip()
            self.clock.tick(60)
        
        pygame.quit()


def main():
    screen, driver = try_display()
    if not screen:
        return 1
    
    pygame.mouse.set_visible(False)
    WIDTH, HEIGHT = 800, 480
    
    BG_COLOR = (32, 33, 37)
    APP_COLORS = [
        (97, 66, 125), (61, 97, 74), (54, 99, 102),
        (117, 66, 66), (128, 105, 43), (71, 71, 77)
    ]
    
    APP_NAMES = ['Console', 'Spotify', 'Weather', 'Clock', 'Frame', 'Settings']
    
    CIRCLE_DIAMETER = 170
    ICON_SIZE = 95
    VERTICAL_OFFSET = -15
    
    cols, rows = 3, 2
    total_grid_width = cols * CIRCLE_DIAMETER
    total_grid_height = rows * CIRCLE_DIAMETER
    
    horizontal_spacing = (WIDTH - total_grid_width) / (cols + 1)
    vertical_spacing = (HEIGHT - total_grid_height) / (rows + 1)
    
    start_x = horizontal_spacing
    start_y = vertical_spacing + VERTICAL_OFFSET
    
    positions = []
    for row in range(rows):
        for col in range(cols):
            x = start_x + col * (CIRCLE_DIAMETER + horizontal_spacing)
            y = start_y + row * (CIRCLE_DIAMETER + vertical_spacing)
            positions.append((x, y))
    
    icons = []
    icon_files = [
        'console_deck.png', 'spotify.png', 'weather.png',
        'clock.png', 'picture_frame.png', 'settings.png'
    ]
    
    for icon_file in icon_files:
        try:
            icon_path = os.path.join('icons', icon_file)
            img = pygame.image.load(icon_path)
            img = pygame.transform.scale(img, (ICON_SIZE, ICON_SIZE))
            icons.append(img)
        except:
            surf = pygame.Surface((ICON_SIZE, ICON_SIZE))
            surf.fill((255, 255, 255))
            icons.append(surf)
    
    clock = pygame.time.Clock()
    running = True
    
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                running = False
            elif event.type == pygame.MOUSEBUTTONDOWN:
                mouse_pos = pygame.mouse.get_pos()
                for i, (x, y) in enumerate(positions):
                    center_x = x + CIRCLE_DIAMETER // 2
                    center_y = y + CIRCLE_DIAMETER // 2
                    distance = ((mouse_pos[0] - center_x)**2 + 
                               (mouse_pos[1] - center_y)**2)**0.5
                    if distance <= CIRCLE_DIAMETER // 2:
                        print(f"Clicked {APP_NAMES[i]}")
                        if APP_NAMES[i] == 'Spotify':
                            try:
                                # BELANGRIJK: gebruik PythonSpotifyPlayer
                                spotify = PythonSpotifyPlayer()  # 👈 HIER!
                                result = spotify.run()
                                
                                # Na terugkeer, herinitialiseer hoofdscherm
                                screen, driver = try_display()
                                if not screen:
                                    return 1
                                pygame.mouse.set_visible(False)
                            except Exception as e:
                                print(f"Spotify error: {e}")
        
        screen.fill(BG_COLOR)
        
        for i, (x, y) in enumerate(positions):
            if i < len(APP_COLORS):
                center_x = x + CIRCLE_DIAMETER // 2
                center_y = y + CIRCLE_DIAMETER // 2
                
                pygame.draw.circle(screen, APP_COLORS[i], 
                                  (center_x, center_y), CIRCLE_DIAMETER // 2)
                
                if i < len(icons):
                    icon_rect = icons[i].get_rect(center=(center_x, center_y))
                    screen.blit(icons[i], icon_rect)
        
        pygame.display.flip()
        clock.tick(60)
    
    pygame.quit()
    return 0

if __name__ == "__main__":
    sys.exit(main())