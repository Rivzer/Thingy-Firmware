import time, serial

ser = serial.Serial("COM8", 115200, timeout=1)

print("Pi Emulator - Send macro codes")
print("Type macro number (1-16) or 'quit' to exit")
print("-" * 40)

while True:
    try:
        user_input = input("Enter macro code: ").strip()
        
        if user_input.lower() == 'quit':
            print("Exiting emulator...")
            break
            
        # Validate input is a number
        if user_input.isdigit():
            macro_code = f"macro:{user_input}\n"
            ser.write(macro_code.encode())
            print(f"Sent: {macro_code.strip()}")
        else:
            print("Invalid input. Please enter a number (1-16) or 'quit'")
            
    except KeyboardInterrupt:
        print("\nExiting emulator...")
        break
    except Exception as e:
        print(f"Error: {e}")