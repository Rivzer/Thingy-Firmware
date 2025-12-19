from kivy.app import App
from kivy.uix.floatlayout import FloatLayout
from kivy.uix.behaviors import ButtonBehavior
from kivy.uix.image import Image
from kivy.uix.label import Label
from kivy.graphics import Color, Ellipse
from kivy.animation import Animation
from kivy.core.window import Window
from kivy.clock import Clock
import datetime

# Stel de venstergrootte in op jouw resolutie
Window.size = (800, 480)
Window.clearcolor = (0.125, 0.129, 0.145, 1) # #202125

class AppCircle(ButtonBehavior, FloatLayout):
    def __init__(self, name, bg_color, img_source, pos, **kwargs):
        super().__init__(**kwargs)
        self.size_hint = (None, None)
        self.size = (142, 142)
        self.pos = pos
        self.bg_color = bg_color
        self.img_source = img_source

        # De gekleurde cirkel
        with self.canvas.before:
            Color(*self.bg_color)
            self.circle = Ellipse(pos=self.pos, size=self.size)

        # Het icoon
        self.icon = Image(
            source=self.img_source,
            size_hint=(None, None),
            size=(80, 80),
            pos=(self.pos[0] + 31, self.pos[1] + 31)
        )
        self.add_widget(self.icon)

        # De naam onder de cirkel
        self.label = Label(
            text=name,
            font_size='20sp',
            bold=True,
            color=(0.62, 0.63, 0.65, 1), # #9fa2a7
            pos=(self.pos[0] - 30, self.pos[1] - 50), # Positie relatief aan cirkel
            size_hint=(None, None),
            size=(200, 30)
        )
        self.add_widget(self.label)

    def on_press(self):
        # Animatie: Groei effect (zoals je CSS transition)
        anim = Animation(size=(155, 155), pos=(self.pos[0]-6, self.pos[1]-6), duration=0.1)
        anim.start(self.circle)
        print(f"Opening {self.label.text}...")

    def on_release(self):
        anim = Animation(size=(142, 142), pos=self.pos, duration=0.1)
        anim.start(self.circle)

class Dashboard(FloatLayout):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        self.time_label = Label(
            text="00:00",
            font_size='50sp',
            # top: 1.0 is de bovenkant, x: 0.05 geeft een kleine marge links
            pos_hint={'x': 0.05, 'top': 0.98}, 
            size_hint=(None, None),
            size=(200, 100),
            halign='left',
            valign='top'
        )
        # Zorgt dat de tekst ook echt links in zijn box uitlijnt
        self.time_label.bind(size=self.time_label.setter('text_size')) 
        self.add_widget(self.time_label)

        # Bouw de tegels exact volgens je CSS posities
        # Let op: Kivy coördinaten beginnen linksonder (0,0)
        # CSS top 59px wordt in Kivy: 480 - 59 - 142 = 279px
        
        # RIJ 1 (Top)
        self.add_widget(AppCircle("Console Deck", (0.38, 0.26, 0.49, 1), "icons/console_deck.png", (95, 279)))
        self.add_widget(AppCircle("Spotify", (0.24, 0.38, 0.29, 1), "icons/spotify.png", (329, 279)))
        self.add_widget(AppCircle("Weather", (0.21, 0.39, 0.40, 1), "icons/weather.png", (563, 279)))

        # RIJ 2 (Bottom)
        self.add_widget(AppCircle("Clock", (0.46, 0.26, 0.26, 1), "icons/clock.png", (95, 77)))
        self.add_widget(AppCircle("Picture Frame", (0.50, 0.41, 0.17, 1), "icons/picture_frame.png", (329, 77)))
        self.add_widget(AppCircle("Settings", (0.28, 0.28, 0.30, 1), "icons/settings.png", (563, 77)))

    def update_time(self, dt):
        self.time_label.text = datetime.datetime.now().strftime("%H:%M")

class ThingyApp(App):
    def build(self):
        return Dashboard()

if __name__ == '__main__':
    ThingyApp().run()