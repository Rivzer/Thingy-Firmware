import tkinter, pystray, serial, customtkinter, time, json, pyautogui, threading, serial.tools.list_ports, keyboard
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

image = Image.open("icon.png")

def quitIcon(icon):
    threadReadingInputOnCom.do_run = False
    icon.stop()

def idetifyRaspberryComPort():
    ports = serial.tools.list_ports.comports()
    for port in ports:
         print(f"{port.device} - {port.description} - {port.hwid}")

def openSettingsWindow():
    customtkinter.set_appearance_mode("System")  # Modes: system, light, dark
    customtkinter.set_default_color_theme("blue")  # Themes: blue, dark-blue, green

    with open('macros.json') as f:
        macros = json.load(f)

    app = customtkinter.CTk()
    app.geometry("1000x600")
    pressedButton = ""

    def drawButtons(widgets):
        def button_function(button_num):
            def wrapper():
                print(f"button {button_num} pressed")    
                with open('macros.json') as f:
                    macros = json.load(f)      
                nonlocal pressedButton
                pressedButton= str(button_num)
                widgets['selected_label'].configure(text=f"Configuring button {macros[pressedButton]["label"]}")
                widgets['label_entry'].delete(0, 'end')
                widgets['label_entry'].insert(0, f'{macros[pressedButton]["label"]}')
                widgets['type_dropdown'].set(f'{macros[pressedButton]["type"]}')
                widgets['hotkey_entry'].delete(0, 'end')
                widgets['hotkey_entry'].insert(0, f'{macros[pressedButton]["hotkey"]}')
            return wrapper

        button_frame = customtkinter.CTkFrame(master=app)
        button_frame.pack(padx=20, pady=20, anchor="nw")

        # Configure grid to be responsive within the frame
        for i in range(4):
            button_frame.grid_rowconfigure(i, weight=1, minsize=80)
            button_frame.grid_columnconfigure(i, weight=1, minsize=100)

        buttons = []
        for i in range(16):
            row = i // 4
            col = i % 4
            if macros[str(i+1)]["label"] != "":
                button = customtkinter.CTkButton(
                    master=button_frame, 
                    text=macros[str(i+1)]["label"], 
                    command=button_function(i+1)
                )
            else:
                 button = customtkinter.CTkButton(
                    master=button_frame, 
                    text=" ", 
                    command=button_function(i+1)
                )
            button.grid(row=row, column=col, padx=5, pady=5, sticky="nsew")
            buttons.append(button)

    def drawControlls():
        
        control_frame = customtkinter.CTkFrame(master=app)
        control_frame.pack(side="bottom", fill="x", padx=20, pady=20)
        
        selected_label = customtkinter.CTkLabel(master=control_frame, text="Select a button to configure")
        selected_label.pack(pady=5)
        
        # Inner frame for controls
        inner_frame = customtkinter.CTkFrame(master=control_frame, fg_color="transparent")
        inner_frame.pack(pady=10, padx=10, fill="x")
        
        # Label entry
        label_frame = customtkinter.CTkFrame(master=inner_frame)
        label_frame.pack(side="left", padx=10)
        
        customtkinter.CTkLabel(master=label_frame, text="Label:").pack(side="left", padx=5)
        label_entry = customtkinter.CTkEntry(master=label_frame, width=150)
        label_entry.pack(side="left", padx=5)
        
        # Type dropdown
        type_frame = customtkinter.CTkFrame(master=inner_frame)
        type_frame.pack(side="left", padx=10)
        
        customtkinter.CTkLabel(master=type_frame, text="Type:").pack(side="left", padx=5)
        type_dropdown = customtkinter.CTkOptionMenu(
            master=type_frame,
            values=["hotkey", "open app"],
            width=120
        )
        type_dropdown.pack(side="left", padx=5)
        
        # Hotkey controls
        hotkey_frame = customtkinter.CTkFrame(master=inner_frame)
        hotkey_frame.pack(side="left", padx=10)
        
        customtkinter.CTkLabel(master=hotkey_frame, text="Hotkey:").pack(side="left", padx=5)
        hotkey_entry = customtkinter.CTkEntry(master=hotkey_frame, width=150)
        hotkey_entry.pack(side="left", padx=5)
        
        def listen_button_action():
            listen_button.configure(text="Listening...")
            app.update()
            keys = keyboard.read_hotkey()
            hotkey_entry.delete(0, 'end')
            hotkey_entry.insert(0, keys)
            listen_button.configure(text="Listen for Keys")

        listen_button = customtkinter.CTkButton(
            #TODO: make button unclickable when no pressedButton
            master=hotkey_frame,
            text="Listen for Keys",
            width=120,
            command=listen_button_action
        )
        listen_button.pack(side="left", padx=5)
        
        def save_button_action():
            with open('macros.json') as f:
                macros = json.load(f)
            macros[pressedButton]["label"] = widgets['label_entry'].get()
            macros[pressedButton]["type"] = widgets['type_dropdown'].get()
            macros[pressedButton]["hotkey"] = widgets['hotkey_entry'].get()
            with open('macros.json', 'w') as f:
                json.dump(macros, f, indent=2)
            threadReadingInputOnCom.do_run = False
            threadReadingInputOnCom.do_run = True
            #TODO: need to update all other widgets to show active data

        # Save button
        save_button = customtkinter.CTkButton(
            master=inner_frame,
            text="Save",
            width=100,
            command=save_button_action
        )
        save_button.pack(side="right", padx=10)

        widgets = {
            'selected_label': selected_label,
            'label_entry': label_entry,
            'hotkey_entry': hotkey_entry,
            'type_dropdown': type_dropdown
        } 

        drawButtons(widgets)

    drawControlls()
    app.mainloop()

def openSettings():
    settings_thread = threading.Thread(target=openSettingsWindow)
    settings_thread.daemon = True
    settings_thread.start() 

menu = pystray.Menu(
    pystray.MenuItem('Quit', quitIcon),
    pystray.MenuItem('Settings', openSettings)
)


def readingInputOnCom():
    ser = serial.Serial("COM9", 115200, timeout=1)

    print("reading port: "+ser.portstr)

    
    while getattr(threadReadingInputOnCom, "do_run", True):
        # import the json file with macros
        with open('macros.json') as f:
            d = json.load(f)
        line = str(ser.readline())
        line = line[8:-3]
        if line != "":
            print(line)
            
            if line in d:
                macro = d[line] #saves the info about the macro to "macro"
                macroHotkey = macro['hotkey']
                
                #initialize the hotkey
                keyboard.press_and_release(macroHotkey)
                print(macroHotkey)
                
            else:
                print("macro not located")

def runningTrayApp():
    icon = pystray.Icon("Thingy", image, "Thingy", menu)
    icon.run()
    
#idetifyRaspberryComPort()
threadReadingInputOnCom = threading.Thread(target=readingInputOnCom)
threadReadingInputOnCom.daemon = True

threadRunningTrayApp = threading.Thread(target=runningTrayApp)

threadReadingInputOnCom.start()
threadRunningTrayApp.start()
threadRunningTrayApp.join()
