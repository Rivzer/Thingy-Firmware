import os
from kivy.app import App
from kivy.uix.widget import Widget
from kivy.graphics import Color, Ellipse, Rectangle, InstructionGroup
from kivy.core.image import Image as CoreImage
from kivy.core.window import Window

os.environ['KIVY_GL_BACKEND'] = 'gles2'
os.environ['KIVY_WINDOW'] = 'sdl2'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(BASE_DIR, 'icons')

class Dashboard(Widget):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        
        W, H = Window.size
        self.main_group = InstructionGroup()
        
        # 1. Achtergrond die de zwarte balken "opvreet"
        self.main_group.add(Color(0.125, 0.129, 0.145, 1))
        self.main_group.add(Rectangle(size=(W, H + 200), pos=(0, -100)))

        # STRETCH CORRECTIE FACTOR
        # Omdat je scherm het beeld verticaal uitrekt, maken we de 
        # getekende cirkels iets platter (bijv. 0.85 van de hoogte)
        corr = 0.82 
        circle_w = 135
        circle_h = circle_w * corr
        
        # Verticale verschuiving om de balk bovenin te compenseren
        y_offset = 55 

        # Apps met handmatige x,y coördinaten (geoptimaliseerd voor 800x480)
        apps = [
            ("Console", (0.38, 0.26, 0.49, 1), "console_deck.png", (80, 260 + y_offset)),
            ("Spotify", (0.24, 0.38, 0.29, 1), "spotify.png", (330, 260 + y_offset)),
            ("Weather", (0.21, 0.39, 0.40, 1), "weather.png", (580, 260 + y_offset)),
            ("Clock",   (0.46, 0.26, 0.26, 1), "clock.png", (80, 70 + y_offset)),
            ("Frame",   (0.50, 0.41, 0.17, 1), "picture_frame.png", (330, 70 + y_offset)),
            ("Settings",(0.28, 0.28, 0.30, 1), "settings.png", (580, 70 + y_offset))
        ]

        for name, color, img_name, pos in apps:
            # Teken de gecorrigeerde Ellipse (iets platter)
            self.main_group.add(Color(*color))
            self.main_group.add(Ellipse(pos=pos, size=(circle_w, circle_h)))

            # Icoon toevoegen (ook licht gecorrigeerd voor stretch)
            img_path = os.path.join(ICON_DIR, img_name)
            try:
                tex = CoreImage(img_path).texture
                self.main_group.add(Color(1, 1, 1, 1))
                icon_w = 75
                icon_h = icon_w * corr
                # Centreren in de platte cirkel
                icon_pos = (pos[0] + (circle_w - icon_w)/2, pos[1] + (circle_h - icon_h)/2)
                self.main_group.add(Rectangle(texture=tex, pos=icon_pos, size=(icon_w, icon_h)))
            except Exception as e:
                print(f"Fout: {e}")

        self.canvas.add(self.main_group)

class ThingyApp(App):
    def build(self):
        return Dashboard()

if __name__ == '__main__':
    Window.show_cursor = False
    ThingyApp().run()