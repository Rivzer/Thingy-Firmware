import time, serial

ser = serial.Serial("COM8", 115200, timeout=1)

print("emulating pi")

while True:
    ser.write(b"macro:15\n")
    time.sleep(1)