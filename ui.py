import os
import datetime

# --- HARDWARE CONFIG VOOR PI ZERO 2W ---
os.environ['KIVY_WINDOW'] = 'sdl2'
os.environ['KIVY_GL_BACKEND'] = 'sdl2'

from kivy.config import Config
# Forceer resolutie
Config.set('graphics', 'width', '800')
Config.set('graphics', 'height', '480')
Config.set('graphics', 'fullscreen', 'auto')
Config.set('graphics', 'show_cursor', '0')

from kivy.app import App
from kivy.uix.floatlayout import FloatLayout
from kivy.uix.behaviors import ButtonBehavior
from kivy.uix.image import Image
from kivy.uix.label import Label
from kivy.graphics import Color, Ellipse, Rectangle
from kivy.animation import Animation
from kivy.clock import Clock
from kivy.core.window import Window

# Pad naar de icons map bepalen
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(BASE_DIR, 'icons')

class AppCircle(ButtonBehavior, FloatLayout):
    def __init__(self, name, bg_color, img_name, pos_hint_val, **kwargs):
        super().__init__(**kwargs)
        self.size_hint = (None, None)
        self.size = (142, 142)
        self.pos_hint = pos_hint_val
        self.bg_color = bg_color
        
        # Volledig pad naar afbeelding
        img_path = os.path.join(ICON_DIR, img_name)

        # De cirkel tekenen
        with self.canvas.before:
            Color(*self.bg_color)
            self.circle = Ellipse(size=self.size, pos=self.pos)
        
        # Binden van de cirkel aan de positie van de widget
        self.bind(pos=self.update_canvas, size=self.update_canvas)

        # Het icoon
        self.icon = Image(
            source=img_path,
            size_hint=(None, None),
            size=(80, 80),
            pos_hint={'center_x': 0.5, 'center_y': 0.5}
        )
        self.add_widget(self.icon)

        # De tekst onder de cirkel
        self.label = Label(
            text=name,
            font_size='18sp',
            bold=True,
            color=(0.62, 0.63, 0.65, 1),
            size_hint=(None, None),
            size=(200, 30),
            pos_hint={'center_x': 0.5, 'y': -0.4}
        )
        self.add_widget(self.label)

    def update_canvas(self, *args):
        self.circle.pos = self.pos
        self.circle.size = self.size

    def on_press(self):
        anim = Animation(size=(155, 155), duration=0.1)
        anim.start(self)
        print(f"Opening {self.label.text}...")

    def on_release(self):
        anim = Animation(size=(142, 142), duration=0.1)
        anim.start(self)

class Dashboard(FloatLayout):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        
        # Achtergrondkleur
        with self.canvas.before:
            Color(0.125, 0.129, 0.145, 1)
            self.bg_rect = Rectangle(size=Window.size, pos=(0,0))

        # Klok linksboven
        self.time_label = Label(
            text="00:00",
            font_size='50sp',
            pos_hint={'x': 0.05, 'top': 0.95},
            size_hint=(None, None),
            size=(200, 100),
            halign='left',
            valign='top'
        )
        self.time_label.bind(size=self.time_label.setter('text_size'))
        self.add_widget(self.time_label)
        
        Clock.schedule_interval(self.update_time, 1)
        self.update_time(0)

        # App grid
        self.add_widget(AppCircle("Console Deck", (0.38, 0.26, 0.49, 1), "console_deck.png", {'x': 0.12, 'top': 0.85}))
        self.add_widget(AppCircle("Spotify", (0.24, 0.38, 0.29, 1), "spotify.png", {'x': 0.41, 'top': 0.85}))
        self.add_widget(AppCircle("Weather", (0.21, 0.39, 0.40, 1), "weather.png", {'x': 0.70, 'top': 0.85}))
        self.add_widget(AppCircle("Clock", (0.46, 0.26, 0.26, 1), "clock.png", {'x': 0.12, 'top': 0.45}))
        self.add_widget(AppCircle("Picture Frame", (0.50, 0.41, 0.17, 1), "picture_frame.png", {'x': 0.41, 'top': 0.45}))
        self.add_widget(AppCircle("Settings", (0.28, 0.28, 0.30, 1), "settings.png", {'x': 0.70, 'top': 0.45}))

    def update_time(self, dt):
        self.time_label.text = datetime.datetime.now().strftime("%H:%M")

class ThingyApp(App):
    def build(self):
        return Dashboard()

if __name__ == '__main__':
    ThingyApp().run()