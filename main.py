import tkinter, pystray, serial, customtkinter, time, json, pyautogui
from PIL import Image

""" customtkinter.set_appearance_mode("System")  # Modes: system, light, dark
customtkinter.set_default_color_theme("blue")  # Themes: blue, dark-blue, green

app = customtkinter.CTk()
app.geometry("800z80")

def button_function():
    print("button pressed")

# Use CTkButton instead of tkinter Button
button = customtkinter.CTkButton(master=app, text="CTkButton", command=button_function)
button.place(relx=0.5, rely=0.5, anchor=customtkinter.CENTER)

app.mainloop() """


""" ser = serial.Serial("COM9", 115200, timeout=1)

print("reading port: "+ser.portstr)

# import the json file with macros
with open('macros.json') as f:
            d = json.load(f)

while True:
    line = str(ser.readline())
    line = line[8:-1]
    if line != "":
        print(line)
        
        if line in d:
            macro = d[line] #saves the info about the macro to "macro"
            macroHotkey = macro['hotkey']
            if "+" in macroHotkey:
                  macroHotkey = macroHotkey.split("+")
            else:
                  macroHotkey = [macroHotkey]

            #initialize the hotkey
            pressKeys = pyautogui
            pressKeys.hotkey(macroHotkey)
            print(macroHotkey)
            
        else:
            print("macro not located") """



image = Image.open("icon.png")

def on_quit(icon, item):
    icon.stop()

menu = pystray.Menu(
    pystray.MenuItem('Quit', on_quit)
)

icon = pystray.Icon("Thingy", image, "Thingy", menu)
icon.run()